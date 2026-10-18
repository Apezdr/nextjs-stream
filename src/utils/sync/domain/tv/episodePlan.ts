/**
 * An episode's builder: the episode's write plan from the stored episode,
 * the stored show and this server's payload (EpisodeSyncService writes it),
 * and the availability paths an episode's fields are ranked on.
 *
 * Pure: it does no I/O. The files it reads (the episode's metadata file, the
 * thumbnail's blurhash) it reads from the resources the prefetch step fetched
 * for it (core/resources). A file it was not handed reads as a failed fetch
 * and is named in its plan's `needs`; the service fetches those and calls it
 * again (infrastructure/fileSystem/prefetch). Its warnings go to the log the
 * service hands it, which logs those of the call it keeps.
 */

import type { Availability, EpisodeEntity, PlanOutcome, ResourceRequest, RunConfig } from '../../core/types'
import { resolveDeliveryFacts, resolveMediaId } from '../../core/deliveryFacts'
import { captionUrls, fileServerUrl } from '../../infrastructure/fileSystem/urls'
import { isTopLevelFieldLocked } from '../../core/locks'
import { Resources } from '../../core/resources'
import {
  getServersReportingField,
  isHighestPriorityAmongServers,
  seasonsAcrossServers,
  serverOutranks,
} from '@src/utils/sync/core/ownership'
import { generateNormalizedVideoId } from '@src/utils/videoIdentity'
import { warnOnJitIdentityFork } from '@src/utils/sync/core/jitIdentityParity'
import { seedDiscovery, applyFirstSeen } from '@src/utils/sync/core/discovery'
import { reconcileCaptions } from '@src/utils/sync/core/captionReconcile'
import { resolveBlurhash } from '@src/utils/sync/core/imageAndBlurhash'
import { effectiveMetadata } from '@src/utils/sync/core/metadataLock'
import { planVideoFileFacts, sizeInBytes, videoFileChanged } from '@src/utils/sync/core/fileFacts'
import { draftWritePlan, emptyWritePlan } from '@src/utils/sync/core/writePlan'
import { readBlurhashFile } from './blurhashFile'

/**
 * What planEpisode reads of the run, besides the availability: not forceSync
 * (the episode's gate is checked before it runs), not the cleanup config
 * (field-absence cleanup plans apart).
 */
export type EpisodePlanRun = Pick<RunConfig, 'serverConfig' | 'allEnabledServersProbed'>

/** Where planEpisode's warnings go (pino's warn and error take the same arguments). */
export interface EpisodePlanLog {
  warn(fields: Record<string, unknown>, message: string): void
  error(fields: Record<string, unknown>, message: string): void
}

/** planEpisode's input. */
export interface EpisodePlanInput {
  /** The show's folder name (originalTitle): the availability key. */
  showOriginalTitle: string
  /** The show's display title, copied onto the episode. */
  displayTitle: string
  seasonNumber: number
  episodeNumber: number
  /** This server's payload for the episode. */
  fileData: any
  /** The show's payload: the season's literal key is resolved from it. */
  showPayload: any
  run: EpisodePlanRun
  availability: Availability
  /** The episode as stored, or null for a new one. */
  existing: EpisodeEntity | null
  /** The stored show's id (the showId foreign key), or null. */
  showId: any
  /** The stored season's id (the seasonId foreign key), or null. */
  seasonId: any
  /** The show as stored after this pass's show write: its metadata's episodes are the fallback. */
  parentShow: any
  /** This server's payload for the season: its lengths and dimensions maps. */
  seasonFileData?: any
  /** The episode's key in the season's episodes map. */
  episodeFileName?: string
}

/**
 * An episode's write plan: the existing doc with the incoming file-server
 * data merged on top, respecting per-field server priority.
 *
 * Key differences from naive field copy:
 *  - fileData.metadata is a URL path, not inline data — the prefetch step fetches
 *    it through fetchMetadataMultiServer. Fallback: parent show's metadata.seasons[].episodes[].
 *  - fileData.thumbnailBlurhash is a URL path to a blurhash file, not the actual
 *    blurhash string. It is fetched (or the stored one kept or removed) by the
 *    blurhash rule, core/imageAndBlurhash.
 *
 * The plan's removals are the fields whose data is gone, not changed. It is
 * incomplete, and its deferrals name why, when the metadata did not come
 * from a fresh source, a caption removal was held back because not every
 * enabled server answered, or a blurhash the file server publishes could
 * not be fetched. The plan always writes the episode: it stamps lastSynced.
 * Its `needs` are the files it read and was not handed (core/resources).
 */
