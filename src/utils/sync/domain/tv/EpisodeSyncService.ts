/**
 * Episode sync service — bulk-write pattern with read-merge-replace.
 *
 * Write pattern:
 *  1. Pre-fetch all existing episodes for the season (one query).
 *  2. Pre-fetch the parent TV show + season for showId/seasonId foreign keys.
 *  3. For each episode in file-server data, merge onto existing doc with priority.
 *  4. Flush all episodes with a single EpisodeRepository.bulkUpsertSeason() call.
 *
 * repository.upsert() is NEVER called inside an episode loop.
 */

import {
  EpisodeEntity,
  SyncContext,
  SyncResult,
  SyncStatus,
  MediaType,
  SyncOperation,
  syncEventBus,
  planFieldCleanup,
  resolveMediaId,
  resolveDeliveryFacts,
  type CleanableField,
  type CleanupPlan
} from '../../core'

import {
  EpisodeRepository,
  SeasonRepository,
  TVShowRepository,
  UrlBuilder,
  isTopLevelFieldLocked,
} from '../../infrastructure'
import {
  createFullUrl,
  getServersReportingField,
  isHighestPriorityAmongServers,
  availabilityFingerprintForPrefixes,
  payloadFingerprint,
  seasonsAcrossServers,
  serverOutranks,
} from '@src/utils/sync/utils'
import { fetchMetadataMultiServer } from '@src/utils/admin_utils'
import { generateNormalizedVideoId } from '@src/utils/flatDatabaseUtils'
import { warnOnJitIdentityFork } from '@src/utils/sync/core/jitIdentityParity'
import { seedDiscovery, applyFirstSeen } from '@src/utils/sync/core/discovery'
import { reconcileCaptions } from '@src/utils/sync/core/captionReconcile'
import {
  buildSyncGate,
  readSyncGate,
  changesDocument,
  nextSyncGates,
} from '@src/utils/sync/core/syncGate'
import isEqual from 'lodash/isEqual'
import { createLogger } from '@src/lib/logger'

const pinoLog = createLogger('Sync.TV.Episode')

export class EpisodeSyncService {
  constructor(
    private readonly episodeRepository: EpisodeRepository,
    private readonly seasonRepository: SeasonRepository,
    private readonly tvShowRepository: TVShowRepository
  ) {}

