/**
 * Season sync service — bulk-write pattern with read-merge-replace.
 *
 * Write pattern:
 *  1. Pre-fetch all existing seasons for the show (one query). The parent
 *     show (its _id for the showId foreign key, its display title, its
 *     metadata) is handed in as stored: TVShowSyncService reads it once,
 *     after the show's write.
 *  2. For each season in file-server data, a write plan over the existing
 *     doc, with priority, merged with field-absence cleanup's (core/writePlan).
 *  3. Flush all seasons with a single SeasonRepository.smartBulkUpsert() call:
 *     one op per season, the batching in the repository.
 *
 * repository.upsert() is NEVER called inside a season loop.
 */

import {
  SeasonEntity,
  SyncContext,
  SyncResult,
  SyncStatus,
  MediaType,
  SyncOperation,
  syncEventBus,
  planFieldCleanup,
  type PlanOutcome,
  type TVShowEntity
} from '../../core'

import { SeasonRepository, fetchMetadataMultiServer, fileServerUrl, isTopLevelFieldLocked } from '../../infrastructure'
import { seedDiscovery } from '../../core/discovery'
import {
  getServersReportingField,
  isHighestPriorityAmongServers,
  seasonsAcrossServers,
} from '@src/utils/sync/core/ownership'
import { changesDocument } from '@src/utils/sync/core/syncGate'
import { applyWritePlan, cleanupWritePlan, draftWritePlan, emptyWritePlan, mergeWritePlans } from '@src/utils/sync/core/writePlan'
import { resolveBlurhash } from '@src/utils/sync/core/imageAndBlurhash'
import { effectiveMetadata } from '@src/utils/sync/core/metadataLock'
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
   * @param parentShow - The show as stored after this pass's show write
   *   (TVShowSyncService), or null when there is none
   */
  async syncShow(showTitle: string, context: SyncContext, parentShow: TVShowEntity | null): Promise<SyncResult[]> {
    const results: SyncResult[] = []

    syncEventBus.emitStarted(showTitle, MediaType.Season, context.serverConfig.id)

    try {
      const showFileData = context.fileServerData?.tv?.[showTitle]

      if (!showFileData?.seasons) {
        results.push(this.makeResult(showTitle, context, SyncStatus.Skipped, [], [
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
            `${showTitle} S?`, context, SyncStatus.Skipped, [],
            [`Cannot determine season number for key "${key}"`]
          ))
          continue
        }

        const existing = existingByNumber.get(seasonNumber) || null
        const built = await this.planSeason(showTitle, displayTitle, seasonNumber, fileData, context, existing, showId, parentShow, key)
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
          cleanup: context.cleanup,
          mediaType: 'tv',
          availabilityKey: showTitle,
          entity: existing,
          fieldAvailability: context.fieldAvailability,
          fields: [
            {
              entityField: 'posterURL',
              fieldPath: `seasons.${key}.season_poster`,
              // The same season under another server's folder name.
              alsoReportedAs: this.seasonKeysAcrossServers(showTitle, seasonNumber, key, context)
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
          `${showTitle} S${entity.seasonNumber}`, context,
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

      syncEventBus.emitComplete(showTitle, MediaType.Season, context.serverConfig.id, undefined, {
        totalOperations: seasonOps.length,
        successful: seasonOps.length,
        failed: 0
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      const stack = error instanceof Error ? error.stack : undefined
      syncEventBus.emitError(showTitle, MediaType.Season, context.serverConfig.id, msg, SyncOperation.Metadata)
      // emitError only fans out to SSE — log explicitly via Pino so the
      // failure surfaces in SigNoz instead of being silently counted.
      pinoLog.error(
        { showTitle, serverId: context.serverConfig.id, err: msg, stack },
        `Season sync failed for show: ${showTitle}`
      )
      // An unordered bulk write can apply some of its operations before it
      // fails. What landed is unknown, so the show is reported as changed.
      results.push(this.makeResult(showTitle, context, SyncStatus.Failed, [], [msg], { documentChanged: true }))
    }

    return results
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * A season's write plan: the existing doc with the incoming file-server
   * data merged on top, respecting per-field server priority.
   *
   * Key differences from naive field copy:
   *  - Season metadata lives in the PARENT SHOW's metadata.seasons[] array,
   *    not in the season file-server data directly.
   *  - The poster key in file-server data is "season_poster", not "poster".
   *  - Blurhash fields in file-server data are URL paths (fetched by the
   *    blurhash rule, core/imageAndBlurhash) — never copied directly to the entity.
   *
   * The plan's removals are the fields whose data is gone, not changed. It is
   * incomplete, and its deferrals name why, when something could not be
   * settled this pass and must be retried: the episode count was held because
   * a server did not answer, or a blurhash fetch failed. The plan always
   * writes the season: it stamps lastSynced.
   */
  private async planSeason(
    showOriginalTitle: string,
    displayTitle: string,
    seasonNumber: number,
    fileData: any,
    context: SyncContext,
    existing: SeasonEntity | null,
    showId: any,
    parentShow: any,
    /** The season's LITERAL key in the file-server data, e.g. "Season 01". */
    seasonKey: string
  ): Promise<PlanOutcome<SeasonEntity>> {
    const now = new Date()
    // What was held back, and why (the plan's incomplete and deferrals).
    const plan = emptyWritePlan<SeasonEntity>()
    const holdBack = (reason: string) => {
      plan.incomplete = true
      plan.deferrals.push(reason)
    }
    const unset: string[] = []
    const locked = (field: string) => isTopLevelFieldLocked((existing as any)?.lockedFields, field)
    // Remove a field whose data is gone. An admin lock keeps it.
    const clearField = (field: string) => {
      if (locked(field)) return
      delete (entity as any)[field]
      if (existing && (existing as any)[field] !== undefined) unset.push(field)
    }
    // A season field belongs to the highest-priority server that has a value
    // for it. The paths below use the literal season keys the servers sent:
    // the old `seasons.Season ${n}.…` guess missed every folder not named
    // exactly that ("Season 01"), a missed path counts as "nobody reports it",
    // and the priority helper then let every server write — last one synced
    // won. Two servers need not agree on the folder's name either, so the
    // reporters are gathered under every key in use for this season number.
    // Fails closed: a server the map does not list for the field never owns
    // it, even when its payload has a value there. (This server's own key is
    // always among the keys, so its path can always be built.)
    const seasonKeys = this.seasonKeysAcrossServers(showOriginalTitle, seasonNumber, seasonKey, context)
    const owns = (field: string, hasValue: boolean) => {
      if (!hasValue) return false
      const reporters = [
        ...new Set(
          seasonKeys.flatMap((key) =>
            getServersReportingField(
              context.fieldAvailability, 'tv', showOriginalTitle, `seasons.${key}.${field}`
            )
          )
        ),
      ]
      return isHighestPriorityAmongServers(reporters, context.serverConfig)
    }

    // The season this pass wants stored: the existing doc (preserving ALL
    // fields) or a new one. Either way the pass stamps lastSynced, so the plan
    // writes the season (wroteDocument).
    const entity: SeasonEntity = existing
      ? { ...existing, lastSynced: now }
      : {
          title: `Season ${seasonNumber}`,
          originalTitle: `Season ${seasonNumber}`,
          type: 'season',
          createdAt: now,
          lastSynced: now,
          seasonNumber,
          showTitle: displayTitle,
        }

    // Heal structural fields
    if (!entity.type) entity.type = 'season'
    if (!entity.createdAt) entity.createdAt = now
    // Library-add date: seeded once, never moved later (core/discovery.ts)
    seedDiscovery(entity, existing, context.serverConfig.id, now)
    if (showId) entity.showId = showId
    // Use display title as showTitle (matches legacy document shape)
    entity.showTitle = displayTitle

    // --- Metadata from the parent show ---
    // A season's metadata is not in its own file-server data: it is the entry
    // for this season in the STORED show's metadata.seasons[]. It is derived
    // data, the same whichever server's pass copies it, so every pass does.
    // It used to be left to the server that owns the show's metadata, and a
    // season that server does not hold (the main server has the show folder
    // with artwork only; the episodes are on another) never got a title, an
    // air date or an episode count.
    const showSeasons = parentShow?.metadata?.seasons
    const seasonMetadata = Array.isArray(showSeasons)
      ? showSeasons.find((s: any) => s.season_number === seasonNumber)
      : undefined
    let cleanedMetadata: any
    if (seasonMetadata) {
      // Clean metadata: remove episodes array (stored separately)
      cleanedMetadata = { ...seasonMetadata }
      delete cleanedMetadata.episodes
    }
    // Metadata an admin locked stays as stored, and so do the fields taken
    // from it (the title, the episode count below): the show's copy would be
    // dropped on the way to the database, and must not name the season
    // (core/metadataLock).
    const metadata = effectiveMetadata<any>({
      stored: existing ? { metadata: existing.metadata, metadataSource: existing.metadataSource } : null,
      // The source is the show's metadata source, not whoever copied it.
      incoming: seasonMetadata ? { metadata: cleanedMetadata, metadataSource: parentShow?.metadataSource } : null,
      // The show's metadata lists its seasons, and not this one. (A show with
      // no metadata at all is not this case: its metadata may simply not have
      // been synced yet.)
      gone: Array.isArray(showSeasons),
      locked: locked('metadata'),
    })
    if (metadata.action === 'write') {
      const fresh = metadata.metadata
      entity.metadata = fresh
      if (metadata.metadataSource) entity.metadataSource = metadata.metadataSource

      // Extract queryable fields from metadata (matching legacy document shape)
      if (fresh.name) entity.title = fresh.name
      if (fresh.air_date) entity.airDate = new Date(fresh.air_date)
      if (fresh.overview) entity.overview = fresh.overview
      if (fresh.poster_path) entity.posterPath = fresh.poster_path
      if (fresh.vote_average != null) entity.rating = fresh.vote_average
      if (fresh.episode_count != null) entity.episodeCount = fresh.episode_count
    } else if (metadata.action === 'remove') {
      // What was copied from the season's old entry goes, so the season ends
      // as a first sync against the same metadata would leave it.
      for (const field of ['metadata', 'metadataSource', 'airDate', 'overview', 'posterPath', 'rating']) {
        clearField(field)
      }
      if (!locked('title')) entity.title = `Season ${seasonNumber}`
      // The count came from the metadata too. It is worked out again below
      // from the episodes the servers hold.
      if (!locked('episodeCount')) delete (entity as any).episodeCount
    }

    // --- Poster (priority-gated) ---
    // File-server key for season poster is "season_poster", not "poster"
    const canUpdatePoster = owns('season_poster', Boolean((fileData as any)?.season_poster))
    if (canUpdatePoster) {
      entity.posterURL = fileServerUrl(
        (fileData as any).season_poster,
        context.serverConfig
      )
      entity.posterSource = context.serverConfig.id
    }

    // Episode count: the season's metadata when it has one (the stored copy
    // while it is locked), otherwise the episodes the servers hold between
    // them, counted once each. The fallback used to be the first syncing
    // server's own count, kept from then on.
    const metadataEpisodeCount = (metadata.metadata as any)?.episode_count
    if (metadataEpisodeCount != null) {
      entity.episodeCount = metadataEpisodeCount
    } else {
      const acrossServers = seasonsAcrossServers(context.fieldAvailability, showOriginalTitle)
        .get(seasonNumber)?.episodes.size
      if (acrossServers) {
        // With a server missing, its episodes are missing from the count. Do
        // not let it drop on such a run; say so, so the lower count is applied
        // on the next run where every server answers.
        const everyServerAnswered =
          (context.allEnabledServersProbed ?? context.cleanup?.allEnabledServersProbed) === true
        const stored = (existing as any)?.episodeCount
        if (!everyServerAnswered && typeof stored === 'number' && stored > acrossServers) {
          entity.episodeCount = stored
          holdBack('episodeCount')
        } else {
          entity.episodeCount = acrossServers
        }
      } else if (typeof (fileData as any)?.episodeCount === 'number') {
        entity.episodeCount = (fileData as any).episodeCount
      } else if ((fileData as any)?.episodes && typeof (fileData as any).episodes === 'object') {
        entity.episodeCount = Object.keys((fileData as any).episodes).length
      }
    }

    // --- Season poster blurhash ---
    // Kept, fetched or removed by the one rule every image follows
    // (core/imageAndBlurhash): settled by the poster's owner, removed when it
    // is of another poster and nothing replaces it. A failed fetch is
    // reported, so the show is not skipped without it.
    const posterBlurhash = await resolveBlurhash(
      {
        stored: {
          url: existing?.posterURL,
          blurhash: existing?.posterBlurhash,
          blurhashSource: (existing as any)?.posterBlurhashSource,
        },
        reported: {
          url: canUpdatePoster ? entity.posterURL : null,
          blurhashUrl: (fileData as any)?.seasonPosterBlurhash,
        },
        owner: canUpdatePoster ? context.serverConfig.id : null,
        locks: { image: locked('posterURL'), blurhash: locked('posterBlurhash') },
      },
      async (path) => {
        try {
          return await fetchMetadataMultiServer(
            context.serverConfig.id,
            fileServerUrl(path, context.serverConfig),
            'blurhash',
            'tv',
            showOriginalTitle
          )
        } catch {
          return null // a failed fetch, reported through the outcome
        }
      }
    )
    if (posterBlurhash.action === 'write') {
      entity.posterBlurhash = posterBlurhash.blurhash
      entity.posterBlurhashSource = posterBlurhash.blurhashSource
    } else {
      if (posterBlurhash.fetchFailed) holdBack('posterBlurhash')
      if (posterBlurhash.action === 'unset') {
        clearField('posterBlurhash')
        clearField('posterBlurhashSource')
      }
    }

    // A count that could not be worked out again is removed with the metadata
    // it came from.
    if (existing && (existing as any).episodeCount !== undefined && (entity as any).episodeCount === undefined) {
      unset.push('episodeCount')
    }

    // A field is either written or removed, never both.
    const removed = [...new Set(unset)].filter((field) => (entity as any)[field] === undefined)
    return { plan: { ...plan, ...draftWritePlan(existing, entity, removed) }, wroteDocument: true }
  }

  /**
   * Every literal key in use for one season number across the servers that
   * answered, this server's own key first.
   */
  private seasonKeysAcrossServers(
    showOriginalTitle: string,
    seasonNumber: number,
    ownKey: string,
    context: SyncContext
  ): string[] {
    const others =
      seasonsAcrossServers(context.fieldAvailability, showOriginalTitle).get(seasonNumber)?.keys ?? []
    return [...new Set([ownKey, ...others])]
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
      mediaType: MediaType.Season,
      operation: SyncOperation.Metadata,
      serverId: context.serverConfig.id,
      timestamp: new Date(),
      changes,
      errors,
      // Display title + season number for post-sync cache invalidation
      // (season page tags key on display title, not the filesystem showTitle).
      ...(metadata ? { metadata } : {})
    }
  }
}