export function planEpisode(
  {
    showOriginalTitle,
    displayTitle,
    seasonNumber,
    episodeNumber,
    fileData,
    showPayload,
    run,
    availability,
    existing,
    showId,
    seasonId,
    parentShow,
    seasonFileData,
    episodeFileName,
  }: EpisodePlanInput,
  resources: Resources,
  log: EpisodePlanLog
): PlanOutcome<EpisodeEntity> {
  const now = new Date()
  // What was held back, and why (the plan's incomplete and deferrals).
  const plan = emptyWritePlan<EpisodeEntity>()
  const holdBack = (reason: string) => {
    plan.incomplete = true
    plan.deferrals.push(reason)
  }
  // Fields whose data is gone (not changed) and must be removed from the
  // stored document. An admin lock keeps a field.
  const unset: string[] = []
  const clearField = (field: string) => {
    if (isTopLevelFieldLocked((existing as any)?.lockedFields, field)) return
    delete (entity as any)[field]
    if (existing && (existing as any)[field] !== undefined) unset.push(field)
  }

  // The episode this pass wants stored: the existing doc (preserving ALL
  // fields) or a new one. Either way the pass stamps lastSynced, so the plan
  // writes the episode (core/writePlan writesDocument).
  const entity: EpisodeEntity = existing
    ? { ...existing, lastSynced: now }
    : {
        // The file server's own reading of the filename is a better stand-in
        // than "Episode N" until the metadata supplies the real name.
        title: fileData?.title || fileData?.derivedEpisodeName || `Episode ${episodeNumber}`,
        originalTitle: showOriginalTitle,  // Show's filesystem key (matches legacy)
        type: 'episode',
        createdAt: now,
        lastSynced: now,
        episodeNumber,
        seasonNumber,
        showTitle: displayTitle,
      }

  // Heal structural fields
  if (!entity.type) entity.type = 'episode'
  if (!entity.createdAt) entity.createdAt = now
  // Library-add date: seeded once, never moved later (core/discovery.ts).
  // This is the grain "Recently Added" ranks TV on — a show rises when a NEW
  // episode coordinate arrives, not when an existing episode's file is
  // replaced by a quality upgrade.
  seedDiscovery(entity, existing, run.serverConfig.id, now)
  if (showId) entity.showId = showId
  if (seasonId) entity.seasonId = seasonId
  // Use display title as showTitle (matches legacy document shape)
  entity.showTitle = displayTitle

  // --- Video URL (owned by the highest-priority server that has the episode) ---
  const leafPrefixes = episodeLeafPrefixes(showOriginalTitle, seasonNumber, episodeFileName, showPayload, availability)
  if (leafPrefixes.length === 0) {
    log.warn(
      { showOriginalTitle, seasonNumber, episodeNumber, serverId: run.serverConfig.id },
      'Cannot build the availability path for this episode; field ownership is not ranked against other servers'
    )
  }
  const owns = (field: string, hasValue: boolean) =>
    ownsEpisodeField(leafPrefixes, field, hasValue, showOriginalTitle, run, availability)
  const canUpdateVideo = owns('videoURL', Boolean(fileData?.videoURL))
  if (canUpdateVideo && fileData?.videoURL) {
    if (isTopLevelFieldLocked((existing as any)?.lockedFields, 'videoURL')) {
      // videoURL is admin-locked: computeDiff would drop the URL write
      // anyway, but videoSource would leak through and normalizedVideoId
      // would derive from a URL that is never stored. Keep the stored
      // (effective) videoURL and derive identity from it so it matches
      // what clients actually play and report. Locked JIT-transcoder URLs
      // canonicalize to the source pathname inside the shared impl.
      if (entity.videoURL) {
        entity.normalizedVideoId = generateNormalizedVideoId(entity.videoURL)
      }
    } else {
      entity.videoURL = fileServerUrl(fileData.videoURL, run.serverConfig)
      entity.videoSource = run.serverConfig.id
      entity.normalizedVideoId = generateNormalizedVideoId(entity.videoURL)
    }
  }

  // --- Content identity + delivery facts (follow video priority) ---
  //
  // Episodes carry these flat beside videoURL, matching the backend's
  // episode payload convention. Two write disciplines, same as movies:
  // mediaId is SET-ONLY (durable identity — a payload that cannot resolve
  // it sends null, which must never clear what we hold, and it is on
  // FieldAbsenceCleaner's denylist); the delivery facts are MIRRORED so
  // that disabling JIT on the owning host clears them on the next sync.
  if (canUpdateVideo && fileData) {
    const incomingMediaId = resolveMediaId(fileData.mediaIdentity)
    if (incomingMediaId) {
      if (existing?.mediaId && existing.mediaId !== incomingMediaId) {
        log.warn(
          {
            showOriginalTitle,
            seasonNumber,
            episodeNumber,
            storedMediaId: existing.mediaId,
            incomingMediaId,
            serverId: run.serverConfig.id,
          },
          'mediaId mismatch for episode — video owner wins'
        )
      }
      entity.mediaId = incomingMediaId
    }

    // Episodes carry these flat; source urls go through the same
    // fileServerUrl as videoURL above.
    const facts = resolveDeliveryFacts(fileData, (url) =>
      fileServerUrl(url, run.serverConfig)
    )
    entity.sources = facts.sources
    entity.primaryContainer = facts.primaryContainer
    entity.jitEligible = facts.jitEligible
    entity.jitUrl = facts.jitUrl

    // The JIT manifest for the same file must key to the same identity as
    // the stored videoURL, or rows written through the transcoder never
    // join this episode. Compared against the post-lock videoURL.
    warnOnJitIdentityFork(
      {
        videoURL: entity.videoURL ?? null,
        jitUrl: entity.jitUrl ?? null,
        label: `episode:${showOriginalTitle} S${entity.seasonNumber}E${entity.episodeNumber}`,
      },
      (fields, message) => log.warn(fields, message)
    )
  }

  // --- Library-add date, earlier-wins (core/discovery.ts) ---
  // The backend keeps a per-episode first-seen map in the show's identity
  // sidecar, keyed by S/E coordinate, so it survives this document being
  // deleted and re-created (the orphan add/delete cycle) — the one thing our
  // own seeded date cannot. Adopted only when it PREDATES ours: the map was
  // seeded at its rollout for every episode that was already here.
  //
  // Every server that has the episode's video is heard, not just the video's
  // owner: the earliest date any of them holds is when the episode entered
  // the library. Heard from the owner alone, the date depended on which
  // server was down when the episode was first synced.
  if (fileData?.videoURL) {
    applyFirstSeen(entity, fileData.mediaIdentity, run.serverConfig.id, now, (heldServerId) =>
      serverOutranks(run.serverConfig, heldServerId)
    )
  }

  // --- Video info (follows video priority) ---
  if (canUpdateVideo && fileData?.videoInfo && typeof fileData.videoInfo === 'object') {
    entity.videoInfo = fileData.videoInfo
    entity.videoInfoSource = run.serverConfig.id
  }

  // --- Facts about the video file (flat, matching legacy document shape) ---
  // duration, dimensions, size, hdr, mediaQuality and mediaLastModified, by
  // the rule in core/fileFacts: they come from the server that owns the
  // video, and one its payload does not report is removed only when the
  // probe ran (a duration in the season's lengths map) or the file changed.
  if (canUpdateVideo) {
    const plan = planVideoFileFacts(
      {
        duration:
          seasonFileData?.lengths && episodeFileName ? seasonFileData.lengths[episodeFileName] : undefined,
        dimensions:
          seasonFileData?.dimensions && episodeFileName ? seasonFileData.dimensions[episodeFileName] : undefined,
        // Bytes, or a {kb, mb, gb} object converted to bytes as for movies,
        // so consumers can treat `size` as bytes for both media types.
        size: typeof fileData?.size === 'number' ? fileData.size : sizeInBytes(fileData?.additionalMetadata?.size),
        hdr: fileData?.hdr,
        mediaQuality: fileData?.mediaQuality || undefined,
        mediaLastModified: fileData?.mediaLastModified,
      },
      videoFileChanged(
        existing,
        entity.videoURL,
        isTopLevelFieldLocked((existing as any)?.lockedFields, 'videoURL')
      )
    )
    for (const [fact, value] of Object.entries(plan.set)) (entity as any)[fact] = value
    for (const fact of plan.unset) clearField(fact)
    if (plan.unreadableModified) {
      log.warn(
        { showOriginalTitle, seasonNumber, episodeNumber, value: fileData.mediaLastModified },
        'Unreadable mediaLastModified in the episode payload, keeping the stored value'
      )
    }

    entity.videoInfoSource = run.serverConfig.id
  }

  // --- Thumbnail (priority-gated) ---
  // Read from `thumbnail` alone, the key the processor publishes and the
  // path the availability map and field-absence cleanup rank on.
  const canUpdateThumbnail = owns('thumbnail', Boolean(fileData?.thumbnail))
  if (canUpdateThumbnail) {
    entity.thumbnail = fileServerUrl(fileData.thumbnail, run.serverConfig)
    entity.thumbnailSource = run.serverConfig.id
  }

  // --- Captions (one language belongs to the highest-priority server listing it) ---
  // Legacy field: captionURLs (object keyed by language), NOT captions (array)
  // File server data key: "subtitles" (not "captions")
  // The stored map is edited entry by entry (core/captionReconcile). It used
  // to be merged with whatever the syncing server listed, so two servers
  // overwrote each other's file for a shared language and a removed subtitle
  // was never taken out.
  if (fileData) {
    let listedCaptions: Record<string, any> | null = null
    let captionsReadable = true
    try {
      listedCaptions =
        fileData.subtitles && typeof fileData.subtitles === 'object'
          ? captionUrls(fileData.subtitles, run.serverConfig)
          : null
    } catch (error) {
      // Not being able to read the list is not the same as an empty list.
      captionsReadable = false
      log.error(
        { showOriginalTitle, seasonNumber, episodeNumber, err: error instanceof Error ? error.message : String(error) },
        'Failed to read the episode captions, leaving the stored ones alone'
      )
    }

    if (captionsReadable && !isTopLevelFieldLocked((existing as any)?.lockedFields, 'captionURLs')) {
      const serversListing = (language: string) =>
        serversReportingEpisodeField(
          leafPrefixes, `subtitles.${language}.url`, showOriginalTitle, availability
        )
      const result = reconcileCaptions({
        existing: existing?.captionURLs as Record<string, any> | undefined,
        listed: listedCaptions,
        serverId: run.serverConfig.id,
        ownsLanguage: (language) => owns(`subtitles.${language}.url`, true),
        listedByAnyServer: (language) => serversListing(language).length > 0,
        // Without the literal path nothing can be said about other servers.
        allEnabledServersProbed:
          leafPrefixes.length > 0 &&
          run.allEnabledServersProbed === true,
      })
      if (result.withheld.length > 0) holdBack('captionURLs')

      if (result.changed) {
        const languages = Object.keys(result.captions).sort()
        if (languages.length > 0) {
          entity.captionURLs = result.captions as any
          // Named from the map itself, so it does not depend on which
          // server's pass ran last.
          entity.captionSource = (result.captions[languages[0]] as any)?.sourceServerId ?? run.serverConfig.id
        } else {
          clearField('captionURLs')
          clearField('captionSource')
        }
      }
    }
  }

  // --- Chapters (priority-gated) ---
  // Legacy stores chapterURL as a single URL string (not an array)
  const canUpdateChapters = owns('chapters', Boolean(fileData?.chapters))
  if (canUpdateChapters) {
    entity.chapterURL = fileServerUrl(fileData.chapters, run.serverConfig)
    entity.chapterSource = run.serverConfig.id
  }

  // --- Metadata (priority-gated) ---
  // Tracks whether episode metadata came from a CONFIRMED fresh source (URL
  // fetch ok, or backend-inlined object) vs. the parent inline fallback or a
  // failure. Only a fresh source may advance the episode's gate — the inline
  // fallback is fine for display but must not lock the episode on a stale
  // parent. Default true so "no episode metadata URL" never blocks the gate.
  let metadataFromFreshFetch = true
  // The copy this pass brings, when it is usable.
  let incomingMetadata: any = null
  const canUpdateMetadata = owns('metadata', Boolean(fileData?.metadata))
  if (canUpdateMetadata) {
    // fileData.metadata is typically a URL path — fetch actual metadata from file server
    let episodeMetadata: any = null

    if (typeof fileData.metadata === 'string') {
      // Read by the prefetch step through fetchMetadataMultiServer. A fetch
      // that failed reads as null — try fallback below.
      const metadataFile: ResourceRequest = { kind: 'metadata', serverId: run.serverConfig.id, path: fileData.metadata }
      episodeMetadata = resources.data(metadataFile)
      // Capture the URL-fetch outcome BEFORE the inline fallback overwrites it.
      metadataFromFreshFetch = !!(episodeMetadata && typeof episodeMetadata === 'object' && !episodeMetadata.error)
    } else if (typeof fileData.metadata === 'object') {
      episodeMetadata = fileData.metadata
      metadataFromFreshFetch = true
    }

    // Fallback: parent show's metadata.seasons[].episodes[] array (DISPLAY ONLY —
    // does NOT flip metadataFromFreshFetch, so it never advances the gate).
    if (!episodeMetadata || episodeMetadata.error) {
      const seasonMeta = parentShow?.metadata?.seasons?.find(
        (s: any) => s.season_number === seasonNumber
      )
      if (seasonMeta?.episodes) {
        episodeMetadata = seasonMeta.episodes.find(
          (e: any) => e.episode_number === episodeNumber
        )
      }
    }

    if (episodeMetadata && typeof episodeMetadata === 'object' && !episodeMetadata.error) {
      incomingMetadata = episodeMetadata
    }
  }
  if (!metadataFromFreshFetch) holdBack('metadata')
  // Metadata an admin locked stays as stored: the fetched copy is dropped
  // on the way to the database, and the title below is taken from what the
  // document actually holds (core/metadataLock).
  const metadata = effectiveMetadata<any>({
    stored: existing ? { metadata: existing.metadata, metadataSource: existing.metadataSource } : null,
    incoming: incomingMetadata ? { metadata: incomingMetadata, metadataSource: run.serverConfig.id } : null,
    locked: isTopLevelFieldLocked((existing as any)?.lockedFields, 'metadata'),
  })
  if (metadata.action === 'write') {
    entity.metadata = metadata.metadata
    entity.metadataSource = metadata.metadataSource
  }

  // --- Thumbnail blurhash ---
  // Kept, fetched or removed by the one rule every image follows
  // (core/imageAndBlurhash): settled by the thumbnail's owner, removed when
  // it is of another thumbnail and nothing replaces it. A failed fetch is
  // reported, so the episode is not skipped from now on without it.
  const lockedField = (field: string) => isTopLevelFieldLocked((existing as any)?.lockedFields, field)
  const thumbnailBlurhash = resolveBlurhash(
    {
      stored: {
        url: existing?.thumbnail,
        blurhash: existing?.thumbnailBlurhash,
        blurhashSource: (existing as any)?.thumbnailBlurhashSource,
      },
      reported: {
        url: canUpdateThumbnail ? entity.thumbnail : null,
        blurhashUrl: fileData?.thumbnailBlurhash,
      },
      owner: canUpdateThumbnail ? run.serverConfig.id : null,
      locks: { image: lockedField('thumbnail'), blurhash: lockedField('thumbnailBlurhash') },
    },
    (path) => readBlurhashFile(resources, path, run)
  )
  if (thumbnailBlurhash.action === 'write') {
    entity.thumbnailBlurhash = thumbnailBlurhash.blurhash
    entity.thumbnailBlurhashSource = thumbnailBlurhash.blurhashSource
  } else {
    if (thumbnailBlurhash.fetchFailed) holdBack('thumbnailBlurhash')
    if (thumbnailBlurhash.action === 'unset') {
      clearField('thumbnailBlurhash')
      clearField('thumbnailBlurhashSource')
    }
  }

  // --- Title: the metadata's name when the episode has one, otherwise the
  // video owner's reading of the filename. ---
  // Decided here, from what the document ends up holding, so it does not
  // depend on which server created the episode or synced last.
  const metadataName = (metadata.metadata as any)?.name
  if (typeof metadataName === 'string' && metadataName.trim()) {
    entity.title = metadataName
  } else if (canUpdateVideo) {
    entity.title = fileData?.title || fileData?.derivedEpisodeName || `Episode ${episodeNumber}`
  }

  return { plan: { ...plan, ...draftWritePlan(existing, entity, [...new Set(unset)]), needs: resources.needs } }
}

