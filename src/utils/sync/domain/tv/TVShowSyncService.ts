/**
 * TV Show sync service — orchestrates show-level upserts and delegates to
 * SeasonSyncService and EpisodeSyncService for bulk season/episode writes.
 *
 * Write pattern: read-merge-replace (atomic replacement based on server priority)
 *  1. Read existing document from the database.
 *  2. Merge incoming file-server data on top, checking priority per field.
 *  3. replaceOne the document atomically — no partial $set operations.
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
  BatchSyncResult,
  syncEventBus,
  planFieldCleanup,
  type CleanableField
} from '../../core'

import { TVShowRepository, EpisodeRepository, SeasonRepository, isTopLevelFieldLocked } from '../../infrastructure'
import { SeasonSyncService } from './SeasonSyncService'
import { EpisodeSyncService } from './EpisodeSyncService'
import {
  isCurrentServerHighestPriorityForField,
  isCurrentServerHighestPriorityForReportedField,
  createFullUrl,
  availabilityFingerprint,
  payloadFingerprint,
  serverOutranks,
} from '@src/utils/sync/utils'
import { buildSyncGate, readSyncGate, changesDocument, nextSyncGates } from '../../core/syncGate'
import isEqual from 'lodash/isEqual'
import { fetchMetadataMultiServer } from '@src/utils/admin_utils'
import { syncLogger } from '../../core/logger'
import { seedDiscovery, applyFirstSeen } from '../../core/discovery'
import { resolveMediaId } from '../../core/deliveryFacts'
import { createLogger } from '@src/lib/logger'

const pinoLog = createLogger('Sync.TV.Show')

// Show-level asset fields eligible for field-absence cleanup. TV uses BARE field
// paths (no `urls.` prefix) — show fileAvailability is built from the show object
// directly. See src/utils/flatSync/tvShows/{poster,backdrop,logos}.js.
const TVSHOW_CLEANABLE_FIELDS: CleanableField[] = [
  { entityField: 'posterURL', fieldPath: 'poster', companions: ['posterSource', 'posterBlurhash', 'posterBlurhashSource'] },
  { entityField: 'backdrop', fieldPath: 'backdrop', companions: ['backdropSource', 'backdropBlurhash', 'backdropBlurhashSource'] },
  { entityField: 'logo', fieldPath: 'logo', companions: ['logoSource', 'logoBlurhash'] },
]

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
   *  1. tvShowRepository.upsert(show)          — one write for the show header.
   *  2. seasonSyncService.syncShow(showTitle)   → bulkUpsertShow() for all seasons.
   *  3. episodeSyncService.syncShow(showTitle)  → bulkUpsertSeason() per season.
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
      const incoming = context.tvShowHashesCache?.titles?.[showTitle]
      const showGate = buildSyncGate(
        payloadFingerprint(context.fileServerData?.tv?.[showTitle]),
        availabilityFingerprint(context.fieldAvailability, 'tv', showTitle)
      )

      if (!context.forceSync) {
        const cached = await this.tvShowRepository.findByOriginalTitle(showTitle)

        if (cached && readSyncGate(cached as any, context.serverConfig.id) === showGate) {
          const expectedEpisodes = this.countExpectedEpisodes(showTitle, context)
          const actualEpisodes = expectedEpisodes > 0
            ? await this.episodeRepository.getEpisodeCount(cached.title, undefined, (cached as any)._id)
            : 0
          // Season-count drift: a past cleanup can delete a show's seasons while
          // leaving its episodes intact and its hash unchanged. Without this
          // check the show would be skipped forever and the seasons never
          // re-created (episodes render under seasons, so the UI shows nothing).
          const expectedSeasons = this.countExpectedSeasons(showTitle, context)
          const actualSeasons = expectedSeasons > 0
            ? await this.seasonRepository.getSeasonCount(cached.title, (cached as any)._id)
            : 0

          if (actualEpisodes >= expectedEpisodes && actualSeasons >= expectedSeasons) {
            // One-time backfill: a show that early-skips forever would never
            // acquire visibleEpisodeCount (episode visibility inputs are in
            // the episode hash, so any real change routes through the full
            // sync below). visibleShowFilter fails open on the missing
            // field, so this is convergence, not correctness.
            if ((cached as any).visibleEpisodeCount === undefined) {
              await this.finalizeShow(showTitle, cached, null)
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
      }

      // 1. Read existing doc for merge
      const existing = await this.tvShowRepository.findByOriginalTitle(showTitle)

      // 2. Build merged entity with priority checking (async — may fetch metadata)
      const showFileData = context.fileServerData?.tv?.[showTitle]
      const { entity: showEntity, metadataFetchSucceeded, seasonCountHeld, fetchIncomplete, unset: builtUnset } = await this.buildTVShowEntity(
        showTitle, showFileData, context, existing
      )

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

      // 3. Smart write — $set changed fields only, skip if nothing changed,
      //    plus $unset any cleared assets (enforce mode).
      const showUnset = [...new Set([...(cleanupPlan.unset ?? []), ...builtUnset])]
      const showChanged = changesDocument(existing as any, showEntity as any, showUnset)
      await this.tvShowRepository.smartUpsert(showEntity, existing, { unset: showUnset })

      allResults.push(this.makeResult(
        showTitle, context, MediaType.TVShow, SyncOperation.Metadata,
        SyncStatus.Completed, [`Upserted TV show "${showTitle}"`, ...cleanupPlan.changes], [],
        { displayTitle: showEntity.title }
      ))

      // 4. Bulk-upsert all seasons (one bulkWrite per show)
      const childResults: SyncResult[] = []
      childResults.push(...await this.seasonSyncService.syncShow(showTitle, context))

      // 5. Bulk-upsert all episodes (one bulkWrite per season)
      childResults.push(...await this.episodeSyncService.syncShow(showTitle, context))
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
      const childFailed = childResults.some(r => r.status === SyncStatus.Failed)
      const gateLeftOpen = childResults.some(r => (r.metadata as any)?.gateLeftOpen === true)
      const subtreeChanged =
        showChanged || childResults.some(r => (r.metadata as any)?.documentChanged === true)
      // `seasonCountHeld` and `cleanupPlan.withheld` are both a removal held
      // back because not every server answered: the pass has to run again on a
      // run where they all do, so it may not be marked complete.
      const gateToStamp =
        metadataFetchSucceeded && !childFailed && !gateLeftOpen &&
        cleanupPlan.withheld !== true && !seasonCountHeld && !fetchIncomplete
          ? showGate
          : null
      await this.finalizeShow(showTitle, null, {
        gate: gateToStamp,
        subtreeChanged,
        hash: incoming?.hash,
        contentHash: incoming?.contentHash,
        serverId: context.serverConfig.id,
      })

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
      // silently counted in BatchSyncResult.errors with no observability
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

  /**
   * Sync multiple TV shows with controlled concurrency.
   */
  async syncTVShows(
    showTitles: string[],
    context: SyncContext,
    concurrency: number = 3
  ): Promise<BatchSyncResult> {
    const startTime = Date.now()
    const allResults: SyncResult[] = []

    for (let i = 0; i < showTitles.length; i += concurrency) {
      const batch = showTitles.slice(i, i + concurrency)
      const settled = await Promise.allSettled(
        batch.map(title => this.syncTVShow(title, context))
      )
      for (const r of settled) {
        if (r.status === 'fulfilled') allResults.push(...r.value)
      }
    }

    const summary = {
      total: allResults.length,
      completed: allResults.filter(r => r.status === SyncStatus.Completed).length,
      failed: allResults.filter(r => r.status === SyncStatus.Failed).length,
      skipped: allResults.filter(r => r.status === SyncStatus.Skipped).length
    }

    return {
      results: allResults,
      summary,
      duration: Date.now() - startTime,
      errors: allResults.filter(r => r.errors.length > 0).flatMap(r => r.errors)
    }
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
   * Never fails the sync: a stale count degrades to slightly-wrong list
   * filtering, and an unstamped gate just means the show is synced again.
   *
   * @param cachedShow pass the already-fetched doc on the skip path to save a
   *                   find; null on the full-sync path (re-fetched, since the
   *                   doc was just rewritten).
   * @param gating     null on the skip path (count only).
   */
  private async finalizeShow(
    showTitle: string,
    cachedShow: TVShowEntity | null,
    gating: {
      /** The gate to stamp, or null when the pass must be retried. */
      gate: string | null
      /** Whether the pass changed the show, a season or an episode. */
      subtreeChanged: boolean
      hash?: string
      contentHash?: string
      serverId: string
    } | null
  ): Promise<void> {
    try {
      const show = cachedShow ?? await this.tvShowRepository.findByOriginalTitle(showTitle)
      if (!show || !(show as any)._id) return

      const next: any = { ...show }
      next.visibleEpisodeCount = await this.episodeRepository.getVisibleEpisodeCount((show as any)._id)

      if (gating) {
        const storedGates = ((show as any).syncGates ?? {}) as Record<string, string>
        const gates = nextSyncGates(storedGates, gating.serverId, gating.gate, gating.subtreeChanged)
        if (!isEqual(gates, storedGates)) next.syncGates = gates
        // The last writer's hashes, kept for anything that reads them. The skip
        // decision reads the gate.
        if (gating.gate) {
          if (gating.hash) next.syncHash = gating.hash
          if (gating.contentHash) next.contentHash = gating.contentHash
        }
      }

      await this.tvShowRepository.smartUpsert(next as TVShowEntity, show)
    } catch (error) {
      pinoLog.warn(
        { showTitle, err: error instanceof Error ? error.message : String(error) },
        'closing out the show failed — its episode count or gate may lag one sync'
      )
    }
  }

  /**
   * Build a TV show entity by merging existing data with incoming file-server
   * data, respecting per-field server priority.
   *
   * - If the document already exists, start from it (preserving all fields).
   * - For each field group (metadata, poster, backdrop, logo), only overwrite
   *   if the current server has highest priority for that field.
   * - Structural fields (type, createdAt) are healed if missing.
   */
  private async buildTVShowEntity(
    showTitle: string,
    fileData: any,
    context: SyncContext,
    existing: TVShowEntity | null
  ): Promise<{
    entity: TVShowEntity
    metadataFetchSucceeded: boolean
    /** The stored season count was kept above this run's because a server did not answer. */
    seasonCountHeld: boolean
    /** A blurhash the file server publishes could not be fetched this pass. */
    fetchIncomplete: boolean
    /** Fields to remove from the stored show: their data is gone, not changed. */
    unset: string[]
  }> {
    const now = new Date()

    // Start from existing doc (preserving ALL fields) or create new
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

    // Heal structural fields that must always be present
    if (!entity.type) entity.type = 'tvShow'
    if (!entity.createdAt) entity.createdAt = now
    if (!entity.originalTitle) entity.originalTitle = showTitle
    // Library-add date: seeded once, never moved later (core/discovery.ts).
    // The show's own date is for detail pages; "Recently Added" ranks a show by
    // its newest EPISODE, so a new season of an old show still surfaces.
    seedDiscovery(entity, existing, context.serverConfig.id, now)

    if (!fileData) return { entity, metadataFetchSucceeded: true, seasonCountHeld: false, fetchIncomplete: false, unset: [] }
    let fetchIncomplete = false
    const unset: string[] = []
    const locked = (field: string) => isTopLevelFieldLocked((existing as any)?.lockedFields, field)

    // --- Metadata (priority-gated) ---
    // Tracks whether we have a CONFIRMED fresh metadata source. Default true so
    // that "nothing to fetch" / "not metadata-authoritative" never blocks the
    // syncHash gate; only an attempted-but-failed fetch flips it false.
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
        // a failed/stale fetch leaves syncHash unstamped for retry next sync.
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

      if (showMetadata && typeof showMetadata === 'object' && !showMetadata.error) {
        metadataFetchSucceeded = true
      }
      // Metadata an admin locked stays as stored, and so do the fields taken
      // from it: the fetched copy is dropped on the way to the database, and a
      // title derived from it would not be the stored metadata's.
      if (showMetadata && typeof showMetadata === 'object' && !showMetadata.error && !locked('metadata')) {
        entity.metadata = showMetadata
        entity.metadataSource = context.serverConfig.id

        // Extract queryable fields from metadata (matching legacy document shape)
        if (showMetadata.name) entity.title = showMetadata.name
        if (showMetadata.first_air_date) entity.firstAirDate = new Date(showMetadata.first_air_date)
        if (showMetadata.last_air_date) entity.lastAirDate = new Date(showMetadata.last_air_date)
        if (showMetadata.status) entity.status = showMetadata.status
        if (showMetadata.number_of_seasons != null) entity.numberOfSeasons = showMetadata.number_of_seasons
        if (showMetadata.vote_average != null) entity.rating = showMetadata.vote_average
        if (showMetadata.overview) entity.overview = showMetadata.overview
        if (showMetadata.genres) entity.genres = showMetadata.genres
        if (showMetadata.networks) entity.networks = showMetadata.networks
      }
    }

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

    // --- Poster (priority-gated) ---
    const canUpdatePoster = isCurrentServerHighestPriorityForField(
      context.fieldAvailability, 'tv', showTitle, 'poster', context.serverConfig
    )
    if (canUpdatePoster && (fileData.posterURL || fileData.poster)) {
      entity.posterURL = createFullUrl(fileData.posterURL || fileData.poster, context.serverConfig)
      entity.posterSource = context.serverConfig.id
    }

    // --- Backdrop (priority-gated) ---
    const canUpdateBackdrop = isCurrentServerHighestPriorityForField(
      context.fieldAvailability, 'tv', showTitle, 'backdrop', context.serverConfig
    )
    if (canUpdateBackdrop && (fileData.backdropURL || fileData.backdrop)) {
      entity.backdrop = createFullUrl(fileData.backdropURL || fileData.backdrop, context.serverConfig)
      entity.backdropSource = context.serverConfig.id
    }

    // --- Logo (priority-gated) ---
    const canUpdateLogo = isCurrentServerHighestPriorityForField(
      context.fieldAvailability, 'tv', showTitle, 'logo', context.serverConfig
    )
    if (canUpdateLogo && (fileData.logoURL || fileData.logo)) {
      entity.logo = createFullUrl(fileData.logoURL || fileData.logo, context.serverConfig)
      entity.logoSource = context.serverConfig.id
    }

    // --- Poster / backdrop blurhash ---
    // A stored blurhash is good only while it is OF THE STORED IMAGE: taken
    // from the server that owns the image, and not older than the image. One
    // that is not is replaced, and when this pass has nothing to replace it
    // with (no blurhash published for the image, or the fetch failed) it is
    // removed: no blurhash is right, another picture's is not. A failed fetch
    // is reported too, so the show is not skipped from now on without it.
    //
    // It used to be ranked on its own, so a show could hold one server's
    // poster with another's blurhash, and it was compared by the image URL's
    // ?hash= alone — the file's modified time, which a copy on another server
    // shares.
    const syncBlurhash = async (
      blurhashPath: unknown,
      imagePath: unknown,
      imageField: 'posterURL' | 'backdrop',
      field: 'posterBlurhash' | 'backdropBlurhash'
    ) => {
      if (!imagePath) return
      // An image an admin locked is not the file server's image, and a
      // blurhash an admin locked is not ours to change.
      if (locked(imageField) || locked(field)) return
      const sourceField = `${field}Source`
      const imageUrl = createFullUrl(imagePath as string, context.serverConfig)
      const stored = (existing as any)?.[field]
      const notOfThisImage =
        Boolean(stored) &&
        (imageUrl !== (existing as any)?.[imageField] || (existing as any)?.[sourceField] !== context.serverConfig.id)

      let blurhash: unknown = null
      if (blurhashPath && (!stored || notOfThisImage)) {
        try {
          blurhash = await fetchMetadataMultiServer(
            context.serverConfig.id,
            createFullUrl(blurhashPath as string, context.serverConfig),
            'blurhash',
            'tv',
            showTitle
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
        (entity as any)[field] = blurhash
        ;(entity as any)[sourceField] = context.serverConfig.id
      } else if (notOfThisImage) {
        delete (entity as any)[field]
        delete (entity as any)[sourceField]
        unset.push(field, sourceField)
      }
    }
    if (canUpdatePoster) {
      await syncBlurhash(fileData.posterBlurhash, fileData.posterURL || fileData.poster, 'posterURL', 'posterBlurhash')
    }
    if (canUpdateBackdrop) {
      await syncBlurhash(fileData.backdropBlurhash, fileData.backdropURL || fileData.backdrop, 'backdrop', 'backdropBlurhash')
    }

    // Season count: the seasons any server has, counted once each. It used to
    // be each server's own count, written by every pass, so a show whose
    // seasons are split across servers (or whose folder on the main server
    // holds only artwork) ended on whichever server synced last.
    const seasonCount = this.countSeasonsAcrossServers(showTitle, fileData, context)
    const everyServerAnswered =
      (context.allEnabledServersProbed ?? context.cleanup?.allEnabledServersProbed) === true
    let seasonCountHeld = false
    if (seasonCount !== null) {
      // With a server missing, its seasons are missing from the count. Do not
      // let it drop on such a run: the seasons have not gone anywhere. The
      // caller is told, so the lower count is applied on the next run where
      // every server answers instead of this pass being skipped from now on.
      const stored = (existing as any)?.seasonCount
      seasonCountHeld = !everyServerAnswered && typeof stored === 'number' && stored > seasonCount
      entity.seasonCount = seasonCountHeld ? stored : seasonCount
    }

    // The show's hashes are NOT stamped here. syncTVShow settles the gate after
    // the seasons and episodes are written (finalizeShow); `metadataFetchSucceeded`
    // tells it whether this part may be counted as done — a failed or stale
    // metadata fetch must leave the gate open for the next run to retry.
    return { entity, metadataFetchSucceeded, seasonCountHeld, fetchIncomplete, unset }
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
      // Carry the display title up to the adapter so post-sync cache
      // invalidation can build the correct page tags (tags key on display
      // title, not the originalTitle/showTitle filesystem key).
      ...(metadata ? { metadata } : {})
    }
  }
}
