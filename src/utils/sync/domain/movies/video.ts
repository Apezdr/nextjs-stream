/**
 * A movie's video step: the video URL and its owner, the facts about the video
 * file, the content identity and delivery facts, the library-add date, the
 * captions and the chapter file.
 *
 * The third of the movie's steps (MovieSyncService). Its plan sets what
 * changed and removes what is gone; it holds a removal back (the plan is
 * incomplete) when it may not make it on this run. Reading the payload itself
 * is in ./videoPayload.
 */

import {
  MovieEntity,
  SyncContext,
  SyncStatus,
  SyncOperation,
  MediaType,
  resolveMediaId,
  resolveFirstSeen,
  claimDiscovery,
  resolveDeliveryFacts,
  resolveEffectiveVideoUrl,
  MediaQuality,
  syncEventBus,
  MediaTypesFieldAvailability,
  getFieldPath,
  getCaptionFieldPath,
} from '../../core'
import { captionUrls, fileServerUrl, isTopLevelFieldLocked } from '../../infrastructure'
import { emptyWritePlan } from '../../core/writePlan'
import { reconcileCaptions } from '../../core/captionReconcile'
import { VIDEO_FILE_FACTS, planVideoFileFacts, videoFileChanged, type FileFactsPlan } from '../../core/fileFacts'
import {
  getServersReportingField,
  isCurrentServerHighestPriorityForReportedField,
  isHighestPriorityAmongServers,
  serverOutranks,
} from '@src/utils/sync/core/ownership'
import { syncLogger } from '../../core/logger'
import { warnOnJitIdentityFork } from '../../core/jitIdentityParity'
import isEqual from 'lodash/isEqual'
import { movieStepResult, type MovieStepInput, type MovieStepOutcome } from './step'
import {
  chapterUrlOf,
  isMediaQualityEqual,
  normalizedVideoIdOf,
  videoFactsOf,
  videoUrlOf,
} from './videoPayload'

/**
 * The video step. See the module comment.
 */