/**
 * The fieldAvailability path prefixes for one episode:
 * `seasons.<seasonKey>.episodes.<episodeKey>`, once per literal season key in
 * use for that season across the servers that answered.
 *
 * The keys are the ones the file servers sent — the ones
 * collectFieldAvailability walked (a real folder name like "Season 01",
 * never a reconstructed "Season 1"). Two servers do not have to agree on
 * that name: with "Season 01" on one and "Season 1" on the other, the same
 * episode has two prefixes, and ranking on this server's alone would make
 * each server the only one it can see. This server's own key comes first.
 * Empty when the keys cannot be resolved.
 */
export function episodeLeafPrefixes(
  showOriginalTitle: string,
  seasonNumber: number,
  episodeKey: string | undefined,
  showPayload: any,
  availability: Availability
): string[] {
  if (!episodeKey) return []
  const ownKey = resolveSeasonKey(showPayload, seasonNumber)
  const otherKeys =
    seasonsAcrossServers(availability.fieldAvailability, showOriginalTitle).get(seasonNumber)?.keys ?? []
  const seasonKeys = [...new Set([...(ownKey ? [ownKey] : []), ...otherKeys])]
  return seasonKeys.map((seasonKey) => `seasons.${seasonKey}.episodes.${episodeKey}`)
}

