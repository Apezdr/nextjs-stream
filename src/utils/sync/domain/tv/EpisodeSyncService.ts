/**
 * Episode sync service — bulk-write pattern with read-merge-replace.
 *
 * Write pattern:
 *  1. Pre-fetch all existing episodes for the season (one query) and the
 *     parent season (seasonId foreign key). The parent show (showId foreign
 *     key, display title, metadata) is handed in as stored: TVShowSyncService
 *     reads it once, after the show's write.
 *  2. For each episode in file-server data, a write plan over the existing
 *     doc, with priority, merged with field-absence cleanup's (core/writePlan).
 *  3. Flush all episodes with a single EpisodeRepository.smartBulkUpsert()
 *     call: one op per episode, the batching in the repository.
 *
 * repository.upsert() is NEVER called inside an episode loop.
 */

import {
  EpisodeEntity,
  SyncResult,
  SyncStatus,
  MediaType,
  SyncOperation,
  syncEventBus,
  planFieldCleanup,
  resolveMediaId,
  resolveDeliveryFacts,
  type Availability,
  type CleanableField,
  type CleanupPlan,
  type PlanOutcome,
  type RunConfig,
  type TVPassParts,
  type TVShowEntity
} from '../../core'

import {
  EpisodeRepository,
  SeasonRepository,
  captionUrls,
  fetchMetadataMultiServer,
  fileServerUrl,
  isTopLevelFieldLocked,
} from '../../infrastructure'
import {
  getServersReportingField,
  isHighestPriorityAmongServers,
  seasonsAcrossServers,
  serverOutranks,
} from '@src/utils/sync/core/ownership'
import {
  availabilityFingerprintForPrefixes,
  payloadFingerprint,
} from '@src/utils/sync/core/syncGate'
import { generateNormalizedVideoId } from '@src/utils/flatDatabaseUtils'
import { warnOnJitIdentityFork } from '@src/utils/sync/core/jitIdentityParity'
import { seedDiscovery, applyFirstSeen } from '@src/utils/sync/core/discovery'
import { reconcileCaptions } from '@src/utils/sync/core/captionReconcile'
import { resolveBlurhash } from '@src/utils/sync/core/imageAndBlurhash'
import { effectiveMetadata } from '@src/utils/sync/core/metadataLock'
import { planVideoFileFacts, sizeInBytes, videoFileChanged } from '@src/utils/sync/core/fileFacts'
import {
  buildSyncGate,
  readSyncGate,
  changesDocument,
  nextSyncGates,
} from '@src/utils/sync/core/syncGate'
import { applyWritePlan, cleanupWritePlan, draftWritePlan, emptyWritePlan, mergeWritePlans } from '@src/utils/sync/core/writePlan'
import isEqual from 'lodash/isEqual'
import { createLogger } from '@src/lib/logger'

const pinoLog = createLogger('Sync.TV.Episode')

/**
 * What planEpisode reads of the run, besides the availability: not forceSync
 * (the episode's gate is checked before it runs), not the cleanup config
 * (field-absence cleanup plans apart).
 */
export type EpisodePlanRun = Pick<RunConfig, 'serverConfig' | 'allEnabledServersProbed'>

export class EpisodeSyncService {
  constructor(
    private readonly episodeRepository: EpisodeRepository,
    private readonly seasonRepository: SeasonRepository
  ) {}

