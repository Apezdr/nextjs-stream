/**
 * TV Show sync service — orchestrates show-level upserts and delegates to
 * SeasonSyncService and EpisodeSyncService for bulk season/episode writes.
 *
 * Each builder (the show's here, the seasons' and the episodes' in their
 * services) takes the stored document and the payload and returns a write
 * plan (core/types WritePlan): the fields to set, the fields to remove, and
 * what it held back. Field-absence cleanup adds a plan of its own; the plans
 * are merged (core/writePlan) and the merged plan's `incomplete` decides the
 * gate.
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
  SyncContext,
  SyncResult,
  SyncStatus,
  MediaType,
  SyncOperation,
  syncEventBus,
  planFieldCleanup,
  type CleanableField,
  type PlanOutcome,
  type WritePlan
} from '../../core'

import { TVShowRepository, EpisodeRepository, SeasonRepository, fetchMetadataMultiServer, fileServerUrl, isTopLevelFieldLocked } from '../../infrastructure'
import { SeasonSyncService } from './SeasonSyncService'
import { EpisodeSyncService } from './EpisodeSyncService'
import {
  isCurrentServerHighestPriorityForReportedField,
  serverOutranks,
} from '@src/utils/sync/core/ownership'
import { resolveBlurhash } from '@src/utils/sync/core/imageAndBlurhash'
import { effectiveMetadata } from '@src/utils/sync/core/metadataLock'
import { resolveTitle } from '@src/utils/sync/core/title'
import {
  availabilityFingerprint,
  payloadFingerprint,
} from '@src/utils/sync/core/syncGate'
import { buildSyncGate, readSyncGate, changesDocument, nextSyncGates } from '../../core/syncGate'
import { applyWritePlan, cleanupWritePlan, draftWritePlan, emptyWritePlan, mergeWritePlans } from '../../core/writePlan'
import isEqual from 'lodash/isEqual'
import { syncLogger } from '../../core/logger'
import { seedDiscovery, applyFirstSeen } from '../../core/discovery'
import { resolveMediaId } from '../../core/deliveryFacts'
import { createLogger } from '@src/lib/logger'

const pinoLog = createLogger('Sync.TV.Show')

// Show-level asset fields eligible for field-absence cleanup. TV uses BARE field
// paths (no `urls.` prefix) — show fileAvailability is built from the show object
// directly (run/availability). buildTVShowEntity below writes these fields.
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
   */
  async syncTVShow(showTitle: string, context: SyncContext): Promise<SyncResult[]> {
    const allResults: SyncResult[] = []

    syncEventBus.emitStarted(showTitle, MediaType.TVShow, context.serverConfig.id)

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
        payloadFingerprint(context.fileServerData?.tv?.[showTitle]),
        availabilityFingerprint(context.fieldAvailability, 'tv', showTitle)
      )

      // The first of the pass's two reads of the show: the gate check, the
      // drift checks and the show's plan all work from it.
      const existing = await this.tvShowRepository.findByOriginalTitle(showTitle)

      if (!context.forceSync && existing && readSyncGate(existing as any, context.serverConfig.id) === showGate) {
        const expectedEpisodes = this.countExpectedEpisodes(showTitle, context)
        const actualEpisodes = expectedEpisodes > 0
          ? await this.episodeRepository.getEpisodeCount(existing.title, undefined, (existing as any)._id)
          : 0
        // Season-count drift: a past cleanup can delete a show's seasons while
        // leaving its episodes intact and its hash unchanged. Without this
        // check the show would be skipped forever and the seasons never
        // re-created (episodes render under seasons, so the UI shows nothing).
        const expectedSeasons = this.countExpectedSeasons(showTitle, context)
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
          syncEventBus.emitComplete(showTitle, MediaType.TVShow, context.serverConfig.id, undefined, {
            totalOperations: 0, successful: 0, failed: 0
          })
          return [this.makeResult(
            showTitle, context, MediaType.TVShow, SyncOperation.Metadata, SyncStatus.Skipped, [], []
          )]
        }

        syncLogger.info(
          `Show "${showTitle}": gate matches but DB has ${actualEpisodes}/${expectedEpisodes} ` +
          `episodes, ${actualSeasons}/${expectedSeasons} seasons — forcing full sync to repair drift`
        )
        // fall through to full sync — missing seasons/episodes will be $setOnInsert'd
      }

      // 1. The show's plan, with priority checking (async — may fetch metadata),
      //    and the document it leaves. Field-absence cleanup's removals are
      //    not taken out of that document: they go to the write as $unset.
      const showFileData = context.fileServerData?.tv?.[showTitle]
      const built = await this.planTVShow(showTitle, showFileData, context, existing)
      const showEntity = applyWritePlan(existing, built.plan)

      // Field-absence cleanup: drop show-level assets no enabled server reports
      // anymore. planFieldCleanup logs (both modes) and returns `unset` only in
      // enforce. showTitle is the originalTitle (fieldAvailability key).
      const cleanupPlan = planFieldCleanup({
        cleanup: context.cleanup,
        mediaType: 'tv',
        availabilityKey: showTitle,
        entity: existing,
        fieldAvailability: context.fieldAvailability,
        fields: TVSHOW_CLEANABLE_FIELDS,
        log: (obj, msg) => pinoLog.info(obj, msg),
        logContext: { show: showEntity.title, originalTitle: showTitle },
      })

      // 2. One plan for the show's write (core/writePlan): the cleanup's
      //    removals first, then the builder's plan.
      const showPlan = mergeWritePlans<TVShowEntity>([cleanupWritePlan(cleanupPlan), built.plan])

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
        const gates = nextSyncGates(storedGates, context.serverConfig.id, null, true)
        if (!isEqual(gates, storedGates)) (showEntity as any).syncGates = gates
      }
      await this.tvShowRepository.smartUpsert(showEntity, existing, { unset: showPlan.unset })

      allResults.push(this.makeResult(
        showTitle, context, MediaType.TVShow, SyncOperation.Metadata,
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
      childResults.push(...await this.seasonSyncService.syncShow(showTitle, context, storedShow))

      // 5. Bulk-upsert all episodes (one bulkWrite per season)
      childResults.push(...await this.episodeSyncService.syncShow(showTitle, context, storedShow))
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
      const passPlan = mergeWritePlans<TVShowEntity>([showPlan, childrenWritePlan(childResults)])
      const gateToStamp = passPlan.gate === 'stamp' ? showGate : null
      if (!gateToStamp) {
        syncLogger.debug(`Gate left open for show "${showTitle}": ${passPlan.deferrals.join(', ')}`)
      }
      const closedOut = await this.finalizeShow(showTitle, storedShow, {
        gate: gateToStamp,
        subtreeChanged,
        serverId: context.serverConfig.id,
      })
      if (!closedOut) {
        // The gates were not settled: the show keeps the ones it had before
        // this pass, which a pass that changed the subtree should have reset.
        // Reported as a failure, so the run is not taken as complete and the
        // next tick is not skipped on those gates (sync/run/tickSkip).
        allResults.push(this.makeResult(
          showTitle, context, MediaType.TVShow, SyncOperation.Metadata, SyncStatus.Failed, [],
          ['Closing out the show failed: its gate was not settled']
        ))
      }

      syncEventBus.emitComplete(showTitle, MediaType.TVShow, context.serverConfig.id, undefined, {
        totalOperations: allResults.length,
        successful: allResults.filter(r => r.status === SyncStatus.Completed).length,
        failed: allResults.filter(r => r.status === SyncStatus.Failed).length
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      const stack = error instanceof Error ? error.stack : undefined
      syncEventBus.emitError(showTitle, MediaType.TVShow, context.serverConfig.id, msg)
      // Surface the failure to Pino logs — emitError only fans out to SSE
      // subscribers, and `syncLogger` is a console-based rate-limited
      // logger that doesn't reach SigNoz. Without this the failure was
      // silently counted in the pass's errors with no observability
      // footprint.
      pinoLog.error(
        { showTitle, serverId: context.serverConfig.id, err: msg, stack },
        `TV show sync failed: ${showTitle}`
      )
      allResults.push(this.makeResult(
        showTitle, context, MediaType.TVShow, SyncOperation.Metadata, SyncStatus.Failed, [], [msg]
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
   * The show's write plan: the stored show with the incoming file-server data
   * merged on top, respecting per-field server priority.
   *
   * - If the document already exists, start from it (preserving all fields).
   * - For each field group (metadata, poster, backdrop, logo), only overwrite
   *   if the current server has highest priority for that field.
   * - Structural fields (type, createdAt) are healed if missing.
   *
   * The plan's removals are the fields whose data is gone, not changed. It is
   * incomplete, and its deferrals name why, when the metadata fetch failed,
   * the stored season count was kept above this run's because a server did
   * not answer, or a blurhash the file server publishes could not be fetched.
   * The plan always writes the show: it stamps lastSynced.
   */
  private async planTVShow(
    showTitle: string,
    fileData: any,
    context: SyncContext,
    existing: TVShowEntity | null
  ): Promise<PlanOutcome<TVShowEntity>> {
    const now = new Date()
    // What was held back, and why (the plan's incomplete and deferrals).
    const plan = emptyWritePlan<TVShowEntity>()
    const holdBack = (reason: string) => {
      plan.incomplete = true
      plan.deferrals.push(reason)
    }
    // Fields to remove from the stored show: their data is gone, not changed.
    const unset: string[] = []

    // The show this pass wants stored: the existing doc (preserving ALL
    // fields) or a new one. Either way the pass stamps lastSynced, so the
    // plan writes the show (wroteDocument).
    const entity: TVShowEntity = existing
      ? { ...existing, lastSynced: now }
      : {
          title: showTitle,
          originalTitle: showTitle,
          type: 'tvShow',
          createdAt: now,
          lastSynced: now,
          titleSource: context.serverConfig.id,
          originalTitleSource: context.serverConfig.id,
        }
    const planned = (): PlanOutcome<TVShowEntity> => ({
      plan: { ...plan, ...draftWritePlan(existing, entity, unset) },
      wroteDocument: true,
    })

    // Heal structural fields that must always be present
    if (!entity.type) entity.type = 'tvShow'
    if (!entity.createdAt) entity.createdAt = now
    if (!entity.originalTitle) entity.originalTitle = showTitle
    // Library-add date: seeded once, never moved later (core/discovery.ts).
    // The show's own date is for detail pages; "Recently Added" ranks a show by
    // its newest EPISODE, so a new season of an old show still surfaces.
    seedDiscovery(entity, existing, context.serverConfig.id, now)

    if (!fileData) return planned()
    const locked = (field: string) => isTopLevelFieldLocked((existing as any)?.lockedFields, field)

    // --- Metadata (priority-gated) ---
    // Tracks whether we have a CONFIRMED fresh metadata source. Default true so
    // that "nothing to fetch" / "not metadata-authoritative" never blocks the
    // show's gate; only an attempted-but-failed fetch flips it false.
    let metadataFetchSucceeded = true
    // The show's metadata — and with it the show's identity below — belongs to
    // the highest-priority server that HAS a metadata file for it. The legacy
    // check also passed a higher-priority server that has none; it had nothing
    // to write as metadata, but it did write its own identity, and when two
    // servers' ids differed the show's mediaId changed twice per run.
    const canUpdateMetadata = isCurrentServerHighestPriorityForReportedField(
      context.fieldAvailability, 'tv', showTitle, 'metadata', context.serverConfig
    )

    if (canUpdateMetadata && fileData.metadata) {
      // fileData.metadata is a URL path to the metadata JSON — fetch actual data
      let showMetadata: any = null

      if (typeof fileData.metadata === 'string') {
        // URL path — fetch real metadata from the file server. Mark the gate as
        // not-yet-confirmed: only a usable response flips it back true below, so
        // a failed/stale fetch leaves the gate unstamped for retry next sync.
        metadataFetchSucceeded = false
        try {
          showMetadata = await fetchMetadataMultiServer(
            context.serverConfig.id,
            fileData.metadata,
            'file',
            'tv',
            showTitle
          )
        } catch {
          // Fetch failed — preserve existing metadata
        }
      } else if (typeof fileData.metadata === 'object') {
        // Already inline (rare, but handle gracefully) — a fresh source
        showMetadata = fileData.metadata
      }

      const fetchedUsable = Boolean(showMetadata && typeof showMetadata === 'object' && !showMetadata.error)
      if (fetchedUsable) {
        metadataFetchSucceeded = true
      }
      // Metadata an admin locked stays as stored, and so do the fields taken
      // from it: the fetched copy is dropped on the way to the database
      // (core/metadataLock).
      const metadata = effectiveMetadata<any>({
        stored: existing ? { metadata: existing.metadata, metadataSource: existing.metadataSource } : null,
        incoming: fetchedUsable ? { metadata: showMetadata, metadataSource: context.serverConfig.id } : null,
        locked: locked('metadata'),
      })
      if (metadata.action === 'write') {
        const fresh = metadata.metadata
        entity.metadata = fresh
        entity.metadataSource = metadata.metadataSource

        // Extract queryable fields from metadata (matching legacy document shape)
        if (fresh.first_air_date) entity.firstAirDate = new Date(fresh.first_air_date)
        if (fresh.last_air_date) entity.lastAirDate = new Date(fresh.last_air_date)
        if (fresh.status) entity.status = fresh.status
        if (fresh.number_of_seasons != null) entity.numberOfSeasons = fresh.number_of_seasons
        if (fresh.vote_average != null) entity.rating = fresh.vote_average
        if (fresh.overview) entity.overview = fresh.overview
        if (fresh.genres) entity.genres = fresh.genres
        if (fresh.networks) entity.networks = fresh.networks
      }
    }
    // A failed or stale metadata fetch leaves the gate open for the next run
    // to retry.
    if (!metadataFetchSucceeded) holdBack('metadata')

    // --- Display title (core/title) ---
    // Derived on every pass from the metadata the show ends this pass with
    // (`entity.metadata` is the fresh copy written above, or what is stored),
    // so it never depends on which server last fetched. The source goes with
    // it; a locked title keeps its source, and the title itself is dropped at
    // the write chokepoint.
    const titleRule = resolveTitle({
      originalTitle: showTitle,
      metadata: { metadata: entity.metadata, metadataSource: entity.metadataSource },
      fieldAvailability: context.fieldAvailability,
      mediaType: 'tv',
      serverConfig: context.serverConfig,
      stored: existing,
      locks: { title: locked('title') },
    })
    if (titleRule.writeTitle) entity.title = titleRule.title
    if (titleRule.writeTitleSource) entity.titleSource = titleRule.titleSource

    // --- Show identity (follows metadata priority) ---
    // A show has no video of its own, so the metadata owner — the show-level
    // ownership signal this builder already has — publishes it. mediaId is
    // SET-ONLY: a payload that cannot resolve it sends null, which must never
    // clear what we hold.
    if (canUpdateMetadata) {
      const incomingShowMediaId = resolveMediaId(fileData.mediaIdentity)
      if (incomingShowMediaId) entity.mediaId = incomingShowMediaId
    }

    // --- Library-add date (earlier-wins, core/discovery.ts) ---
    // The backend's sidecar date is adopted only when it predates ours. Every
    // server that has the show is heard: the earliest date any of them holds
    // is when the show entered the library. Heard from the metadata owner
    // alone, the date depended on which server was down when the show was
    // first synced.
    applyFirstSeen(entity, fileData.mediaIdentity, context.serverConfig.id, now, (heldServerId) =>
      serverOutranks(context.serverConfig, heldServerId)
    )

    // --- Poster, backdrop, logo ---
    // Each belongs to the highest-priority server among those that report it
    // (ties broken on server id). A server the availability map does not list
    // for the field never owns it. The fail-open check these used also let
    // through a server when no server reported the field, and every server
    // of the best priority, so with two of them the show held whichever
    // synced last.
    const canUpdatePoster = isCurrentServerHighestPriorityForReportedField(
      context.fieldAvailability, 'tv', showTitle, 'poster', context.serverConfig
    )
    if (canUpdatePoster && (fileData.posterURL || fileData.poster)) {
      entity.posterURL = fileServerUrl(fileData.posterURL || fileData.poster, context.serverConfig)
      entity.posterSource = context.serverConfig.id
    }

    const canUpdateBackdrop = isCurrentServerHighestPriorityForReportedField(
      context.fieldAvailability, 'tv', showTitle, 'backdrop', context.serverConfig
    )
    if (canUpdateBackdrop && (fileData.backdropURL || fileData.backdrop)) {
      entity.backdrop = fileServerUrl(fileData.backdropURL || fileData.backdrop, context.serverConfig)
      entity.backdropSource = context.serverConfig.id
    }

    const canUpdateLogo = isCurrentServerHighestPriorityForReportedField(
      context.fieldAvailability, 'tv', showTitle, 'logo', context.serverConfig
    )
    if (canUpdateLogo && (fileData.logoURL || fileData.logo)) {
      entity.logo = fileServerUrl(fileData.logoURL || fileData.logo, context.serverConfig)
      entity.logoSource = context.serverConfig.id
    }

    // --- Poster / backdrop blurhash ---
    // Kept, fetched or removed by the one rule every image follows
    // (core/imageAndBlurhash): settled by the image's owner, removed when it
    // is of another image and nothing replaces it. A failed fetch is reported,
    // so the show is not skipped from now on without it.
    const applyBlurhashRule = async (
      ownsImage: boolean,
      blurhashPath: unknown,
      imagePath: unknown,
      imageField: 'posterURL' | 'backdrop',
      field: 'posterBlurhash' | 'backdropBlurhash'
    ) => {
      const sourceField = `${field}Source`
      const outcome = await resolveBlurhash(
        {
          stored: {
            url: (existing as any)?.[imageField],
            blurhash: (existing as any)?.[field],
            blurhashSource: (existing as any)?.[sourceField],
          },
          reported: {
            url: ownsImage && imagePath ? fileServerUrl(imagePath as string, context.serverConfig) : null,
            blurhashUrl: blurhashPath as string | null | undefined,
          },
          owner: ownsImage ? context.serverConfig.id : null,
          locks: { image: locked(imageField), blurhash: locked(field) },
        },
        async (path) => {
          try {
            return await fetchMetadataMultiServer(
              context.serverConfig.id,
              fileServerUrl(path, context.serverConfig),
              'blurhash',
              'tv',
              showTitle
            )
          } catch {
            return null // a failed fetch, reported through the outcome
          }
        }
      )

      if (outcome.action === 'write') {
        (entity as any)[field] = outcome.blurhash
        ;(entity as any)[sourceField] = outcome.blurhashSource
        return
      }
      if (outcome.fetchFailed) holdBack(field)
      if (outcome.action === 'unset') {
        delete (entity as any)[field]
        delete (entity as any)[sourceField]
        unset.push(field, sourceField)
      }
    }
    await applyBlurhashRule(canUpdatePoster, fileData.posterBlurhash, fileData.posterURL || fileData.poster, 'posterURL', 'posterBlurhash')
    await applyBlurhashRule(canUpdateBackdrop, fileData.backdropBlurhash, fileData.backdropURL || fileData.backdrop, 'backdrop', 'backdropBlurhash')

    // Season count: the seasons any server has, counted once each. It used to
    // be each server's own count, written by every pass, so a show whose
    // seasons are split across servers (or whose folder on the main server
    // holds only artwork) ended on whichever server synced last.
    const seasonCount = this.countSeasonsAcrossServers(showTitle, fileData, context)
    const everyServerAnswered =
      (context.allEnabledServersProbed ?? context.cleanup?.allEnabledServersProbed) === true
    if (seasonCount !== null) {
      // With a server missing, its seasons are missing from the count. Do not
      // let it drop on such a run: the seasons have not gone anywhere. The
      // caller is told, so the lower count is applied on the next run where
      // every server answers instead of this pass being skipped from now on.
      const stored = (existing as any)?.seasonCount
      const seasonCountHeld = !everyServerAnswered && typeof stored === 'number' && stored > seasonCount
      entity.seasonCount = seasonCountHeld ? stored : seasonCount
      if (seasonCountHeld) holdBack('seasonCount')
    }

    // The show's gate is NOT stamped here. syncTVShow settles it after the
    // seasons and episodes are written (finalizeShow); the plan's
    // `incomplete` tells it whether this part may be counted as done.
    return planned()
  }

  /**
   * Count episodes expected for this show based on the file-server data —
   * sum of episode keys across every season. Used as the "expected" side of
   * the show-level integrity check.
   */
  private countExpectedEpisodes(showTitle: string, context: SyncContext): number {
    const seasons = context.fileServerData?.tv?.[showTitle]?.seasons
    if (!seasons) return 0
    // Only seasons the sync can store: a folder whose name has no number in it
    // ("Specials") is never written, and counting its episodes as expected
    // made the show look short of episodes — and so never skippable — forever.
    return Object.entries(seasons)
      .filter(([key]) => /(?:season_?|s)?(\d+)/i.test(key))
      .reduce<number>((sum, [, s]: [string, any]) => sum + Object.keys(s?.episodes || {}).length, 0)
  }

  /**
   * The number of distinct seasons of a show across every server that answered
   * this run, read from the availability map (its paths start with the literal
   * season key each server sent). Falls back to this server's own payload when
   * the map has nothing for the show. Null when neither says anything.
   */
  private countSeasonsAcrossServers(showTitle: string, fileData: any, context: SyncContext): number | null {
    const seasonNumbers = new Set<number>()
    const note = (seasonKey: string) => {
      const match = seasonKey.match(/(?:season_?|s)?(\d+)/i)
      if (match) seasonNumbers.add(parseInt(match[1], 10))
    }

    const bucket = (context.fieldAvailability as any)?.tv?.[showTitle]
    if (bucket && typeof bucket === 'object') {
      for (const path of Object.keys(bucket)) {
        if (!path.startsWith('seasons.')) continue
        const rest = path.slice('seasons.'.length)
        // The season key ends where the season's own fields begin.
        const end = rest.search(/\.(episodes|lengths|dimensions|season_poster|seasonPosterBlurhash|seasonNumber)(\.|$)/)
        if (end > 0) note(rest.slice(0, end))
      }
    }
    if (seasonNumbers.size > 0) return seasonNumbers.size

    if (typeof fileData?.seasonCount === 'number') return fileData.seasonCount
    if (fileData?.seasons && typeof fileData.seasons === 'object') {
      for (const seasonKey of Object.keys(fileData.seasons)) note(seasonKey)
      return seasonNumbers.size
    }
    return null
  }

  /**
   * Count seasons expected for this show from the file-server data. Counts only
   * keys that parse to a valid season number (matching what
   * SeasonSyncService.parseSeasonNumber persists), so a non-numeric season key
   * cannot perpetually force a full sync. Used as the "expected" side of the
   * show-level season-drift check.
   */
  private countExpectedSeasons(showTitle: string, context: SyncContext): number {
    const seasons = context.fileServerData?.tv?.[showTitle]?.seasons
    if (!seasons) return 0
    return Object.keys(seasons).filter(k => /(?:season_?|s)?(\d+)/i.test(k)).length
  }

  private makeResult(
    entityId: string,
    context: SyncContext,
    mediaType: MediaType,
    operation: SyncOperation,
    status: SyncStatus,
    changes: string[],
    errors: string[],
    metadata?: Record<string, any>
  ): SyncResult {
    return {
      status, entityId, mediaType, operation,
      serverId: context.serverConfig.id,
      timestamp: new Date(),
      changes, errors,
      // Carry the display title up to run/serverPass so post-sync cache
      // invalidation can build the correct page tags (tags key on display
      // title, not the originalTitle/showTitle filesystem key).
      ...(metadata ? { metadata } : {})
    }
  }
}
