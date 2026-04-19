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
  syncEventBus
} from '../../core'

import { TVShowRepository } from '../../infrastructure'
import { SeasonSyncService } from './SeasonSyncService'
import { EpisodeSyncService } from './EpisodeSyncService'
import { isCurrentServerHighestPriorityForField, createFullUrl, extractUrlHash } from '@src/utils/sync/utils'
import { fetchMetadataMultiServer } from '@src/utils/admin_utils'

export class TVShowSyncService {
  constructor(
    private readonly tvShowRepository: TVShowRepository,
    private readonly seasonSyncService: SeasonSyncService,
    private readonly episodeSyncService: EpisodeSyncService
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
      // Show-level hash skip: if show hash unchanged, skip entire show (seasons + episodes)
      if (!context.forceSync && context.tvShowHashesCache) {
        const incomingShowHash = context.tvShowHashesCache.titles?.[showTitle]?.hash
        if (incomingShowHash) {
          const cached = await this.tvShowRepository.findByOriginalTitle(showTitle)
          if (cached?.syncHash && cached.syncHash === incomingShowHash) {
            syncEventBus.emitComplete(showTitle, MediaType.TVShow, context.serverConfig.id, undefined, {
              totalOperations: 0, successful: 0, failed: 0
            })
            return [this.makeResult(
              showTitle, context, MediaType.TVShow, SyncOperation.Metadata, SyncStatus.Skipped, [], []
            )]
          }
        }
      }

      // 1. Read existing doc for merge
      const existing = await this.tvShowRepository.findByOriginalTitle(showTitle)

      // 2. Build merged entity with priority checking (async — may fetch metadata)
      const showFileData = context.fileServerData?.tv?.[showTitle]
      const showEntity = await this.buildTVShowEntity(showTitle, showFileData, context, existing)

      // 3. Smart write — $set changed fields only, skip if nothing changed
      await this.tvShowRepository.smartUpsert(showEntity, existing)

      allResults.push(this.makeResult(
        showTitle, context, MediaType.TVShow, SyncOperation.Metadata,
        SyncStatus.Completed, [`Upserted TV show "${showTitle}"`], []
      ))

      // 4. Bulk-upsert all seasons (one bulkWrite per show)
      allResults.push(...await this.seasonSyncService.syncShow(showTitle, context))

      // 5. Bulk-upsert all episodes (one bulkWrite per season)
      allResults.push(...await this.episodeSyncService.syncShow(showTitle, context))

      syncEventBus.emitComplete(showTitle, MediaType.TVShow, context.serverConfig.id, undefined, {
        totalOperations: allResults.length,
        successful: allResults.filter(r => r.status === SyncStatus.Completed).length,
        failed: allResults.filter(r => r.status === SyncStatus.Failed).length
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      syncEventBus.emitError(showTitle, MediaType.TVShow, context.serverConfig.id, msg)
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
  ): Promise<TVShowEntity> {
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

    if (!fileData) return entity

    // --- Metadata (priority-gated) ---
    const canUpdateMetadata = isCurrentServerHighestPriorityForField(
      context.fieldAvailability, 'tv', showTitle, 'metadata', context.serverConfig
    )

    if (canUpdateMetadata && fileData.metadata) {
      // fileData.metadata is a URL path to the metadata JSON — fetch actual data
      let showMetadata: any = null

      if (typeof fileData.metadata === 'string') {
        // URL path — fetch real metadata from the file server
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
        // Already inline (rare, but handle gracefully)
        showMetadata = fileData.metadata
      }

      if (showMetadata && typeof showMetadata === 'object' && !showMetadata.error) {
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

    // --- Poster Blurhash (priority-gated, fetch actual blurhash string) ---
    const canUpdatePosterBlurhash = isCurrentServerHighestPriorityForField(
      context.fieldAvailability, 'tv', showTitle, 'posterBlurhash', context.serverConfig
    )
    if (canUpdatePosterBlurhash && fileData.posterBlurhash) {
      // Skip fetch if the poster image file hasn't changed (?hash= param comparison)
      const newPosterUrl = (fileData.posterURL || fileData.poster)
        ? createFullUrl(fileData.posterURL || fileData.poster, context.serverConfig) : null
      const posterImageChanged = extractUrlHash(newPosterUrl ?? '') !== extractUrlHash(existing?.posterURL ?? '')
      if (posterImageChanged || !existing?.posterBlurhash) {
        try {
          const blurhashUrl = createFullUrl(fileData.posterBlurhash, context.serverConfig)
          const blurhash = await fetchMetadataMultiServer(
            context.serverConfig.id, blurhashUrl, 'blurhash', 'tv', showTitle
          )
          if (blurhash && typeof blurhash === 'string' && !(blurhash as any).error) {
            entity.posterBlurhash = blurhash
            entity.posterBlurhashSource = context.serverConfig.id
          }
        } catch {
          // Blurhash fetch failed — preserve existing value from spread
        }
      }
      // else: poster image unchanged, existing posterBlurhash preserved by spread
    }

    // --- Backdrop Blurhash (priority-gated, fetch actual blurhash string) ---
    const canUpdateBackdropBlurhash = isCurrentServerHighestPriorityForField(
      context.fieldAvailability, 'tv', showTitle, 'backdropBlurhash', context.serverConfig
    )
    if (canUpdateBackdropBlurhash && fileData.backdropBlurhash) {
      // Skip fetch if the backdrop image file hasn't changed (?hash= param comparison)
      const newBackdropUrl = (fileData.backdropURL || fileData.backdrop)
        ? createFullUrl(fileData.backdropURL || fileData.backdrop, context.serverConfig) : null
      const backdropImageChanged = extractUrlHash(newBackdropUrl ?? '') !== extractUrlHash(existing?.backdrop ?? '')
      if (backdropImageChanged || !existing?.backdropBlurhash) {
        try {
          const blurhashUrl = createFullUrl(fileData.backdropBlurhash, context.serverConfig)
          const blurhash = await fetchMetadataMultiServer(
            context.serverConfig.id, blurhashUrl, 'blurhash', 'tv', showTitle
          )
          if (blurhash && typeof blurhash === 'string' && !(blurhash as any).error) {
            entity.backdropBlurhash = blurhash
            entity.backdropBlurhashSource = context.serverConfig.id
          }
        } catch {
          // Blurhash fetch failed — preserve existing value from spread
        }
      }
      // else: backdrop image unchanged, existing backdropBlurhash preserved by spread
    }

    // Season count (computed, no priority gate)
    if (typeof fileData.seasonCount === 'number') {
      entity.seasonCount = fileData.seasonCount
    } else if (fileData.seasons && typeof fileData.seasons === 'object') {
      entity.seasonCount = Object.keys(fileData.seasons).length
    }

    // Store incoming show hash so next sync can compare and potentially skip entire show
    const incomingShowHash = context.tvShowHashesCache?.titles?.[showTitle]?.hash
    if (incomingShowHash) entity.syncHash = incomingShowHash

    return entity
  }

  private makeResult(
    entityId: string,
    context: SyncContext,
    mediaType: MediaType,
    operation: SyncOperation,
    status: SyncStatus,
    changes: string[],
    errors: string[]
  ): SyncResult {
    return {
      status, entityId, mediaType, operation,
      serverId: context.serverConfig.id,
      timestamp: new Date(),
      changes, errors
    }
  }
}
