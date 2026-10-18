/**
 * TV Show sync service — orchestrates show-level upserts and delegates to
 * SeasonSyncService and EpisodeSyncService for bulk season/episode writes.
 *
 * Each builder (the show's in ./showPlan, the seasons' in ./seasonPlan, the
 * episodes' in ./episodePlan) takes the stored document and the payload and
 * returns a write plan (core/types WritePlan): the fields to set, the fields
 * to remove, and what it held back. Field-absence cleanup adds a plan of its
 * own; the plans are merged (core/writePlan) and the merged plan's
 * `incomplete` decides the gate.
 *
 * The builders do no I/O. The files a builder reads (metadata files,
 * blurhashes) are fetched by the prefetch step, which runs it
 * (infrastructure/fileSystem/prefetch buildWithResources); the services read
 * and write the database.
 *
 * The show is read twice in a pass: once before its write, which the gate
 * check, the drift checks and the show's plan work from, and once after it.
 * That stored copy is handed to the seasons and episodes (they copy its
 * display title and id) and to the close-out.
 *
 * This ensures multi-server priority is respected: fields from higher-priority
 * servers are never overwritten by lower-priority servers.
 */

import {
  TVShowEntity,
  SyncResult,
  SyncStatus,
  MediaType,
  SyncOperation,
  syncEventBus,
  planFieldCleanup,
  type CleanableField,
  type RunConfig,
  type TVPassParts,
  type WritePlan
} from '../../core'

import { TVShowRepository, EpisodeRepository, SeasonRepository } from '../../infrastructure'
import { buildWithResources } from '../../infrastructure/fileSystem/prefetch'
import { SeasonSyncService } from './SeasonSyncService'
import { EpisodeSyncService } from './EpisodeSyncService'
import { planTVShow } from './showPlan'
import {
  availabilityFingerprint,
  payloadFingerprint,
} from '@src/utils/sync/core/syncGate'
import { buildSyncGate, readSyncGate, changesDocument, nextSyncGates } from '../../core/syncGate'
import { applyWritePlan, cleanupWritePlan, emptyWritePlan, mergeWritePlans } from '../../core/writePlan'
import { expectedSeasonCounts, type ExpectedCounts } from '../../core/seasonCounts'
import isEqual from 'lodash/isEqual'
import { syncLogger } from '../../core/logger'
import { createLogger } from '@src/lib/logger'

const pinoLog = createLogger('Sync.TV.Show')

// Show-level asset fields eligible for field-absence cleanup. TV uses BARE field
// paths (no `urls.` prefix) — show fileAvailability is built from the show object
// directly (run/availability). planTVShow (./showPlan) writes these fields.
const TVSHOW_CLEANABLE_FIELDS: CleanableField[] = [
  { entityField: 'posterURL', fieldPath: 'poster', companions: ['posterSource', 'posterBlurhash', 'posterBlurhashSource'] },
  { entityField: 'backdrop', fieldPath: 'backdrop', companions: ['backdropSource', 'backdropBlurhash', 'backdropBlurhashSource'] },
  { entityField: 'logo', fieldPath: 'logo', companions: ['logoSource', 'logoBlurhash'] },
]

/**
 * What the seasons and episodes under a show left undone, as a plan for the
 * show's gate: a season or episode pass that failed, or one that left its
 * own gate open (its results' `gateLeftOpen`). It writes nothing.
 */
function childrenWritePlan(childResults: readonly SyncResult[]): WritePlan<TVShowEntity> {
  const plan = emptyWritePlan<TVShowEntity>()
  if (childResults.some(r => r.status === SyncStatus.Failed)) {
    plan.incomplete = true
    plan.deferrals.push('a season or episode failed')
  }
  if (childResults.some(r => (r.metadata as any)?.gateLeftOpen === true)) {
    plan.incomplete = true
    plan.deferrals.push('a season or episode left its gate open')
  }
  return plan
}

export class TVShowSyncService {
  constructor(
    private readonly tvShowRepository: TVShowRepository,
    private readonly seasonSyncService: SeasonSyncService,
    private readonly episodeSyncService: EpisodeSyncService,
    private readonly episodeRepository: EpisodeRepository,
    private readonly seasonRepository: SeasonRepository
  ) {}

