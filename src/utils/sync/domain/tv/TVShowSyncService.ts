/**
 * TV Show sync service — orchestrates show-level upserts and delegates to
 * SeasonSyncService and EpisodeSyncService for bulk season/episode writes.
 *
 * Write pattern summary:
 *  • TV Shows  — one tvShows.upsert() per show (low volume, one entity per show).
 *  • Seasons   — SeasonSyncService.syncShow()   → one bulkUpsertShow()  per show.
 *  • Episodes  — EpisodeSyncService.syncSeason() → one bulkUpsertSeason() per season.
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
      // 1. Upsert the show-level document (one write per show — low volume)
      const showFileData = context.fileServerData?.tv?.[showTitle]
      const showEntity = this.buildTVShowEntity(showTitle, showFileData, context)
      await this.tvShowRepository.upsert(showEntity)

      allResults.push(this.makeResult(
        showTitle, context, MediaType.TVShow, SyncOperation.Metadata,
        SyncStatus.Completed, [`Upserted TV show "${showTitle}"`], []
      ))

      // 2. Bulk-upsert all seasons (one bulkWrite per show)
      allResults.push(...await this.seasonSyncService.syncShow(showTitle, context))

      // 3. Bulk-upsert all episodes (one bulkWrite per season)
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

  private buildTVShowEntity(
    showTitle: string,
    fileData: any,
    context: SyncContext
  ): TVShowEntity {
    const entity: TVShowEntity = {
      title: fileData?.title || showTitle,
      originalTitle: fileData?.originalTitle || showTitle,
      lastSynced: new Date()
    }

    if (fileData?.posterURL || fileData?.poster) entity.posterURL = fileData.posterURL || fileData.poster
    if (fileData?.backdropURL || fileData?.backdrop) entity.backdropURL = fileData.backdropURL || fileData.backdrop
    if (fileData?.logoURL || fileData?.logo) entity.logoURL = fileData.logoURL || fileData.logo
    if (typeof fileData?.seasonCount === 'number') {
      entity.seasonCount = fileData.seasonCount
    } else if (fileData?.seasons && typeof fileData.seasons === 'object') {
      entity.seasonCount = Object.keys(fileData.seasons).length
    }
    if (fileData?.posterBlurhash) entity.posterBlurhash = fileData.posterBlurhash
    if (fileData?.backdropBlurhash) entity.backdropBlurhash = fileData.backdropBlurhash
    if (fileData?.metadata && typeof fileData.metadata === 'object') entity.metadata = fileData.metadata

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