  /**
   * Sync all episodes for one season via a single smartBulkUpsert call.
   *
   * Pattern:
   *  1. Pre-fetch existing episodes + parent season for its foreign key.
   *  2. One write plan per episode, from file-server data + its existing doc.
   *  3. episodeRepository.smartBulkUpsert(ops) once — never per-episode upserts.
   *
   * @param payload - This server's payload for the show (`fileServer.tv[showTitle]`)
   * @param parts - The pass's run and availability (core/types)
   * @param parentShow - The show as stored after this pass's show write
   *   (TVShowSyncService), or null when there is none
   */
  async syncSeason(
    showTitle: string,
    seasonNumber: number,
    payload: any,
    { run, availability }: TVPassParts,
    parentShow: TVShowEntity | null
  ): Promise<SyncResult[]> {
    const results: SyncResult[] = []
    const label = `${showTitle} S${seasonNumber}`

    syncEventBus.emitStarted(label, MediaType.Episode, run.serverConfig.id)

    try {
      const seasonFileData = this.extractSeasonFileData(payload, seasonNumber)

      if (!seasonFileData) {
        results.push(this.makeResult(label, run, SyncStatus.Skipped, [], [
          'No file server data found for this season'
        ]))
        return results
      }

      // The parent show resolves the display title and the showId foreign key.
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
            `${label}E?`, run, SyncStatus.Skipped, [],
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
        const leafPrefixes = this.episodeLeafPrefixes(showTitle, seasonNumber, key, payload, availability)
        const episodeGate = buildSyncGate(
          // The episode's own entry plus the two season maps that carry its
          // duration and dimensions: everything applied for it.
          payloadFingerprint([
            fileData,
            (seasonFileData as any)?.lengths?.[key],
            (seasonFileData as any)?.dimensions?.[key],
          ]),
          availabilityFingerprintForPrefixes(
            availability.fieldAvailability,
            'tv',
            showTitle,
            leafPrefixes.map((prefix) => `${prefix}.`)
          )
        )

        if (
          !run.forceSync &&
          existing &&
          readSyncGate(existing as any, run.serverConfig.id) === episodeGate
        ) {
          // The episode's own data is current, but it also carries a copy of
          // its parents: the show's display title and its season's id. Those
          // change without the episode's payload moving (the show's title
          // arrives with a later server's metadata; a season document is
          // re-created). Refresh just those, with no rebuild and no fetch.
          // (A re-created SHOW is not handled here: its episodes are looked up
          // by the new show id above, so the old ones are not found at all.)
          // A plan of its own, which does not stamp lastSynced (wroteDocument
          // false): only the parents' copies are written.
          const sameId = (a: any, b: any) => String(a ?? '') === String(b ?? '')
          const relink: PlanOutcome<EpisodeEntity> = {
            plan: {
              ...emptyWritePlan<EpisodeEntity>(),
              set: {
                showTitle: displayTitle,
                ...(seasonId && !sameId((existing as any).seasonId, seasonId) ? { seasonId } : {}),
              },
            },
            wroteDocument: false,
          }
          const relinked = applyWritePlan(existing, relink.plan)
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
            results.push(this.makeResult(`${label}E${epNum}`, run, SyncStatus.Skipped, [], []))
          }
          continue
        }

        const built = await this.planEpisode(showTitle, displayTitle, seasonNumber, epNum, fileData, payload, run, availability, existing, showId, seasonId, parentShow, seasonFileData, key)
        // The document the plan leaves. Field-absence cleanup's removals are
        // not taken out of it: they go to the write as $unset.
        const merged = applyWritePlan(existing, built.plan)

        // Filter shape mirrors bulkUpsertSeason: prefer showId for stability
        const filter = (merged as any).showId
          ? { showId: (merged as any).showId, seasonNumber: merged.seasonNumber, episodeNumber: merged.episodeNumber }
          : { showTitle: merged.showTitle, seasonNumber: merged.seasonNumber, episodeNumber: merged.episodeNumber }

        // Field-absence cleanup. `showTitle` here is the originalTitle (filesystem
        // key) — the fieldAvailability key. planFieldCleanup logs (both modes) and
        // returns `unset` only in enforce mode.
        const cleanup = this.planEpisodeCleanup(showTitle, seasonNumber, key, existing, displayTitle, epNum, payload, run, availability)
        // One plan for the episode's write (core/writePlan): the cleanup's
        // removals first, then the builder's plan.
        const episodePlan = mergeWritePlans<EpisodeEntity>(
          [cleanupWritePlan(cleanup), built.plan],
          `${label}E${epNum}`
        )
        const unset = episodePlan.unset

        // Stamp this server's gate. Only a complete pass may (the merged
        // plan's `incomplete`, decideGate): a failed metadata fetch (or the
        // inline parent fallback, which is display-only) would lock the
        // episode on stale metadata, a removal held back because not every
        // server answered has to be retried on a run where they do, and so
        // does a blurhash that could not be fetched. A pass that changed the
        // episode drops the other servers' gates either way.
        const documentChanged = changesDocument(existing as any, merged as any, unset)
        const gateToStamp = episodePlan.gate === 'stamp' ? episodeGate : null
        const storedGates = ((existing as any)?.syncGates ?? {}) as Record<string, string>
        const gates = nextSyncGates(storedGates, run.serverConfig.id, gateToStamp, documentChanged)
        if (!existing || !isEqual(gates, storedGates)) (merged as any).syncGates = gates

        episodeOps.push({
          filter,
          existing,
          merged,
          unset,
          cleanupChanges: cleanup.changes,
          gateLeftOpen: !gateToStamp,
          documentChanged,
        })
      }