/**
 * Resolve the LITERAL season key used in the file-server data (e.g. "Season 2",
 * "2", "S02") for this season number. Field-absence cleanup builds compound
 * fieldAvailability paths (`seasons.<seasonKey>.episodes.<epKey>.<field>`), and
 * those paths must use the exact keys collectFieldAvailability walked — guessing
 * the format would make every lookup miss and report false absences. Mirrors the
 * candidate order of extractSeasonFileData but returns the key, not the data.
 */
function resolveSeasonKey(showData: any, seasonNumber: number): string | null {
  if (!showData?.seasons) return null

  for (const candidate of [
    String(seasonNumber),
    `Season ${seasonNumber}`,
    `season_${seasonNumber}`,
    `S${String(seasonNumber).padStart(2, '0')}`
  ]) {
    if (showData.seasons[candidate]) return candidate
  }

  for (const key of Object.keys(showData.seasons)) {
    if (parseSeasonNumber(key) === seasonNumber) return key
  }
  return null
}

/** The servers reporting one of an episode's fields, under any of its prefixes. */
function serversReportingEpisodeField(
  leafPrefixes: string[],
  field: string,
  showOriginalTitle: string,
  availability: Availability
): string[] {
  return [
    ...new Set(
      leafPrefixes.flatMap((prefix) =>
        getServersReportingField(availability.fieldAvailability, 'tv', showOriginalTitle, `${prefix}.${field}`)
      )
    ),
  ]
}