  /**
   * Sync all episodes for one season via a single bulkUpsertSeason call.
   *
   * Pattern:
   *  1. Pre-fetch existing episodes + parent show/season for foreign keys.
   *  2. Build merged EpisodeEntity[] from file-server data + existing docs.
   *  3. episodeRepository.bulkUpsertSeason(entities) once — never per-episode upserts.
   */
  async syncSeason(
    showTitle: string,
    seasonNumber: number,
    context: SyncContext
  ): Promise<SyncResult[]> {
    const results: SyncResult[] = []
    const label = `${showTitle} S${seasonNumber}`

    syncEventBus.emitStarted(label, MediaType.Episode, context.serverConfig.id)

    try {
      const seasonFileData = this.extractSeasonFileData(showTitle, seasonNumber, context)

      if (!seasonFileData) {
        results.push(this.makeResult(label, context, SyncStatus.Skipped, [], [
          'No file server data found for this season'
        ]))
        return results
      }

      // Pre-fetch parent show first to resolve display title and foreign keys
      const parentShow = await this.tvShowRepository.findByOriginalTitle(showTitle)
      const showId = (parentShow as any)?._id || null
      // Use the display title for showTitle on episodes (matches legacy document shape)
      const displayTitle = parentShow?.title || showTitle

      // Find existing episodes and parent season for THIS show. Key on showId, not
      // the shared display title, so a same-titled show's rows don't leak in — and
      // so parentSeason (→ seasonId FK stamped on every episode) is the right show's.
      const [existingEpisodes, parentSeason] = await Promise.all([
        this.episodeRepository.findByShowAndSeason(displayTitle, seasonNumber, showId),
        this.seasonRepository.findSeason(displayTitle, seasonNumber, showId)
      ])

      const existingByNumber = new Map(
        existingEpisodes.map(e => [e.episodeNumber, e])
      )

      const seasonId = (parentSeason as any)?._id || null

      // (The file server's per-episode hashes are no longer fetched here. The
      // episode's skip gate is built from the payload itself — see core/syncGate
      // for why — which also saves one request per season on every full pass.)

      // ---- Accumulate smart upsert ops — do NOT write one by one ----
      // `unset` carries field-absence cleanup (enforce mode only); `cleanupChanges`
      // is the diagnostic text surfaced on the SyncResult in both modes.
      const episodeOps: Array<{
        filter: Record<string, any>
        existing: EpisodeEntity | null
        merged: EpisodeEntity
        unset?: string[]
        cleanupChanges?: string[]
        /**
         * The episode's gate was not stamped: its metadata fetch failed, or a
         * removal was held back because not every server answered this run.
         */
        gateLeftOpen: boolean
        /** The pass changed the episode's data (not just sync bookkeeping). */
        documentChanged: boolean
      }> = []

      for (const [key, fileData] of Object.entries(seasonFileData.episodes || {})) {
        const epNum = this.parseEpisodeNumber(key, fileData)
        if (epNum === null) {
          results.push(this.makeResult(
            `${label}E?`, context, SyncStatus.Skipped, [],
            [`Cannot determine episode number for key "${key}"`]
          ))
          continue
        }

        const existing = existingByNumber.get(epNum) || null

        // Episode skip (core/syncGate): this server's pass over the episode is
        // skipped — no entity build, no HTTP fetch, no write — when neither the
        // payload for the episode nor the who-has-what picture for the episode
        // has changed since its last complete pass, and no other server has
        // changed the document since.
        const leafPrefixes = this.episodeLeafPrefixes(showTitle, seasonNumber, key, context)
        const episodeGate = buildSyncGate(
          // The episode's own entry plus the two season maps that carry its
          // duration and dimensions: everything applied for it.
          payloadFingerprint([
            fileData,
            (seasonFileData as any)?.lengths?.[key],
            (seasonFileData as any)?.dimensions?.[key],
          ]),
          availabilityFingerprintForPrefixes(
            context.fieldAvailability,
            'tv',
            showTitle,
            leafPrefixes.map((prefix) => `${prefix}.`)
          )
        )

        if (
          !context.forceSync &&
          existing &&
          readSyncGate(existing as any, context.serverConfig.id) === episodeGate
        ) {
          // The episode's own data is current, but it also carries a copy of
          // its parents: the show's display title and its season's id. Those
          // change without the episode's payload moving (the show's title
          // arrives with a later server's metadata; a season document is
          // re-created). Refresh just those, with no rebuild and no fetch.
          // (A re-created SHOW is not handled here: its episodes are looked up
          // by the new show id above, so the old ones are not found at all.)
          const sameId = (a: any, b: any) => String(a ?? '') === String(b ?? '')
          const relinked: any = { ...existing, showTitle: displayTitle }
          if (seasonId && !sameId((existing as any).seasonId, seasonId)) relinked.seasonId = seasonId
          // Judged on what will actually be written: a locked field is dropped
          // on the way to the database, and reporting a change that never lands
          // would reset the other servers' gates on every run.
          if (changesDocument(existing as any, relinked)) {
            episodeOps.push({
              // Matched on the document itself: the keys being corrected cannot find it.
              filter: { _id: (existing as any)._id },
              existing,
              merged: relinked,
              cleanupChanges: ['Refreshed the parent show link'],
              gateLeftOpen: false,
              documentChanged: true,
            })
          } else {
            results.push(this.makeResult(`${label}E${epNum}`, context, SyncStatus.Skipped, [], []))
          }
          continue
        }

        const { entity: merged, metadataFromFreshFetch, unset: builtUnset, withheld: builtWithheld, fetchIncomplete } = await this.buildEpisodeEntity(showTitle, displayTitle, seasonNumber, epNum, fileData, context, existing, showId, seasonId, parentShow, seasonFileData, key)

        // Filter shape mirrors bulkUpsertSeason: prefer showId for stability
        const filter = (merged as any).showId
          ? { showId: (merged as any).showId, seasonNumber: merged.seasonNumber, episodeNumber: merged.episodeNumber }
          : { showTitle: merged.showTitle, seasonNumber: merged.seasonNumber, episodeNumber: merged.episodeNumber }

        // Field-absence cleanup. `showTitle` here is the originalTitle (filesystem
        // key) — the fieldAvailability key. planFieldCleanup logs (both modes) and
        // returns `unset` only in enforce mode.
        const plan = this.planEpisodeCleanup(showTitle, seasonNumber, key, existing, displayTitle, epNum, context)
        const unset = [...new Set([...(plan.unset ?? []), ...builtUnset])]

        // Stamp this server's gate. Only a complete pass may: a failed metadata
        // fetch (or the inline parent fallback, which is display-only) would
        // lock the episode on stale metadata, and a removal held back because
        // not every server answered has to be retried on a run where they do.
        // A pass that changed the episode drops the other servers' gates either
        // way.
        const removalWithheld = builtWithheld || plan.withheld === true
        const documentChanged = changesDocument(existing as any, merged as any, unset)
        const gateToStamp = metadataFromFreshFetch && !removalWithheld && !fetchIncomplete ? episodeGate : null
        const storedGates = ((existing as any)?.syncGates ?? {}) as Record<string, string>
        const gates = nextSyncGates(storedGates, context.serverConfig.id, gateToStamp, documentChanged)
        if (!existing || !isEqual(gates, storedGates)) (merged as any).syncGates = gates

        episodeOps.push({
          filter,
          existing,
          merged,
          unset,
          cleanupChanges: plan.changes,
          gateLeftOpen: !gateToStamp,
          documentChanged,
        })
      }

      // ---- Single smart bulk write — skips unchanged, $sets changed, inserts new ----
      if (episodeOps.length > 0) {
        await this.episodeRepository.smartBulkUpsert(episodeOps)
      }

      for (const { merged: entity, cleanupChanges, gateLeftOpen, documentChanged } of episodeOps) {
        results.push(this.makeResult(
          `${label}E${entity.episodeNumber}`, context,
          SyncStatus.Completed,
          [`Upserted episode ${entity.episodeNumber}`, ...(cleanupChanges || [])], [],
          {
            displayTitle: entity.showTitle,
            seasonNumber: entity.seasonNumber,
            episodeNumber: entity.episodeNumber,
            // Read by TVShowSyncService when it decides the show's own gate.
            ...(gateLeftOpen ? { gateLeftOpen: true } : {}),
            ...(documentChanged ? { documentChanged: true } : {}),
          }
        ))
      }

      syncEventBus.emitComplete(label, MediaType.Episode, context.serverConfig.id, undefined, {
        totalOperations: episodeOps.length,
        successful: episodeOps.length,
        failed: 0
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      const stack = error instanceof Error ? error.stack : undefined
      syncEventBus.emitError(label, MediaType.Episode, context.serverConfig.id, msg, SyncOperation.Content)
      // emitError only fans out to SSE — log explicitly via Pino so the
      // failure surfaces in SigNoz instead of being silently counted.
      pinoLog.error(
        { label, serverId: context.serverConfig.id, err: msg, stack },
        `Episode sync failed: ${label}`
      )
      // An unordered bulk write can apply some of its operations before it
      // fails. What landed is unknown, so the show is reported as changed: the
      // other servers' gates on it are reset rather than trusted.
      results.push(this.makeResult(label, context, SyncStatus.Failed, [], [msg], { documentChanged: true }))
    }

    return results
  }

  /**
   * Sync all seasons (and their episodes) for a show.
   * Each season triggers exactly one bulkUpsertSeason() call.
   */
  async syncShow(showTitle: string, context: SyncContext): Promise<SyncResult[]> {
    const showData = context.fileServerData?.tv?.[showTitle]
    if (!showData) {
      return [this.makeResult(showTitle, context, SyncStatus.Skipped, [], [
        'No file server data found for this show'
      ])]
    }

    const allResults: SyncResult[] = []
    for (const key of Object.keys(showData.seasons || {})) {
      const seasonNumber = this.parseSeasonNumber(key)
      if (seasonNumber === null) continue
      allResults.push(...await this.syncSeason(showTitle, seasonNumber, context))
    }
    return allResults
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private extractSeasonFileData(showTitle: string, seasonNumber: number, context: SyncContext): any {
    const showData = context.fileServerData?.tv?.[showTitle]
    if (!showData?.seasons) return null

    for (const candidate of [
      String(seasonNumber),
      `Season ${seasonNumber}`,
      `season_${seasonNumber}`,
      `S${String(seasonNumber).padStart(2, '0')}`
    ]) {
      if (showData.seasons[candidate]) return showData.seasons[candidate]
    }

    for (const [key, data] of Object.entries(showData.seasons)) {
      if (this.parseSeasonNumber(key) === seasonNumber) return data
    }
    return null
  }

  /**
   * Resolve the LITERAL season key used in the file-server data (e.g. "Season 2",
   * "2", "S02") for this season number. Field-absence cleanup builds compound
   * fieldAvailability paths (`seasons.<seasonKey>.episodes.<epKey>.<field>`), and
   * those paths must use the exact keys collectFieldAvailability walked — guessing
   * the format would make every lookup miss and report false absences. Mirrors the
   * candidate order of extractSeasonFileData but returns the key, not the data.
   */
  private resolveSeasonKey(showTitle: string, seasonNumber: number, context: SyncContext): string | null {
    const showData = context.fileServerData?.tv?.[showTitle]
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
      if (this.parseSeasonNumber(key) === seasonNumber) return key
    }
    return null
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
  private episodeLeafPrefixes(
    showOriginalTitle: string,
    seasonNumber: number,
    episodeKey: string | undefined,
    context: SyncContext
  ): string[] {
    if (!episodeKey) return []
    const ownKey = this.resolveSeasonKey(showOriginalTitle, seasonNumber, context)
    const otherKeys =
      seasonsAcrossServers(context.fieldAvailability, showOriginalTitle).get(seasonNumber)?.keys ?? []
    const seasonKeys = [...new Set([...(ownKey ? [ownKey] : []), ...otherKeys])]
    return seasonKeys.map((seasonKey) => `seasons.${seasonKey}.episodes.${episodeKey}`)
  }

  /** The servers reporting one of an episode's fields, under any of its prefixes. */
  private serversReportingEpisodeField(
    leafPrefixes: string[],
    field: string,
    showOriginalTitle: string,
    context: SyncContext
  ): string[] {
    return [
      ...new Set(
        leafPrefixes.flatMap((prefix) =>
          getServersReportingField(context.fieldAvailability, 'tv', showOriginalTitle, `${prefix}.${field}`)
        )
      ),
    ]
  }

  /**
   * Whether the syncing server owns one of an episode's fields: it has a value
   * for it and no higher-priority server reports the same field.
   *
   * Every episode field used to be checked against a bare name ('thumbnail',
   * 'chapters', 'metadata') that no availability map ever contains, and the
   * priority helper answers "anyone may write" for a path nobody reports. So
   * with two servers each one overwrote the other's thumbnail, chapters,
   * metadata and captions on every run, and the result was whichever synced
   * last.
   *
   * When the literal paths cannot be built the server is ranked against no
   * one, which is the old permissive behavior for that episode only; it is
   * logged.
   */
  private ownsEpisodeField(
    leafPrefixes: string[],
    field: string,
    hasValue: boolean,
    showOriginalTitle: string,
    context: SyncContext
  ): boolean {
    if (!hasValue) return false
    const reporters = this.serversReportingEpisodeField(leafPrefixes, field, showOriginalTitle, context)
    const serversWithValue = reporters.includes(context.serverConfig.id)
      ? reporters
      : [...reporters, context.serverConfig.id]
    return isHighestPriorityAmongServers(serversWithValue, context.serverConfig)
  }

  /**
   * Build the field-absence cleanup candidates for one episode. Returns the
   * fields to $unset (enforce) and human-readable diagnostics (both modes), or
   * null when cleanup is disabled / not applicable. Conservative scope for the
   * initial rollout: thumbnail + chapters (asset URLs). videoURL is deliberately
   * EXCLUDED — clearing a video is higher-stakes and warrants its own rollout.
   */
  private planEpisodeCleanup(
    showOriginalTitle: string,
    seasonNumber: number,
    episodeKey: string,
    existing: EpisodeEntity | null,
    displayTitle: string,
    episodeNumber: number,
    context: SyncContext
  ): CleanupPlan {
    if (!context.cleanup?.enabled || !existing) return { changes: [] }

    // Every literal prefix the episode has across the servers: a field is absent
    // only when no server reports it under any of them.
    const [prefix, ...otherPrefixes] = this.episodeLeafPrefixes(showOriginalTitle, seasonNumber, episodeKey, context)
    if (!prefix) return { changes: [] }  // can't build a trustworthy path → skip (no guessing)

    const fields: CleanableField[] = [
      {
        entityField: 'thumbnail',
        fieldPath: `${prefix}.thumbnail`,
        alsoReportedAs: otherPrefixes.map((other) => `${other}.thumbnail`),
        companions: ['thumbnailSource', 'thumbnailBlurhash', 'thumbnailBlurhashSource'],
      },
      {
        entityField: 'chapterURL',
        fieldPath: `${prefix}.chapters`,
        alsoReportedAs: otherPrefixes.map((other) => `${other}.chapters`),
        companions: ['chapterSource'],
      },
    ]

    return planFieldCleanup({
      cleanup: context.cleanup,
      mediaType: 'tv',
      availabilityKey: showOriginalTitle,
      entity: existing,
      fieldAvailability: context.fieldAvailability,
      fields,
      log: (obj, msg) => pinoLog.info(obj, msg),
      logContext: { show: displayTitle, originalTitle: showOriginalTitle, season: seasonNumber, episode: episodeNumber },
    })
  }

  /**
   * Build an episode entity by merging existing data with incoming file-server
   * data, respecting per-field server priority.
   *
   * Key differences from naive field copy:
   *  - fileData.metadata is a URL path, not inline data — must be fetched via
   *    fetchMetadataMultiServer. Fallback: parent show's metadata.seasons[].episodes[].
   *  - fileData.thumbnailBlurhash is a URL path to a blurhash file, not the actual
   *    blurhash string. Existing values are preserved from the spread; BlurhashStrategy
   *    handles fetching actual values.
   */
  private async buildEpisodeEntity(
    showOriginalTitle: string,
    displayTitle: string,
    seasonNumber: number,
    episodeNumber: number,
    fileData: any,
    context: SyncContext,
    existing: EpisodeEntity | null,
    showId: any,
    seasonId: any,
    parentShow: any,
    seasonFileData?: any,
    episodeFileName?: string
  ): Promise<{
    entity: EpisodeEntity
    metadataFromFreshFetch: boolean
    unset: string[]
    /** A removal was held back because not every enabled server answered. */
    withheld: boolean
    /** A blurhash the file server publishes could not be fetched this pass. */
    fetchIncomplete: boolean
  }> {
    const now = new Date()
    let withheld = false
    let fetchIncomplete = false
    // Fields whose data is gone (not changed) and must be removed from the
    // stored document. An admin lock keeps a field.
    const unset: string[] = []
    const clearField = (field: string) => {
      if (isTopLevelFieldLocked((existing as any)?.lockedFields, field)) return
      delete (entity as any)[field]
      if (existing && (existing as any)[field] !== undefined) unset.push(field)
    }

    // Start from existing doc (preserving ALL fields) or create new
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
    seedDiscovery(entity, existing, context.serverConfig.id, now)
    if (showId) entity.showId = showId
    if (seasonId) entity.seasonId = seasonId
    // Use display title as showTitle (matches legacy document shape)
    entity.showTitle = displayTitle

    // --- Video URL (owned by the highest-priority server that has the episode) ---
    const leafPrefixes = this.episodeLeafPrefixes(showOriginalTitle, seasonNumber, episodeFileName, context)
    if (leafPrefixes.length === 0) {
      pinoLog.warn(
        { showOriginalTitle, seasonNumber, episodeNumber, serverId: context.serverConfig.id },
        'Cannot build the availability path for this episode; field ownership is not ranked against other servers'
      )
    }
    const owns = (field: string, hasValue: boolean) =>
      this.ownsEpisodeField(leafPrefixes, field, hasValue, showOriginalTitle, context)
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
        entity.videoURL = createFullUrl(fileData.videoURL, context.serverConfig)
        entity.videoSource = context.serverConfig.id
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
          pinoLog.warn(
            {
              showOriginalTitle,
              seasonNumber,
              episodeNumber,
              storedMediaId: existing.mediaId,
              incomingMediaId,
              serverId: context.serverConfig.id,
            },
            'mediaId mismatch for episode — video owner wins'
          )
        }
        entity.mediaId = incomingMediaId
      }

      // Episodes carry these flat; source urls go through the same
      // createFullUrl transform as videoURL above.
      const facts = resolveDeliveryFacts(fileData, (url) =>
        createFullUrl(url, context.serverConfig)
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
        (fields, message) => pinoLog.warn(fields, message)
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
      applyFirstSeen(entity, fileData.mediaIdentity, context.serverConfig.id, now, (heldServerId) =>
        serverOutranks(context.serverConfig, heldServerId)
      )
    }

    // --- Video info (follows video priority) ---
    if (canUpdateVideo && fileData?.videoInfo && typeof fileData.videoInfo === 'object') {
      entity.videoInfo = fileData.videoInfo
      entity.videoInfoSource = context.serverConfig.id
    }

    // --- Facts about the video file (flat, matching legacy document shape) ---
    // duration, dimensions, hdr, size, mediaQuality, mediaLastModified describe
    // the file videoURL points at, so they come from the server that owns the
    // video: a value in its payload is written, and a value its probe did not
    // report is removed. They used to be set-if-present, which left "HDR10" on
    // an episode whose file was replaced by an SDR one (the payload says
    // hdr: null) and the old file's numbers on anything the new payload lacked.
    //
    // Removing needs evidence that the probe ran. A file server that cannot
    // probe a file still publishes the episode, with hdr, mediaQuality, length
    // and dimensions null and an empty additionalMetadata (a file being
    // replaced in place, a starved disk). That is not "these facts are gone" —
    // the file is there and its facts are unknown this scan — and the stored
    // ones are left alone. A probed video always has a duration, so a duration
    // in the season's lengths map is the evidence: with one, `hdr: null` means
    // the file is SDR; without one, it means nothing.
    if (canUpdateVideo) {
      const duration =
        seasonFileData?.lengths && episodeFileName ? seasonFileData.lengths[episodeFileName] : undefined
      const probed = duration !== undefined && duration !== null
      // The stored facts describe the stored URL. When this pass points the
      // episode at another file (another server's, or a replacement under a
      // new name) they are not that file's, probed or not.
      const differentFile =
        Boolean(existing) &&
        !isTopLevelFieldLocked((existing as any)?.lockedFields, 'videoURL') &&
        existing!.videoURL !== entity.videoURL
      const mirror = (field: string, incoming: unknown) => {
        if (incoming === undefined || incoming === null || incoming === '') {
          if (probed || differentFile) clearField(field)
        } else {
          (entity as any)[field] = incoming
        }
      }

      mirror('duration', duration)
      mirror(
        'dimensions',
        seasonFileData?.dimensions && episodeFileName ? seasonFileData.dimensions[episodeFileName] : undefined
      )
      mirror('hdr', fileData?.hdr)

      // Size arrives as bytes, or as a {kb, mb, gb} object that is converted to
      // bytes to match the movie path (MovieContentStrategy), so consumers can
      // treat `size` as bytes for both media types.
      let size: number | undefined
      if (typeof fileData?.size === 'number') {
        size = fileData.size
      } else {
        const sz = fileData?.additionalMetadata?.size
        if (typeof sz === 'number') size = sz
        else if (sz && typeof sz === 'object') {
          if (typeof sz.gb === 'number') size = Math.round(sz.gb * 1024 * 1024 * 1024)
          else if (typeof sz.mb === 'number') size = Math.round(sz.mb * 1024 * 1024)
          else if (typeof sz.kb === 'number') size = Math.round(sz.kb * 1024)
        }
      }
      mirror('size', size)
      mirror('mediaQuality', fileData?.mediaQuality || undefined)

      // The file's modified time is set when the payload has one and otherwise
      // left alone: a file that exists has one, so its absence is a failed
      // stat, not a fact.
      if (fileData?.mediaLastModified) {
        const modified = new Date(fileData.mediaLastModified)
        if (Number.isNaN(modified.getTime())) {
          pinoLog.warn(
            { showOriginalTitle, seasonNumber, episodeNumber, value: fileData.mediaLastModified },
            'Unreadable mediaLastModified in the episode payload, keeping the stored value'
          )
        } else {
          entity.mediaLastModified = modified
        }
      }

      entity.videoInfoSource = context.serverConfig.id
    }

    // --- Thumbnail (priority-gated) ---
    const canUpdateThumbnail = owns('thumbnail', Boolean(fileData?.thumbnail || fileData?.thumbnailURL))
    if (canUpdateThumbnail) {
      entity.thumbnail = createFullUrl(
        fileData.thumbnail || fileData.thumbnailURL,
        context.serverConfig
      )
      entity.thumbnailSource = context.serverConfig.id
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
            ? UrlBuilder.processCaptionURLs(fileData.subtitles, context.serverConfig)
            : null
      } catch (error) {
        // Not being able to read the list is not the same as an empty list.
        captionsReadable = false
        pinoLog.error(
          { showOriginalTitle, seasonNumber, episodeNumber, err: error instanceof Error ? error.message : String(error) },
          'Failed to read the episode captions, leaving the stored ones alone'
        )
      }

      if (captionsReadable && !isTopLevelFieldLocked((existing as any)?.lockedFields, 'captionURLs')) {
        const serversListing = (language: string) =>
          this.serversReportingEpisodeField(
            leafPrefixes, `subtitles.${language}.url`, showOriginalTitle, context
          )
        const result = reconcileCaptions({
          existing: existing?.captionURLs as Record<string, any> | undefined,
          listed: listedCaptions,
          serverId: context.serverConfig.id,
          ownsLanguage: (language) => owns(`subtitles.${language}.url`, true),
          listedByAnyServer: (language) => serversListing(language).length > 0,
          // Without the literal path nothing can be said about other servers.
          allEnabledServersProbed:
            leafPrefixes.length > 0 &&
            (context.allEnabledServersProbed ?? context.cleanup?.allEnabledServersProbed) === true,
        })
        if (result.withheld.length > 0) withheld = true

        if (result.changed) {
          const languages = Object.keys(result.captions).sort()
          if (languages.length > 0) {
            entity.captionURLs = result.captions as any
            // Named from the map itself, so it does not depend on which
            // server's pass ran last.
            entity.captionSource = (result.captions[languages[0]] as any)?.sourceServerId ?? context.serverConfig.id
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
      entity.chapterURL = createFullUrl(fileData.chapters, context.serverConfig)
      entity.chapterSource = context.serverConfig.id
    }

    // --- Metadata (priority-gated) ---
    // Tracks whether episode metadata came from a CONFIRMED fresh source (URL
    // fetch ok, or backend-inlined object) vs. the parent inline fallback or a
    // failure. Only a fresh source may advance the syncHash gate — the inline
    // fallback is fine for display but must not lock the episode on a stale
    // parent. Default true so "no episode metadata URL" never blocks the gate.
    let metadataFromFreshFetch = true
    const canUpdateMetadata = owns('metadata', Boolean(fileData?.metadata))
    if (canUpdateMetadata) {
      // fileData.metadata is typically a URL path — fetch actual metadata from file server
      let episodeMetadata: any = null

      if (typeof fileData.metadata === 'string') {
        try {
          episodeMetadata = await fetchMetadataMultiServer(
            context.serverConfig.id,
            fileData.metadata,
            'file',
            'tv',
            showOriginalTitle
          )
        } catch {
          // Fetch failed — try fallback below
        }
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

      // Metadata an admin locked stays as stored: the fetched copy is dropped
      // on the way to the database, and the title below is taken from what the
      // document actually holds.
      if (
        episodeMetadata && typeof episodeMetadata === 'object' && !episodeMetadata.error &&
        !isTopLevelFieldLocked((existing as any)?.lockedFields, 'metadata')
      ) {
        entity.metadata = episodeMetadata
        entity.metadataSource = context.serverConfig.id
      }
    }

    // --- Thumbnail blurhash ---
    // A stored blurhash is good only while it is OF THE STORED THUMBNAIL:
    // taken from the server that owns the thumbnail, and not older than it.
    // One that is not is replaced, and when this pass has nothing to replace
    // it with (no blurhash published for the thumbnail, or the fetch failed)
    // it is removed. A failed fetch is reported, so the episode is not skipped
    // from now on without it.
    const lockedField = (field: string) => isTopLevelFieldLocked((existing as any)?.lockedFields, field)
    if (canUpdateThumbnail && !lockedField('thumbnail') && !lockedField('thumbnailBlurhash')) {
      const stored = existing?.thumbnailBlurhash
      const notOfThisImage =
        Boolean(stored) &&
        (entity.thumbnail !== existing?.thumbnail ||
          (existing as any)?.thumbnailBlurhashSource !== context.serverConfig.id)

      let blurhash: unknown = null
      if (fileData?.thumbnailBlurhash && (!stored || notOfThisImage)) {
        try {
          blurhash = await fetchMetadataMultiServer(
            context.serverConfig.id,
            createFullUrl(fileData.thumbnailBlurhash, context.serverConfig),
            'blurhash',
            'tv',
            showOriginalTitle
          )
        } catch {
          // Reported below.
        }
        if (!(blurhash && typeof blurhash === 'string')) {
          blurhash = null
          fetchIncomplete = true
        }
      }

      if (blurhash) {
        entity.thumbnailBlurhash = blurhash as string
        entity.thumbnailBlurhashSource = context.serverConfig.id
      } else if (notOfThisImage) {
        clearField('thumbnailBlurhash')
        clearField('thumbnailBlurhashSource')
      }
    }

    // --- Title: the metadata's name when the episode has one, otherwise the
    // video owner's reading of the filename. ---
    // Decided here, from what the document ends up holding, so it does not
    // depend on which server created the episode or synced last.
    const metadataName = (entity.metadata as any)?.name
    if (typeof metadataName === 'string' && metadataName.trim()) {
      entity.title = metadataName
    } else if (canUpdateVideo) {
      entity.title = fileData?.title || fileData?.derivedEpisodeName || `Episode ${episodeNumber}`
    }

    return { entity, metadataFromFreshFetch, unset: [...new Set(unset)], withheld, fetchIncomplete }
  }

  /**
   * The episode number for one entry of a season's episodes map.
   *
   * The file server sends it as a number; that wins, and 0 is a real episode
   * number (a pilot or special filed as E00). The key is only a fallback, and
   * it is read as "S01E05" → 5 first. The old fallback took the first run of
   * digits in the key, which for "S01E05" is the SEASON, and it also sent an
   * episode numbered 0 down that path — so "S01E00" was synced as episode 1,
   * on top of the real one.
   */
  private parseEpisodeNumber(key: string, data: any): number | null {
    if (Number.isInteger(data?.episodeNumber) && data.episodeNumber >= 0) return data.episodeNumber
    const coordinate = key.match(/S\d+E(\d+)/i) ?? key.match(/\b\d+x(\d+)\b/i)
    if (coordinate) return parseInt(coordinate[1], 10)
    // Keys with a single number in them: "episode_5", "5 - Pilot.mp4",
    // "Show - 05.mkv". With more than one there is no telling which is the
    // episode, and guessing is how "S01E00" became episode 1.
    const numbers = key.replace(/\.[a-z0-9]{2,4}$/i, '').match(/\d+/g)
    return numbers && numbers.length === 1 ? parseInt(numbers[0], 10) : null
  }

  private parseSeasonNumber(key: string): number | null {
    const match = key.match(/(?:season_?|s)?(\d+)/i)
    const n = match ? parseInt(match[1], 10) : NaN
    return n >= 0 ? n : null
  }

  private makeResult(
    entityId: string,
    context: SyncContext,
    status: SyncStatus,
    changes: string[],
    errors: string[],
    metadata?: Record<string, any>
  ): SyncResult {
    return {
      status,
      entityId,
      mediaType: MediaType.Episode,
      operation: SyncOperation.Content,
      serverId: context.serverConfig.id,
      timestamp: new Date(),
      changes,
      errors,
      // Display title + season/episode numbers for post-sync cache invalidation
      // (episode page tags key on display title, not the filesystem showTitle).
      ...(metadata ? { metadata } : {})
    }
  }
}