      // ---- Single smart bulk write — skips unchanged, $sets changed, inserts new ----
      if (episodeOps.length > 0) {
        await this.episodeRepository.smartBulkUpsert(episodeOps)
      }

      for (const { merged: entity, existing, cleanupChanges, gateLeftOpen, documentChanged } of episodeOps) {
        results.push(this.makeResult(
          `${label}E${entity.episodeNumber}`, run,
          SyncStatus.Completed,
          [`Upserted episode ${entity.episodeNumber}`, ...(cleanupChanges || [])], [],
          {
            displayTitle: entity.showTitle,
            seasonNumber: entity.seasonNumber,
            episodeNumber: entity.episodeNumber,
            // Read by TVShowSyncService when it decides the show's own gate.
            ...(gateLeftOpen ? { gateLeftOpen: true } : {}),
            ...(documentChanged ? { documentChanged: true } : {}),
            // No document existed before this write (counted for the admins'
            // sync notice).
            ...(existing ? {} : { created: true }),
          }
        ))
      }

      syncEventBus.emitComplete(label, MediaType.Episode, run.serverConfig.id, undefined, {
        totalOperations: episodeOps.length,
        successful: episodeOps.length,
        failed: 0
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      const stack = error instanceof Error ? error.stack : undefined
      syncEventBus.emitError(label, MediaType.Episode, run.serverConfig.id, msg, SyncOperation.Content)
      // emitError only fans out to SSE — log explicitly via Pino so the
      // failure surfaces in SigNoz instead of being silently counted.
      pinoLog.error(
        { label, serverId: run.serverConfig.id, err: msg, stack },
        `Episode sync failed: ${label}`
      )
      // An unordered bulk write can apply some of its operations before it
      // fails. What landed is unknown, so the show is reported as changed: the
      // other servers' gates on it are reset rather than trusted.
      results.push(this.makeResult(label, run, SyncStatus.Failed, [], [msg], { documentChanged: true }))
    }

    return results
  }

