/**
 * Season sync service — bulk-write pattern with read-merge-replace.
 *
 * Write pattern:
 *  1. Pre-fetch all existing seasons for the show (one query). The parent
 *     show (its _id for the showId foreign key, its display title, its
 *     metadata) is handed in as stored: TVShowSyncService reads it once,
 *     after the show's write.
 *  2. For each season in file-server data, a write plan over the existing
 *     doc, with priority (./seasonPlan, run through the prefetch step, which
 *     fetches the blurhash it reads), merged with field-absence cleanup's
 *     (core/writePlan).
 *  3. Flush all seasons with a single SeasonRepository.smartBulkUpsert() call:
 *     one op per season, the batching in the repository.
 *
 * repository.upsert() is NEVER called inside a season loop.
 */

import {
  SeasonEntity,
  SyncResult,
  SyncStatus,
  MediaType,
  SyncOperation,
  syncEventBus,
  planFieldCleanup,
  type RunConfig,
  type TVPassParts,
  type TVShowEntity
} from '../../core'

import { SeasonRepository } from '../../infrastructure'
import { buildWithResources } from '../../infrastructure/fileSystem/prefetch'
import { planSeason, seasonKeysAcrossServers } from './seasonPlan'
import { changesDocument } from '@src/utils/sync/core/syncGate'
import { applyWritePlan, cleanupWritePlan, mergeWritePlans } from '@src/utils/sync/core/writePlan'
import { createLogger } from '@src/lib/logger'

const pinoLog = createLogger('Sync.TV.Season')

export class SeasonSyncService {
  constructor(
    private readonly seasonRepository: SeasonRepository
  ) {}