/**
 * Whether the syncing server owns one of an episode's fields: the
 * availability map lists it for the field's exact path (under any of the
 * episode's prefixes) and no server listed there outranks it
 * (core/ownership). Fails closed: a server the map does not list for the
 * field never owns it, even when its payload has something there.
 *
 * Every episode field used to be checked against a bare name ('thumbnail',
 * 'chapters', 'metadata') that no availability map ever contains, and the
 * priority helper answers "anyone may write" for a path nobody reports. So
 * with two servers each one overwrote the other's thumbnail, chapters,
 * metadata and captions on every run, and the result was whichever synced
 * last. The fix after that still counted the syncing server as a reporter
 * whenever its payload had a value, listed or not: a value the map records
 * under another leaf (the `thumbnailURL` alias) was then written by the
 * builder and removed by field-absence cleanup in the same write.
 *
 * One exception: when the literal paths cannot be built (the episode's key
 * is empty, which no processor sends; logged in planEpisode), the
 * server is ranked against no one and owns what its payload has. It is
 * safe: the server still writes only a value it has, never clears another
 * server's with nothing, and nothing is removed for such an episode
 * (planEpisodeCleanup needs a path, and reconcileCaptions is told not every
 * server answered), so no write can both set and remove a field.
 */
function ownsEpisodeField(
  leafPrefixes: string[],
  field: string,
  hasValue: boolean,
  showOriginalTitle: string,
  run: Pick<RunConfig, 'serverConfig'>,
  availability: Availability
): boolean {
  if (!hasValue) return false
  const reporters = leafPrefixes.length === 0
    ? [run.serverConfig.id]
    : serversReportingEpisodeField(leafPrefixes, field, showOriginalTitle, availability)
  return isHighestPriorityAmongServers(reporters, run.serverConfig)
}

export function parseSeasonNumber(key: string): number | null {
  const match = key.match(/(?:season_?|s)?(\d+)/i)
  const n = match ? parseInt(match[1], 10) : NaN
  return n >= 0 ? n : null
}