  /**
   * Sync one TV show and all of its seasons/episodes.
   *
   * Write order:
   *  1. tvShowRepository.smartUpsert(show)                → one write for the show header.
   *  2. seasonSyncService.syncShow(showTitle, …, show)    → one bulk write for all seasons.
   *  3. episodeSyncService.syncShow(showTitle, …, show)   → one bulk write per season.
   *  4. finalizeShow                                      → the episode count and the gate.
   *
   * @param payload - This server's payload for the show (`fileServer.tv[showTitle]`)
   * @param parts - The pass's run and availability (core/types), handed on to
   *   the season and episode services
   */
  async syncTVShow(showTitle: string, payload: any, parts: TVPassParts): Promise<SyncResult[]> {
    const { run, availability } = parts
    const allResults: SyncResult[] = []

    syncEventBus.emitStarted(showTitle, MediaType.TVShow, run.serverConfig.id)

    try {
      // Show-level skip (core/syncGate). This server's pass over the whole show
      // is skipped when:
      //   1. its gate matches — the show's payload (seasons and episodes
      //      included) and the who-has-what picture for the show are what they
      //      were at this server's last complete pass, and no other server has
      //      changed the show since;
      //   2. the DB still holds at least the episodes and seasons the payload
      //      lists (drift from deletes the payload cannot see).
      const showGate = buildSyncGate(
        payloadFingerprint(payload),
        availabilityFingerprint(availability.fieldAvailability, 'tv', showTitle)
      )

      // The first of the pass's two reads of the show: the gate check, the
      // drift checks and the show's plan all work from it.
      const existing = await this.tvShowRepository.findByOriginalTitle(showTitle)

      if (!run.forceSync && existing && readSyncGate(existing as any, run.serverConfig.id) === showGate) {
        const expected = this.expectedCounts(payload)
        const expectedEpisodes = expected.episodes
        const actualEpisodes = expectedEpisodes > 0
          ? await this.episodeRepository.getEpisodeCount(existing.title, undefined, (existing as any)._id)
          : 0
        // Season-count drift: a past cleanup can delete a show's seasons while
        // leaving its episodes intact and its hash unchanged. Without this
        // check the show would be skipped forever and the seasons never
        // re-created (episodes render under seasons, so the UI shows nothing).
        const expectedSeasons = expected.seasons
        const actualSeasons = expectedSeasons > 0
          ? await this.seasonRepository.getSeasonCount(existing.title, (existing as any)._id)
          : 0

        if (actualEpisodes >= expectedEpisodes && actualSeasons >= expectedSeasons) {
          // One-time backfill: a show that early-skips forever would never
          // acquire visibleEpisodeCount (episode visibility inputs are in
          // the episode hash, so any real change routes through the full
          // sync below). visibleShowFilter fails open on the missing
          // field, so this is convergence, not correctness.
          if ((existing as any).visibleEpisodeCount === undefined) {
            await this.finalizeShow(showTitle, existing, null)
          }
          syncEventBus.emitComplete(showTitle, MediaType.TVShow, run.serverConfig.id, undefined, {
            totalOperations: 0, successful: 0, failed: 0
          })
          return [this.makeResult(
            showTitle, run, MediaType.TVShow, SyncOperation.Metadata, SyncStatus.Skipped, [], []
          )]
        }

        syncLogger.info(
          `Show "${showTitle}": gate matches but DB has ${actualEpisodes}/${expectedEpisodes} ` +
          `episodes, ${actualSeasons}/${expectedSeasons} seasons — forcing full sync to repair drift`
        )
        // fall through to full sync — missing seasons/episodes will be $setOnInsert'd
      }

      // 1. The show's plan, with priority checking, and the document it
      //    leaves. The prefetch step fetches the files it reads (its metadata
      //    file, its blurhashes). Field-absence cleanup's removals are not
      //    taken out of that document: they go to the write as $unset.
      const showFileData = payload
      const built = await buildWithResources(
        (resources) => planTVShow({ showTitle, fileData: showFileData, run, availability, existing }, resources),
        { mediaType: 'tv', title: showTitle }
      )
      const showEntity = applyWritePlan(existing, built.plan)

      // Field-absence cleanup: drop show-level assets no enabled server reports
      // anymore. planFieldCleanup logs (both modes) and returns `unset` only in
      // enforce. showTitle is the originalTitle (fieldAvailability key).
      const cleanupPlan = planFieldCleanup({
        cleanup: run.cleanup,
        mediaType: 'tv',
        availabilityKey: showTitle,
        entity: existing,
        fieldAvailability: availability.fieldAvailability,
        fields: TVSHOW_CLEANABLE_FIELDS,
        log: (obj, msg) => pinoLog.info(obj, msg),
        logContext: { show: showEntity.title, originalTitle: showTitle },
      })

      // 2. One plan for the show's write (core/writePlan): the cleanup's
      //    removals first, then the builder's plan.
      const showPlan = mergeWritePlans<TVShowEntity>([cleanupWritePlan(cleanupPlan), built.plan], showTitle)

      // 3. Smart write — $set changed fields only, skip if nothing changed,
      //    plus $unset any cleared assets (enforce mode).
      const showChanged = changesDocument(existing as any, showEntity as any, showPlan.unset)
      // A write that changes the show drops every server's gate on it, in the
      // same update: the gates were stamped on the show as it was. This
      // server's own is stamped again by the close-out, once everything under
      // the show is written. Were the drop left to the close-out alone, a pass
      // that stopped after this write (the read below failing) would leave
      // the other servers skipping a show that has changed.
      if (showChanged && existing) {
        const storedGates = ((existing as any).syncGates ?? {}) as Record<string, string>
        const gates = nextSyncGates(storedGates, run.serverConfig.id, null, true)
        if (!isEqual(gates, storedGates)) (showEntity as any).syncGates = gates
      }
      await this.tvShowRepository.smartUpsert(showEntity, existing, { unset: showPlan.unset })

      allResults.push(this.makeResult(
        showTitle, run, MediaType.TVShow, SyncOperation.Metadata,
        SyncStatus.Completed, [`Upserted TV show "${showTitle}"`, ...cleanupPlan.changes], [],
        // `created`: no document existed before this write (counted for the
        // admins' sync notice).
        { displayTitle: showEntity.title, ...(existing ? {} : { created: true }) }
      ))

      // The second read: the show as the write left it. The seasons and
      // episodes copy its display title and id, and the close-out writes over
      // it. The planned show will not do: the write drops a locked field
      // (computeDiff) and clears manual flags (manualFieldsToClear), and a new
      // show has no id until it is inserted. Nothing writes the show between
      // here and the close-out.
      const storedShow = await this.tvShowRepository.findByOriginalTitle(showTitle)

      // 4. Bulk-upsert all seasons (one bulkWrite per show)
      const childResults: SyncResult[] = []
      childResults.push(...await this.seasonSyncService.syncShow(showTitle, payload, parts, storedShow))

      // 5. Bulk-upsert all episodes (one bulkWrite per season)
      childResults.push(...await this.episodeSyncService.syncShow(showTitle, payload, parts, storedShow))
      allResults.push(...childResults)

      // 6. Close out the show now that everything under it is written: recount
      //    its web-visible episodes (the signal every show-level list filter
      //    keys on) and settle the show's gate.
      //
      //    The gate is stamped HERE, after the seasons and episodes, and only
      //    if all of it succeeded. It used to be written with the show header
      //    in step 3, before the work it gates: a season or episode write that
      //    then failed, or an episode deliberately left to retry after a
      //    failed metadata fetch, was never retried, because the next run
      //    skipped the whole show.
      const subtreeChanged =
        showChanged || childResults.some(r => (r.metadata as any)?.documentChanged === true)
      // The pass is complete only when nothing failed, held back or deferred:
      // the show's plan (a failed metadata fetch, a season count held while a
      // server did not answer, a blurhash that could not be fetched, a removal
      // held back) merged with what the seasons and episodes report. The
      // merged plan's `incomplete` decides (decideGate); either way the pass
      // has to run again.
      const passPlan = mergeWritePlans<TVShowEntity>([showPlan, childrenWritePlan(childResults)], showTitle)
      const gateToStamp = passPlan.gate === 'stamp' ? showGate : null
      if (!gateToStamp) {
        syncLogger.debug(`Gate left open for show "${showTitle}": ${passPlan.deferrals.join(', ')}`)
      }
      const closedOut = await this.finalizeShow(showTitle, storedShow, {
        gate: gateToStamp,
        subtreeChanged,
        serverId: run.serverConfig.id,
      })
      if (!closedOut) {
        // The gates were not settled: the show keeps the ones it had before
        // this pass, which a pass that changed the subtree should have reset.
        // Reported as a failure, so the run is not taken as complete and the
        // next tick is not skipped on those gates (sync/run/tickSkip).
        allResults.push(this.makeResult(
          showTitle, run, MediaType.TVShow, SyncOperation.Metadata, SyncStatus.Failed, [],
          ['Closing out the show failed: its gate was not settled']
        ))
      }

      syncEventBus.emitComplete(showTitle, MediaType.TVShow, run.serverConfig.id, undefined, {
        totalOperations: allResults.length,
        successful: allResults.filter(r => r.status === SyncStatus.Completed).length,
        failed: allResults.filter(r => r.status === SyncStatus.Failed).length
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      const stack = error instanceof Error ? error.stack : undefined
      syncEventBus.emitError(showTitle, MediaType.TVShow, run.serverConfig.id, msg)
      // Surface the failure to Pino logs — emitError only fans out to SSE
      // subscribers, and `syncLogger` is a console-based rate-limited
      // logger that doesn't reach SigNoz. Without this the failure was
      // silently counted in the pass's errors with no observability
      // footprint.
      pinoLog.error(
        { showTitle, serverId: run.serverConfig.id, err: msg, stack },
        `TV show sync failed: ${showTitle}`
      )
      allResults.push(this.makeResult(
        showTitle, run, MediaType.TVShow, SyncOperation.Metadata, SyncStatus.Failed, [], [msg]
      ))
    }

    return allResults
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Close out a show's pass: recompute its denormalized `visibleEpisodeCount`
   * (episodes passing mediaVisibility.visibleEpisodeFilter) and, when a gate
   * decision is given, settle the show's skip gate. One smartUpsert (single
   * write chokepoint — computeDiff writes only what changed).
   *
   * Never throws: a stale count degrades to slightly-wrong list filtering.
   * A failure to settle the gate is reported to the caller instead, which
   * fails the pass: the gate left in place is the one from before this pass.
   *
   * @param show   the show as stored: the copy read before the pass on the
   *               skip path, the copy read after the show's write on the
   *               full-sync path. Nothing is read here.
   * @param gating null on the skip path (count only).
   * @returns false when a write or the count failed; true otherwise
   */
  private async finalizeShow(
    showTitle: string,
    show: TVShowEntity | null,
    gating: {
      /** The gate to stamp, or null when the pass must be retried. */
      gate: string | null
      /** Whether the pass changed the show, a season or an episode. */
      subtreeChanged: boolean
      serverId: string
    } | null
  ): Promise<boolean> {
    try {
      if (!show || !(show as any)._id) return true

      const next: any = { ...show }
      next.visibleEpisodeCount = await this.episodeRepository.getVisibleEpisodeCount((show as any)._id)

      if (gating) {
        const storedGates = ((show as any).syncGates ?? {}) as Record<string, string>
        const gates = nextSyncGates(storedGates, gating.serverId, gating.gate, gating.subtreeChanged)
        if (!isEqual(gates, storedGates)) next.syncGates = gates
      }

      await this.tvShowRepository.smartUpsert(next as TVShowEntity, show)
      return true
    } catch (error) {
      pinoLog.warn(
        { showTitle, err: error instanceof Error ? error.message : String(error) },
        'closing out the show failed — its episode count or gate may lag one sync'
      )
      return false
    }
  }

  /**
   * The seasons and episodes this server's payload says the show has, counted
   * by the drift check's one rule (core/seasonCounts): the "expected" side of
   * the show-level integrity check.
   */
  private expectedCounts(payload: any): ExpectedCounts {
    const seasons = payload?.seasons
    if (!seasons) return { seasons: 0, episodes: 0 }
    return expectedSeasonCounts(
      Object.entries(seasons).map(([key, s]: [string, any]) => [key, Object.keys(s?.episodes || {}).length] as const)
    )
  }

  private makeResult(
    entityId: string,
    run: Pick<RunConfig, 'serverConfig'>,
    mediaType: MediaType,
    operation: SyncOperation,
    status: SyncStatus,
    changes: string[],
    errors: string[],
    metadata?: Record<string, any>
  ): SyncResult {
    return {
      status, entityId, mediaType, operation,
      serverId: run.serverConfig.id,
      timestamp: new Date(),
      changes, errors,
      // Carry the display title up to run/serverPass so post-sync cache
      // invalidation can build the correct page tags (tags key on display
      // title, not the originalTitle/showTitle filesystem key).
      ...(metadata ? { metadata } : {})
    }
  }
}