  /**
   * Sync all seasons for a show via a single smartBulkUpsert call.
   *
   * Pattern:
   *  1. Pre-fetch existing seasons for the show.
   *  2. One write plan per season, from file-server data + its existing doc.
   *  3. seasonRepository.smartBulkUpsert(ops) once — never per-season upserts.
   *
   * @param showTitle - The show's folder name (originalTitle)
   * @param payload - This server's payload for the show (`fileServer.tv[showTitle]`)
   * @param parts - The pass's run and availability (core/types)
   * @param parentShow - The show as stored after this pass's show write
   *   (TVShowSyncService), or null when there is none
   */
  async syncShow(
    showTitle: string,
    payload: any,
    { run, availability }: TVPassParts,
    parentShow: TVShowEntity | null
  ): Promise<SyncResult[]> {
    const results: SyncResult[] = []

    syncEventBus.emitStarted(showTitle, MediaType.Season, run.serverConfig.id)

    try {
      const showFileData = payload

      if (!showFileData?.seasons) {
        results.push(this.makeResult(showTitle, run, SyncStatus.Skipped, [], [
          'No season data found in file server data for this show'
        ]))
        return results
      }

      // The parent show resolves the display title, showId and metadata.
      const showId = (parentShow as any)?._id || null
      // Use the display title for showTitle on seasons (matches legacy document shape)
      const displayTitle = parentShow?.title || showTitle

      // Find existing seasons for THIS show. Key on showId, not the shared display
      // title, so a same-titled show's seasons don't leak into the merge/diff.
      const existingSeasons = await this.seasonRepository.findByShow(displayTitle, showId)
      const existingByNumber = new Map(
        existingSeasons.map(s => [s.seasonNumber, s])
      )

      // ---- Accumulate smart upsert ops — do NOT write one by one ----
      // `unset` carries field-absence cleanup (enforce mode); `cleanupChanges` is
      // the diagnostic text surfaced on the SyncResult in both modes.
      const seasonOps: Array<{
        filter: Record<string, any>
        existing: SeasonEntity | null
        merged: SeasonEntity
        unset?: string[]
        cleanupChanges?: string[]
        /** The pass changed the season's data (not just sync bookkeeping). */
        documentChanged: boolean
        /**
         * The season's part of the pass is not complete (its merged plan is
         * incomplete): a removal was held back, or something was left for a
         * later pass.
         */
        gateLeftOpen: boolean
      }> = []

      for (const [key, fileData] of Object.entries(showFileData.seasons)) {
        const seasonNumber = this.parseSeasonNumber(key)
        if (seasonNumber === null) {
          results.push(this.makeResult(
            `${showTitle} S?`, run, SyncStatus.Skipped, [],
            [`Cannot determine season number for key "${key}"`]
          ))
          continue
        }

        const existing = existingByNumber.get(seasonNumber) || null
        const built = await buildWithResources(
          (resources) =>
            planSeason(
              { showOriginalTitle: showTitle, displayTitle, seasonNumber, seasonKey: key, fileData, run, availability, existing, showId, parentShow },
              resources
            ),
          { mediaType: 'tv', title: showTitle }
        )
        // The document the plan leaves. Field-absence cleanup's removals are
        // not taken out of it: they go to the write as $unset.
        const merged = applyWritePlan(existing, built.plan)

        // Filter shape mirrors bulkUpsertShow: prefer showId for stability
        const filter = (merged as any).showId
          ? { showId: (merged as any).showId, seasonNumber: merged.seasonNumber }
          : { showTitle: merged.showTitle, seasonNumber: merged.seasonNumber }

        // Field-absence cleanup for the season poster. `key` is the literal season
        // key from the file-server data, matching collectFieldAvailability's path.
        // showTitle is the originalTitle (fieldAvailability key).
        const cleanup = planFieldCleanup({
          cleanup: run.cleanup,
          mediaType: 'tv',
          availabilityKey: showTitle,
          entity: existing,
          fieldAvailability: availability.fieldAvailability,
          fields: [
            {
              entityField: 'posterURL',
              fieldPath: `seasons.${key}.season_poster`,
              // The same season under another server's folder name.
              alsoReportedAs: seasonKeysAcrossServers(showTitle, seasonNumber, key, availability)
                .filter((other) => other !== key)
                .map((other) => `seasons.${other}.season_poster`),
              companions: ['posterSource', 'posterBlurhash', 'posterBlurhashSource'],
            },
          ],
          log: (obj, msg) => pinoLog.info(obj, msg),
          logContext: { show: displayTitle, originalTitle: showTitle, season: seasonNumber },
        })

        // One plan for the season's write (core/writePlan): the cleanup's
        // removals first, then the builder's plan.
        const seasonPlan = mergeWritePlans<SeasonEntity>(
          [cleanupWritePlan(cleanup), built.plan],
          `${showTitle} S${seasonNumber}`
        )
        seasonOps.push({
          filter,
          existing,
          merged,
          unset: seasonPlan.unset,
          cleanupChanges: cleanup.changes,
          documentChanged: changesDocument(existing as any, merged as any, seasonPlan.unset),
          // Either way the pass has to run again: a removal held back because
          // not every server answered, or a count or blurhash it could not
          // settle (the merged plan's `incomplete`, decideGate).
          gateLeftOpen: seasonPlan.gate === 'leaveOpen',
        })
      }

      // ---- Single smart bulk write — skips unchanged, $sets changed, inserts new ----
      if (seasonOps.length > 0) {
        await this.seasonRepository.smartBulkUpsert(seasonOps)
      }

      for (const { merged: entity, cleanupChanges, documentChanged, gateLeftOpen } of seasonOps) {
        results.push(this.makeResult(
          `${showTitle} S${entity.seasonNumber}`, run,
          SyncStatus.Completed,
          [`Upserted season ${entity.seasonNumber}`, ...(cleanupChanges || [])], [],
          {
            displayTitle: entity.showTitle,
            seasonNumber: entity.seasonNumber,
            // Read by TVShowSyncService when it decides the show's own gate.
            ...(documentChanged ? { documentChanged: true } : {}),
            ...(gateLeftOpen ? { gateLeftOpen: true } : {}),
          }
        ))
      }

      syncEventBus.emitComplete(showTitle, MediaType.Season, run.serverConfig.id, undefined, {
        totalOperations: seasonOps.length,
        successful: seasonOps.length,
        failed: 0
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      const stack = error instanceof Error ? error.stack : undefined
      syncEventBus.emitError(showTitle, MediaType.Season, run.serverConfig.id, msg, SyncOperation.Metadata)
      // emitError only fans out to SSE — log explicitly via Pino so the
      // failure surfaces in SigNoz instead of being silently counted.
      pinoLog.error(
        { showTitle, serverId: run.serverConfig.id, err: msg, stack },
        `Season sync failed for show: ${showTitle}`
      )
      // An unordered bulk write can apply some of its operations before it
      // fails. What landed is unknown, so the show is reported as changed.
      results.push(this.makeResult(showTitle, run, SyncStatus.Failed, [], [msg], { documentChanged: true }))
    }

    return results
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

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
      mediaType: MediaType.Season,
      operation: SyncOperation.Metadata,
      serverId: run.serverConfig.id,
      timestamp: new Date(),
      changes,
      errors,
      // Display title + season number for post-sync cache invalidation
      // (season page tags key on display title, not the filesystem showTitle).
      ...(metadata ? { metadata } : {})
    }
  }
}