  /**
   * Sync all seasons (and their episodes) for a show.
   * Each season triggers exactly one smartBulkUpsert() call.
   *
   * @param payload - This server's payload for the show (`fileServer.tv[showTitle]`)
   * @param parts - The pass's run and availability (core/types)
   * @param parentShow - The show as stored after this pass's show write
   *   (TVShowSyncService), or null when there is none
   */
  async syncShow(
    showTitle: string,
    payload: any,
    parts: TVPassParts,
    parentShow: TVShowEntity | null
  ): Promise<SyncResult[]> {
    const showData = payload
    if (!showData) {
      return [this.makeResult(showTitle, parts.run, SyncStatus.Skipped, [], [
        'No file server data found for this show'
      ])]
    }

    const allResults: SyncResult[] = []
    for (const key of Object.keys(showData.seasons || {})) {
      const seasonNumber = this.parseSeasonNumber(key)
      if (seasonNumber === null) continue
      allResults.push(...await this.syncSeason(showTitle, seasonNumber, payload, parts, parentShow))
    }
    return allResults
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private extractSeasonFileData(showData: any, seasonNumber: number): any {
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
  private resolveSeasonKey(showData: any, seasonNumber: number): string | null {
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
    showPayload: any,
    availability: Availability
  ): string[] {
    if (!episodeKey) return []
    const ownKey = this.resolveSeasonKey(showPayload, seasonNumber)
    const otherKeys =
      seasonsAcrossServers(availability.fieldAvailability, showOriginalTitle).get(seasonNumber)?.keys ?? []
    const seasonKeys = [...new Set([...(ownKey ? [ownKey] : []), ...otherKeys])]
    return seasonKeys.map((seasonKey) => `seasons.${seasonKey}.episodes.${episodeKey}`)
  }

  /** The servers reporting one of an episode's fields, under any of its prefixes. */
  private serversReportingEpisodeField(
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
  private ownsEpisodeField(
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
      : this.serversReportingEpisodeField(leafPrefixes, field, showOriginalTitle, availability)
    return isHighestPriorityAmongServers(reporters, run.serverConfig)
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
    showPayload: any,
    run: Pick<RunConfig, 'cleanup'>,
    availability: Availability
  ): CleanupPlan {
    if (!run.cleanup?.enabled || !existing) return { changes: [] }

    // Every literal prefix the episode has across the servers: a field is absent
    // only when no server reports it under any of them.
    const [prefix, ...otherPrefixes] = this.episodeLeafPrefixes(showOriginalTitle, seasonNumber, episodeKey, showPayload, availability)
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
      cleanup: run.cleanup,
      mediaType: 'tv',
      availabilityKey: showOriginalTitle,
      entity: existing,
      fieldAvailability: availability.fieldAvailability,
      fields,
      log: (obj, msg) => pinoLog.info(obj, msg),
      logContext: { show: displayTitle, originalTitle: showOriginalTitle, season: seasonNumber, episode: episodeNumber },
    })
  }

  /**
   * An episode's write plan: the existing doc with the incoming file-server
   * data merged on top, respecting per-field server priority.
   *
   * Key differences from naive field copy:
   *  - fileData.metadata is a URL path, not inline data — must be fetched via
   *    fetchMetadataMultiServer. Fallback: parent show's metadata.seasons[].episodes[].
   *  - fileData.thumbnailBlurhash is a URL path to a blurhash file, not the actual
   *    blurhash string. It is fetched (or the stored one kept or removed) by the
   *    blurhash rule, core/imageAndBlurhash.
   *
   * The plan's removals are the fields whose data is gone, not changed. It is
   * incomplete, and its deferrals name why, when the metadata did not come
   * from a fresh source, a caption removal was held back because not every
   * enabled server answered, or a blurhash the file server publishes could
   * not be fetched. The plan always writes the episode: it stamps lastSynced.
   */
  private async planEpisode(
    showOriginalTitle: string,
    displayTitle: string,
    seasonNumber: number,
    episodeNumber: number,
    fileData: any,
    /** The show's payload: the season's literal key is resolved from it. */
    showPayload: any,
    run: EpisodePlanRun,
    availability: Availability,
    existing: EpisodeEntity | null,
    showId: any,
    seasonId: any,
    parentShow: any,
    seasonFileData?: any,
    episodeFileName?: string
  ): Promise<PlanOutcome<EpisodeEntity>> {
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
    // writes the episode (wroteDocument).
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
    const leafPrefixes = this.episodeLeafPrefixes(showOriginalTitle, seasonNumber, episodeFileName, showPayload, availability)
    if (leafPrefixes.length === 0) {
      pinoLog.warn(
        { showOriginalTitle, seasonNumber, episodeNumber, serverId: run.serverConfig.id },
        'Cannot build the availability path for this episode; field ownership is not ranked against other servers'
      )
    }
    const owns = (field: string, hasValue: boolean) =>
      this.ownsEpisodeField(leafPrefixes, field, hasValue, showOriginalTitle, run, availability)
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
          pinoLog.warn(
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
        pinoLog.warn(
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
        pinoLog.error(
          { showOriginalTitle, seasonNumber, episodeNumber, err: error instanceof Error ? error.message : String(error) },
          'Failed to read the episode captions, leaving the stored ones alone'
        )
      }

      if (captionsReadable && !isTopLevelFieldLocked((existing as any)?.lockedFields, 'captionURLs')) {
        const serversListing = (language: string) =>
          this.serversReportingEpisodeField(
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
        try {
          episodeMetadata = await fetchMetadataMultiServer(
            run.serverConfig.id,
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
    const thumbnailBlurhash = await resolveBlurhash(
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
      async (path) => {
        try {
          return await fetchMetadataMultiServer(
            run.serverConfig.id,
            fileServerUrl(path, run.serverConfig),
            'blurhash',
            'tv',
            showOriginalTitle
          )
        } catch {
          return null // a failed fetch, reported through the outcome
        }
      }
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

    return { plan: { ...plan, ...draftWritePlan(existing, entity, [...new Set(unset)]) }, wroteDocument: true }
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
    run: Pick<RunConfig, 'serverConfig'>,
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
      serverId: run.serverConfig.id,
      timestamp: new Date(),
      changes,
      errors,
      // Display title + season/episode numbers for post-sync cache invalidation
      // (episode page tags key on display title, not the filesystem showTitle).
      ...(metadata ? { metadata } : {})
    }
  }
}
