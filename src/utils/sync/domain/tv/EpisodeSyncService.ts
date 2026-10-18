/**
 * Episode sync service — bulk-write pattern with read-merge-replace.
 *
 * Write pattern:
 *  1. Pre-fetch all existing episodes for the season (one query) and the
 *     parent season (seasonId foreign key). The parent show (showId foreign
 *     key, display title, metadata) is handed in as stored: TVShowSyncService
 *     reads it once, after the show's write.
 *  2. For each episode in file-server data, a write plan over the existing
 *     doc, with priority (./episodePlan, run through the prefetch step, which
 *     fetches the files it reads), merged with field-absence cleanup's
 *     (core/writePlan).
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
  type Availability,
  type CleanableField,
  type CleanupPlan,
  type PlanOutcome,
  type RunConfig,
  type TVPassParts,
  type TVShowEntity
} from '../../core'

import { EpisodeRepository, SeasonRepository } from '../../infrastructure'
import { buildWithResources } from '../../infrastructure/fileSystem/prefetch'
import { episodeLeafPrefixes, parseSeasonNumber, planEpisode, type EpisodePlanLog } from './episodePlan'
import {
  availabilityFingerprintForPrefixes,
  payloadFingerprint,
} from '@src/utils/sync/core/syncGate'
import {
  buildSyncGate,
  readSyncGate,
  changesDocument,
  nextSyncGates,
} from '@src/utils/sync/core/syncGate'
import { applyWritePlan, cleanupWritePlan, emptyWritePlan, mergeWritePlans } from '@src/utils/sync/core/writePlan'
import isEqual from 'lodash/isEqual'
import { createLogger } from '@src/lib/logger'

const pinoLog = createLogger('Sync.TV.Episode')

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
        const leafPrefixes = episodeLeafPrefixes(showTitle, seasonNumber, key, payload, availability)
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

        // The prefetch step fetches the files the builder reads (its metadata
        // file, its thumbnail's blurhash) and calls it again with them. Its
        // warnings are logged for the call whose plan is kept, once.
        let warnings: Array<['warn' | 'error', Record<string, unknown>, string]> = []
        const log: EpisodePlanLog = {
          warn: (fields, message) => { warnings.push(['warn', fields, message]) },
          error: (fields, message) => { warnings.push(['error', fields, message]) },
        }
        let built: PlanOutcome<EpisodeEntity>
        try {
          built = await buildWithResources((resources) => {
            warnings = []
            return planEpisode(
              {
                showOriginalTitle: showTitle, displayTitle, seasonNumber, episodeNumber: epNum, fileData,
                showPayload: payload, run, availability, existing, showId, seasonId, parentShow,
                seasonFileData, episodeFileName: key,
              },
              resources,
              log
            )
          }, { mediaType: 'tv', title: showTitle })
        } finally {
          for (const [level, fields, message] of warnings) pinoLog[level](fields, message)
        }
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
      const seasonNumber = parseSeasonNumber(key)
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
      if (parseSeasonNumber(key) === seasonNumber) return data
    }
    return null
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
    const [prefix, ...otherPrefixes] = episodeLeafPrefixes(showOriginalTitle, seasonNumber, episodeKey, showPayload, availability)
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