export async function syncMovieVideo({ originalTitle, movie, context }: MovieStepInput): Promise<MovieStepOutcome> {
  const startTime = Date.now()
  const title = originalTitle
  const plan = emptyWritePlan<MovieEntity>()
  const failed = (errors: string[]): MovieStepOutcome => ({
    plan: { ...emptyWritePlan<MovieEntity>(), incomplete: true, deferrals: ['video'] },
    result: movieStepResult(title, SyncOperation.Content, context, SyncStatus.Failed, [], errors, {
      processingTime: Date.now() - startTime,
    }),
  })

  syncLogger.debug(`🎬 Movie video step starting for: "${title}"`)

  if (!originalTitle || originalTitle.trim().length === 0) {
    return failed(['originalTitle is required for content sync operations'])
  }

  try {
    syncEventBus.emitProgress(title, MediaType.Movie, context.serverConfig.id, SyncOperation.Content, {
      stage: 'starting',
      progress: 0,
    })

    const changes: string[] = []
    const { updates: contentUpdates, unset: contentUnset, heldBack } = decideVideo(originalTitle, context, movie)

    // A removal held back for lack of a full probe: the plan is incomplete,
    // so this pass is not marked complete. Otherwise it would be skipped from
    // now on and the removal never retried.
    if (heldBack.length > 0) {
      plan.incomplete = true
      plan.deferrals.push(...heldBack)
    }

    if (Object.keys(contentUpdates).length > 0 || contentUnset.length > 0) {
      // The display title is not this step's to write: MovieSyncService
      // derives it once, from the stored metadata, at the consolidated write.
      // Forcing the folder name in here is what made a title flip between
      // "The Matrix" and "The Matrix (1999)" depending on which strategy had
      // something to change.
      const set: any = { ...contentUpdates, lastSynced: new Date() }

      // Add source tracking for updated content fields
      Object.keys(contentUpdates).forEach((field) => {
        if (
          field === 'videoURL' ||
          // Delivery/identity facts are companions of the video block: they
          // describe the primary source that videoURL points at, so they
          // share its owner rather than carrying independent provenance.
          field === 'sources' ||
          field === 'primaryContainer' ||
          field === 'jitEligible' ||
          field === 'jitUrl' ||
          field === 'mediaId'
        ) {
          set.videoSource = context.serverConfig.id
        } else if ((VIDEO_FILE_FACTS as readonly string[]).includes(field)) {
          // All video metadata fields use videoInfoSource
          set.videoInfoSource = context.serverConfig.id
        } else if (field === 'captionURLs') {
          // The map can hold entries from several servers. Name the source
          // from the map itself (its first language, alphabetically) so the
          // value does not depend on which server's pass ran last.
          const captions = contentUpdates.captionURLs as Record<string, any>
          const firstLanguage = Object.keys(captions).sort()[0]
          set.captionSource = captions[firstLanguage]?.sourceServerId ?? context.serverConfig.id
        } else if (field === 'chapterURL') {
          set.chapterSource = context.serverConfig.id
        }
      })

      // A title that ends this pass with no video has no video source. The
      // loop above stamps one whenever a video-block field changed, which
      // includes clearing the URL and setting the folder's mediaId on a
      // title that never had a video; put back whatever was stored.
      const videoUrlAfter = 'videoURL' in contentUpdates ? contentUpdates.videoURL : (movie as any).videoURL
      if (videoUrlAfter == null) {
        if ((movie as any).videoSource === undefined) delete set.videoSource
        else set.videoSource = (movie as any).videoSource
      }

      // A field being cleared must not also ride along as a value (a source
      // stamp may have just been set for a field whose data is going).
      for (const field of contentUnset) delete set[field]

      plan.set = set
      plan.unset = [...contentUnset]

      // Add specific changes for each updated field
      Object.keys(contentUpdates).forEach((key) => {
        changes.push(`Updated ${key}`)
      })
      contentUnset.forEach((key) => {
        changes.push(`Cleared ${key}`)
      })

      syncEventBus.emitProgress(title, MediaType.Movie, context.serverConfig.id, SyncOperation.Content, {
        stage: 'completed',
        progress: 100,
        updatedFields: [...Object.keys(contentUpdates), ...contentUnset],
      })
    } else {
      syncEventBus.emitProgress(title, MediaType.Movie, context.serverConfig.id, SyncOperation.Content, {
        stage: 'unchanged',
        progress: 100,
      })
    }

    return {
      plan,
      result: movieStepResult(
        title,
        SyncOperation.Content,
        context,
        changes.length > 0 ? SyncStatus.Completed : SyncStatus.Skipped,
        changes,
        [],
        {
          processingTime: Date.now() - startTime,
          contentProcessed: [...Object.keys(contentUpdates), ...contentUnset],
        }
      ),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    syncEventBus.emitError(title, MediaType.Movie, context.serverConfig.id, message, SyncOperation.Content)
    return failed([message])
  }
}

/**
 * Decide the video block for a movie using originalTitle (filesystem key).
 */
function decideVideo(
  originalTitle: string,
  context: SyncContext,
  currentMovie: MovieEntity
): {
  /** Fields to write. */
  updates: {
    videoURL?: string | null
    duration?: number
    dimensions?: string
    hdr?: string
    mediaQuality?: MediaQuality
    mediaLastModified?: Date
    normalizedVideoId?: string
    captionURLs?: Record<
      string,
      {
        srcLang: string
        url: string
        lastModified?: string
        sourceServerId?: string
      }
    >
    chapterURL?: string
  }
  /** Fields to remove from the document: their data is gone, not changed. */
  unset: string[]
  /** Removals held back because not every enabled server answered. */
  heldBack: string[]
} {
  const updates: any = {}
  const unset: string[] = []
  const heldBack: string[] = []
  const hasStoredValue = (value: unknown) => value !== undefined && value !== null

  syncLogger.debug(`Syncing video content for: "${originalTitle}"`)

  let fileServerMovieData = null

  // Extract the specific movie data from the file server data structure
  if (context.fileServerData?.movies?.[originalTitle]) {
    fileServerMovieData = context.fileServerData.movies[originalTitle]
    syncLogger.debug(`Found file server data for "${originalTitle}"`)
  } else {
    syncLogger.debug(`No file server data found for "${originalTitle}"`)
  }

  // Step 1: Get video URL from file server data
  let videoUrl: string | null = null
  if (fileServerMovieData) {
    videoUrl = videoUrlOf(originalTitle, fileServerMovieData, context)
  }

  // Who may write the video block, and who may clear it.
  //
  // WRITE: only the highest-priority server that HAS a video for this title.
  // The check used to be "no server with the field outranks me", which a
  // server without the field passes whenever its priority number is lower.
  // So a folder with no video on the main server (an override placeholder,
  // or a folder whose file was deleted) set videoURL, sources and jitUrl to
  // null on every run, and the server that does have the video put them
  // back — which of the two the run ended on depended on server order.
  //
  // CLEAR: only when NO server has a video for it, and only on the say-so of
  // the server the stored video came from, or on a run in which every enabled
  // server answered. A server that is down has not deleted its files.
  const videoPath = getFieldPath('videoURL')
  const isVideoUrlLocked = isTopLevelFieldLocked((currentMovie as any)?.lockedFields, 'videoURL')
  let ownsVideo = false
  let videoGone = false
  if (fileServerMovieData) {
    const reporters = getServersReportingField(context.fieldAvailability, 'movies', originalTitle, videoPath)
    // A URL found through the fileNames fallback has no urls.mp4 leaf, so
    // the server is not among the reporters. It counts as having the video
    // only when nobody reports one: ranked alongside real reporters it would
    // be an owner in its own pass and absent from everyone else's, and two
    // servers would each conclude they own the video.
    const serversWithVideo =
      reporters.length > 0 ? reporters : videoUrl != null ? [context.serverConfig.id] : []
    ownsVideo = videoUrl != null && isHighestPriorityAmongServers(serversWithVideo, context.serverConfig)
    const noServerHasVideo = videoUrl == null && reporters.length === 0
    videoGone = noServerHasVideo && mayDeclareVideoGone(currentMovie, context)
    if (noServerHasVideo && !videoGone && currentMovie.videoURL) {
      // There is a video to clear and this pass may not clear it.
      heldBack.push('videoURL')
    }
  }
  // No payload for this title: there is no video URL and no availability to
  // rank against, and "no payload" is not evidence the video is gone, so this
  // path neither writes nor clears.

  if (ownsVideo) {
    if (currentMovie.videoURL !== videoUrl) {
      updates.videoURL = videoUrl
      syncLogger.debug(
        `✅ Updating videoURL from server ${context.serverConfig.id}: "${currentMovie.videoURL}" → "${videoUrl}"`
      )
    }
  } else if (videoGone && currentMovie.videoURL) {
    updates.videoURL = null
    syncLogger.debug(
      `✅ Clearing videoURL: no server has a video for "${originalTitle}" (was "${currentMovie.videoURL}")`
    )
  }

  // The owner's id is the video's source, whether or not the URL itself moved
  // (a hand-over between two servers serving the same path leaves the URL as
  // it was). Stamped here rather than left to "a field changed", so the value
  // does not depend on the title's history.
  if (ownsVideo && fileServerMovieData) {
    if ((currentMovie as any).videoSource !== context.serverConfig.id) {
      updates.videoSource = context.serverConfig.id
    }
    if ((currentMovie as any).videoInfoSource !== context.serverConfig.id) {
      updates.videoInfoSource = context.serverConfig.id
    }
  }

  // The URL this write leaves in the document (a locked URL stays whatever
  // lands in `updates`). Everything derived from the file keys off this.
  const effectiveVideoUrl = resolveEffectiveVideoUrl({
    currentVideoUrl: currentMovie.videoURL,
    updates,
    isVideoUrlLocked,
  })

  // Step 2: Facts about the video file (duration, dimensions, size, hdr,
  // mediaQuality, mediaLastModified), by the rule in core/fileFacts: they
  // come from the server that owns the video and from nowhere else, and
  // one its payload does not report is removed only when the probe ran or
  // the file changed. They used to be set-if-present under their own
  // per-field priority, which also let a server with no video own `hdr`
  // and `mediaQuality` merely by reporting them as null.
  if (fileServerMovieData) {
    if (ownsVideo) {
      const videoFacts = videoFactsOf(originalTitle, fileServerMovieData)
      // null means the payload could not be read. Change nothing rather than
      // clear on an error.
      if (videoFacts) {
        const plan = planVideoFileFacts(
          {
            duration: videoFacts.duration,
            dimensions: videoFacts.dimensions,
            size: videoFacts.fileSize,
            hdr: videoFacts.hdr,
            mediaQuality: videoFacts.mediaQuality,
            mediaLastModified: videoFacts.mediaLastModified,
          },
          videoFileChanged(currentMovie, videoUrl, isVideoUrlLocked)
        )
        applyVideoFileFacts(updates, unset, currentMovie, plan, originalTitle)
      }
    } else if (videoGone && !effectiveVideoUrl) {
      // The video is gone, and every fact about its file with it.
      for (const field of [...VIDEO_FILE_FACTS, 'normalizedVideoId', 'videoSource', 'videoInfoSource']) {
        if (hasStoredValue((currentMovie as any)[field])) unset.push(field)
      }
    }
  }

  // Step 3: Generate normalized video ID for deduplication.
  // Derived from the EFFECTIVE videoURL — the value this write actually
  // leaves in the doc, which is NOT always the URL this server reported.
  // Two things withhold it, and both must be honored here:
  //
  //   1. An admin lock, which computeDiff drops on the way to Mongo.
  //   2. Field PRIORITY. A server that does not own videoURL never gets its
  //      URL written (the block above is gated on `ownsVideo`), but this
  //      step used to hash that URL anyway — so on a title present on two
  //      servers, the non-owner's pass silently re-keyed the doc to its own
  //      path shape while videoURL kept the owner's. Every
  //      `WatchHistory.normalizedVideoId === FlatMovies.normalizedVideoId`
  //      join for that title then failed: the client reports a hash of the
  //      URL it was served, and the catalog holds a hash of a URL nobody
  //      plays. Observed as three movies keyed to an un-prefixed path while
  //      served from a `prefixPath: '/media'` server.
  //
  // Deriving from the post-write value covers both, and makes any server's
  // pass repair a title that drifted. The rule itself lives in
  // `resolveEffectiveVideoUrl` (sync/core) — the TV path applies the same
  // discipline inline in EpisodeSyncService, deriving from `entity.videoURL`
  // inside its own priority gate. For a locked JIT-transcoder URL the shared
  // canonicalizer maps it to the source pathname, so locked-JIT and unlocked
  // produce the same id. Must agree with
  // flatDatabaseUtils.generateNormalizedVideoId so WatchHistory joins work.
  // Not tracked in fieldAvailability (it's derivable, not authoritative).
  // (effectiveVideoUrl is resolved above, right after the videoURL decision.
  // With no URL left there is no id to derive; a stale one is cleared with
  // the rest of the file's facts in step 2.)
  if (effectiveVideoUrl) {
    const normalizedId = normalizedVideoIdOf(effectiveVideoUrl, originalTitle)
    if (currentMovie.normalizedVideoId !== normalizedId) {
      updates.normalizedVideoId = normalizedId
      syncLogger.debug(
        `✅ Updating normalizedVideoId from server ${context.serverConfig.id}: "${currentMovie.normalizedVideoId}" → "${normalizedId}"`
      )
    } else {
      syncLogger.debug(`📝 NormalizedVideoId unchanged: "${normalizedId}"`)
    }
    // The JIT manifest for the same file must key to the same identity, or
    // rows written through the transcoder never join this document.
    warnOnJitIdentityFork(
      {
        videoURL: effectiveVideoUrl,
        jitUrl: ('jitUrl' in updates ? updates.jitUrl : currentMovie.jitUrl) ?? null,
        label: `movie:${originalTitle}`,
      },
      (fields, message) => syncLogger.warn(`${message} ${JSON.stringify(fields)}`)
    )
  }

  // Step 3b: Ingest the backend's content identity and delivery facts.
  //
  // These ride the video block's ownership (see the source-stamp mapping in
  // syncMovieVideo) rather than claiming their own fieldAvailability leaves:
  // they describe the primary source that videoURL points at, so a server
  // that does not own videoURL must not be able to publish them. The server
  // that may declare the video gone mirrors them too: that is what clears them.
  if (fileServerMovieData && (ownsVideo || videoGone)) {
    applyIdentityAndDeliveryUpdates(updates, currentMovie, fileServerMovieData, originalTitle, context)
  }

  // Step 3c: Library-add date (earlier-wins, never later; core/discovery.ts).
  // The backend's first-seen date lives in the identity sidecar on the media
  // volume, so it survives this document being deleted and re-created. It is
  // adopted ONLY when it predates what we hold: a sidecar written at the
  // identity rollout carries the rollout date for a title that was already
  // here, and that must not re-date the title.
  //
  // Every server that has the title's video is heard, not just the video's
  // owner: the earliest date any of them holds is when the title entered the
  // library. Heard from the owner alone, the stored date depended on which
  // server happened to be down when the title was first synced.
  if (fileServerMovieData && (videoUrl != null || videoGone)) {
    const firstSeen = resolveFirstSeen((fileServerMovieData as any).mediaIdentity)
    const claim = claimDiscovery(
      currentMovie.initialDiscoveryDate,
      currentMovie.initialDiscoveryServer,
      firstSeen,
      context.serverConfig.id,
      (heldServerId) => serverOutranks(context.serverConfig, heldServerId)
    )
    if (claim === 'date') updates.initialDiscoveryDate = firstSeen
    if (claim) updates.initialDiscoveryServer = context.serverConfig.id
  }

  // Step 4: Captions. One language belongs to the highest-priority server
  // that lists it; this pass edits the stored map entry by entry (see
  // core/captionReconcile). It used to replace the whole map with the
  // languages this server owns and to do nothing when it listed none, so two
  // servers overwrote each other every run and a removed subtitle stayed
  // once it was the last.
  if (fileServerMovieData) {
    let listedCaptions: Record<string, any> | null = null
    let captionsReadable = true
    try {
      listedCaptions = captionUrls((fileServerMovieData as any)?.urls?.subtitles, context.serverConfig)
    } catch (error) {
      // Not being able to read the list is not the same as an empty list:
      // leave the stored captions alone.
      captionsReadable = false
      syncLogger.error(`Failed to read captions for ${originalTitle}:`, error)
    }

    if (captionsReadable) {
      const serversListing = (language: string) =>
        getServersReportingField(
          context.fieldAvailability,
          'movies',
          originalTitle,
          getCaptionFieldPath(language, 'url')
        )
      const result = reconcileCaptions({
        existing: currentMovie.captionURLs as Record<string, any> | undefined,
        listed: listedCaptions,
        serverId: context.serverConfig.id,
        ownsLanguage: (language) => {
          const servers = serversListing(language)
          return isHighestPriorityAmongServers(
            servers.includes(context.serverConfig.id) ? servers : [...servers, context.serverConfig.id],
            context.serverConfig
          )
        },
        listedByAnyServer: (language) => serversListing(language).length > 0,
        allEnabledServersProbed: allEnabledServersProbed(context),
      })

      if (result.withheld.length > 0) heldBack.push('captionURLs')

      if (result.changed) {
        if (Object.keys(result.captions).length > 0) {
          updates.captionURLs = result.captions
        } else {
          // No captions left: drop the field rather than store an empty map.
          unset.push('captionURLs', 'captionSource')
        }
        syncLogger.debug(
          `✅ Captions for "${originalTitle}" from server ${context.serverConfig.id}: ` +
            `wrote [${result.written.join(', ')}], removed [${result.removed.join(', ')}]`
        )
      }
    }
  }

  // Step 5: Process chapters from file server data. The chapter file belongs
  // to the highest-priority server among those that report one (ties broken
  // on server id); a server the availability map does not list for it never
  // owns it. Removal is field-absence cleanup's, on a run where every
  // enabled server answered (MovieSyncService).
  if (fileServerMovieData) {
    const chapterUrl = chapterUrlOf(originalTitle, fileServerMovieData, context)

    if (
      chapterUrl &&
      isCurrentServerHighestPriorityForReportedField(
        context.fieldAvailability,
        MediaTypesFieldAvailability.Movie,
        originalTitle,
        getFieldPath('chapterURL'),
        context.serverConfig
      )
    ) {
      if (currentMovie.chapterURL !== chapterUrl) {
        updates.chapterURL = chapterUrl
        syncLogger.debug(`✅ Updating chapterURL from server ${context.serverConfig.id}: "${chapterUrl}"`)
      } else {
        syncLogger.debug(
          `📝 ChapterURL unchanged: "${chapterUrl}" (server ${context.serverConfig.id} has priority but value identical)`
        )
      }
    }
  }

  return { updates, unset, heldBack }
}

/**
 * Whether every enabled server answered this run. Only then does "no server
 * reports it" mean the data is gone rather than that a server is down.
 */
function allEnabledServersProbed(context: SyncContext): boolean {
  return (context.allEnabledServersProbed ?? context.cleanup?.allEnabledServersProbed) === true
}

/**
 * Whether this pass may treat "no server has a video for this title" as the
 * video being gone. The server the stored video came from can always say so.
 * Any other server can only on a run in which every enabled server answered:
 * otherwise the owner may simply be down.
 */
function mayDeclareVideoGone(currentMovie: MovieEntity, context: SyncContext): boolean {
  const storedOwner = (currentMovie as any)?.videoSource
  return !storedOwner || storedOwner === context.serverConfig.id || allEnabledServersProbed(context)
}

/**
 * Write the file-facts plan (core/fileFacts) into this step's update and
 * unset lists: a fact is written only when it differs from the stored one,
 * and removed only when the document holds a value for it.
 */
function applyVideoFileFacts(
  updates: any,
  unset: string[],
  currentMovie: MovieEntity,
  plan: FileFactsPlan,
  originalTitle: string
): void {
  const current = currentMovie as any
  for (const fact of plan.unset) {
    if (current[fact] !== undefined && current[fact] !== null) unset.push(fact)
  }
  for (const [fact, value] of Object.entries(plan.set)) {
    const same =
      fact === 'mediaQuality'
        ? isMediaQualityEqual(current.mediaQuality, value as MediaQuality)
        : fact === 'mediaLastModified'
          ? current.mediaLastModified instanceof Date &&
            current.mediaLastModified.getTime() === (value as Date).getTime()
          : current[fact] === value
    if (!same) updates[fact] = value
  }
  if (plan.unreadableModified) {
    syncLogger.warn(`⚠️ Unreadable mediaLastModified in the payload for "${originalTitle}", keeping the stored value`)
  }
}

/**
 * Ingest the backend's content identity (`mediaIdentity.id`) and the
 * delivery facts describing the primary source (`sources[]`,
 * `primaryContainer`, `jitEligible`, `jitUrl`).
 *
 * Two deliberately different write disciplines:
 *
 * - `mediaId` is SET-ONLY. It is durable content identity (folder-derived,
 *   sidecar-persisted); a payload that cannot resolve it emits `null`, which
 *   must never clear a value we already hold. It is also on
 *   FieldAbsenceCleaner's denylist for the same reason.
 *
 * - The delivery facts are MIRRORED: present → set, payload-present-but-
 *   absent → explicit null/false. That mirroring IS the durable off-switch —
 *   when an operator disables JIT on the owning host, the next sync clears
 *   the URL and those titles stop being served through the transcoder.
 *   FieldAbsenceCleaner is the wrong rail for this (it probes all servers
 *   and has no episode-level equivalent), so the owner mirrors instead.
 *
 * Both are gated by the caller on the videoURL priority check, so a server
 * that does not own the video cannot publish either.
 */
function applyIdentityAndDeliveryUpdates(
  updates: any,
  currentMovie: MovieEntity,
  fileServerData: any,
  originalTitle: string,
  context: SyncContext
): void {
  // --- Content identity (set-only) ---
  const incomingMediaId = resolveMediaId(fileServerData.mediaIdentity)
  if (incomingMediaId) {
    if (currentMovie.mediaId && currentMovie.mediaId !== incomingMediaId) {
      // Two servers derive the same id for the same folder by construction,
      // so a mismatch means a sidecar was pinned on one side (e.g. a folder
      // renamed on one server only). The video owner wins; surface it so the
      // divergence is fixable rather than silently absorbed.
      syncLogger.warn(
        `⚠️ mediaId mismatch for "${originalTitle}": stored "${currentMovie.mediaId}" (source ${currentMovie.videoSource}) → incoming "${incomingMediaId}" from server ${context.serverConfig.id}`
      )
    }
    if (currentMovie.mediaId !== incomingMediaId) {
      updates.mediaId = incomingMediaId
    }
  }

  // --- Delivery facts (mirrored) ---
  // Movies nest these under `urls`; each source url goes through the same
  // fileServerUrl as urls.mp4, so a source entry and videoURL can never
  // disagree about host or encoding.
  const facts = resolveDeliveryFacts(
    {
      sources: fileServerData.urls?.sources,
      jitEligible: fileServerData.urls?.jitEligible,
      jitUrl: fileServerData.urls?.jitUrl,
    },
    // The urls.mp4 conversion: the payload's path already carries the server's prefix.
    (url) => fileServerUrl(url, context.serverConfig)
  )

  if (!isEqual(currentMovie.sources ?? null, facts.sources)) {
    updates.sources = facts.sources
  }
  if ((currentMovie.primaryContainer ?? null) !== facts.primaryContainer) {
    updates.primaryContainer = facts.primaryContainer
  }
  if ((currentMovie.jitEligible ?? false) !== facts.jitEligible) {
    updates.jitEligible = facts.jitEligible
  }
  if ((currentMovie.jitUrl ?? null) !== facts.jitUrl) {
    updates.jitUrl = facts.jitUrl
  }
}
