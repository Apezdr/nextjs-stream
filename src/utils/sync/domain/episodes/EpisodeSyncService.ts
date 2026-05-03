/**
 * Episode sync service - domain orchestrator for all episode sync operations
 * Mirrors MovieSyncService pattern but operates at the episode/season level.
 *
 * Key difference from movie sync: episodes are ALWAYS bulk-written per season via
 * EpisodeRepository.bulkUpsertSeason(). Individual one-by-one writes are forbidden
 * to preserve performance with high-volume episode sets.
 */

import {
  EpisodeEntity,
  SyncContext,
  SyncResult,
  SyncStatus,
  MediaType,
  SyncOperation,
  SyncStrategy,
  DatabaseError,
  syncEventBus,
} from '../../core'

import { EpisodeRepository } from '../../infrastructure'
import { FileServerAdapter } from '../../core'
import { syncLogger } from '../../core/logger'

export class EpisodeSyncService {
  private repository: EpisodeRepository
  private fileAdapter: FileServerAdapter
  private strategies: Map<SyncOperation, SyncStrategy[]> = new Map()

  constructor(
    repository: EpisodeRepository,
    fileAdapter: FileServerAdapter,
    strategies: SyncStrategy[] = []
  ) {
    this.repository = repository
    this.fileAdapter = fileAdapter
    this.registerStrategies(strategies)
  }

  /**
   * Register sync strategies indexed by their supported operations
   */
  private registerStrategies(strategies: SyncStrategy[]): void {
    for (const strategy of strategies) {
      for (const operation of strategy.supportedOperations) {
        if (!this.strategies.has(operation)) {
          this.strategies.set(operation, [])
        }
        this.strategies.get(operation)!.push(strategy)
      }
    }
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Sync a single episode through all applicable strategies.
   *
   * @param showTitle     Display title of the TV show
   * @param seasonNumber  Season number (1-based)
   * @param episodeNumber Episode number within the season
   * @param context       Sync context carrying serverConfig, fieldAvailability, and
   *                      fileServerData (the raw file-server JSON for the show)
   * @param operations    Which operations to run (defaults to Content only)
   */
  async syncEpisode(
    showTitle: string,
    seasonNumber: number,
    episodeNumber: number,
    context: SyncContext,
    operations: SyncOperation[] = [SyncOperation.Content]
  ): Promise<SyncResult[]> {
    const entityId = `${showTitle} S${String(seasonNumber).padStart(2, '0')}E${String(episodeNumber).padStart(2, '0')}`
    const results: SyncResult[] = []

    syncLogger.debug(`[EpisodeSyncService] syncEpisode start: ${entityId}, server=${context.serverConfig.id}`)
    syncEventBus.emitStarted(entityId, MediaType.Episode, context.serverConfig.id)

    try {
      const cacheKey = `${showTitle}|${seasonNumber}|${episodeNumber}`
      let episode: EpisodeEntity | null = null

      if (context.episodeCache?.has(cacheKey)) {
        episode = context.episodeCache.get(cacheKey)!
        syncLogger.debug(`[EpisodeSyncService] Cache HIT for ${entityId}`)
      } else {
        syncLogger.debug(`[EpisodeSyncService] Cache MISS for ${entityId} – querying DB`)
        episode = await this.repository.findEpisode(showTitle, seasonNumber, episodeNumber)
      }

      episode = this.normalizeEpisodeEntity(episode, showTitle, seasonNumber, episodeNumber, context)

      for (const operation of operations) {
        try {
          const operationResult = await this.runOperation(episode, operation, context, entityId)
          results.push(operationResult)

          if (
            operationResult.status === SyncStatus.Completed &&
            operationResult.changes.length > 0
          ) {
            const refreshed = await this.repository.findEpisode(showTitle, seasonNumber, episodeNumber)
            if (refreshed) episode = refreshed
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error)
          syncLogger.debug(`[EpisodeSyncService] Operation ${operation} failed for ${entityId}: ${errorMsg}`)
          results.push(this.makeErrorResult(entityId, operation, context, errorMsg))
          syncEventBus.emitError(entityId, MediaType.Episode, context.serverConfig.id, errorMsg, operation)
        }
      }

      syncEventBus.emitComplete(entityId, MediaType.Episode, context.serverConfig.id, undefined, {
        totalOperations: operations.length,
        successful: results.filter(r => r.status === SyncStatus.Completed).length,
        failed: results.filter(r => r.status === SyncStatus.Failed).length,
      })

      return results
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      syncLogger.debug(`[EpisodeSyncService] syncEpisode fatal error for ${entityId}: ${errorMsg}`)
      const errorResult = this.makeErrorResult(entityId, SyncOperation.Content, context, errorMsg)
      syncEventBus.emitError(entityId, MediaType.Episode, context.serverConfig.id, errorMsg)
      return [errorResult]
    }
  }

  /**
   * Sync all episodes for a season in a single bulk operation.
   *
   * This is the preferred entry-point for high-volume sync. Strategies produce
   * update objects; the entire season is flushed via bulkUpsertSeason() once.
   * No individual per-episode writes are ever performed.
   *
   * @param showTitle    Display / filesystem title of the show
   * @param seasonNumber Season number (1-based)
   * @param episodesData Minimal episode descriptors; content is read from context.fileServerData
   * @param context      Sync context (must include fileServerData for Content ops)
   */
  async syncEpisodes(
    showTitle: string,
    seasonNumber: number,
    episodesData: Array<{ episodeNumber: number; title?: string }>,
    context: SyncContext
  ): Promise<SyncResult[]> {
    syncLogger.debug(
      `[EpisodeSyncService] syncEpisodes: show="${showTitle}" S${seasonNumber} ` +
        `count=${episodesData.length} server=${context.serverConfig.id}`
    )

    const allResults: SyncResult[] = []
    const pendingEpisodes: EpisodeEntity[] = []

    // Fetch all existing episodes for this season in one DB round-trip
    const existingEpisodes = await this.repository.findByShowAndSeason(showTitle, seasonNumber)
    const existingMap = new Map<number, EpisodeEntity>(
      existingEpisodes.map(ep => [ep.episodeNumber, ep])
    )

    for (const epDescriptor of episodesData) {
      const { episodeNumber } = epDescriptor
      const entityId = `${showTitle} S${String(seasonNumber).padStart(2, '0')}E${String(episodeNumber).padStart(2, '0')}`

      try {
        const existing = existingMap.get(episodeNumber) ?? null
        let episode = this.normalizeEpisodeEntity(
          existing,
          showTitle,
          seasonNumber,
          episodeNumber,
          context,
          epDescriptor.title
        )

        // Run the Content strategy synchronously; it returns a SyncResult and
        // may mutate context (writing updates). We rely on the strategy to
        // update the repository if needed; we accumulate the entity for bulk flush.
        const contentStrategies = this.strategies.get(SyncOperation.Content) ?? []
        const strategyContext: SyncContext = {
          ...context,
          operation: SyncOperation.Content,
          entityTitle: showTitle,
          entityOriginalTitle: showTitle,
        }
        const applicable = contentStrategies.find(s => s.canHandle(strategyContext))

        if (applicable) {
          const result = await applicable.sync(episode, strategyContext)
          allResults.push(result)

          // Re-read updated fields from DB so we store the freshest state
          const refreshed = await this.repository.findEpisode(showTitle, seasonNumber, episodeNumber)
          if (refreshed) episode = refreshed
        } else {
          syncLogger.debug(`[EpisodeSyncService] No applicable Content strategy for ${entityId}`)
          allResults.push({
            status: SyncStatus.Skipped,
            entityId,
            mediaType: MediaType.Episode,
            operation: SyncOperation.Content,
            serverId: context.serverConfig.id,
            timestamp: new Date(),
            changes: [],
            errors: ['No applicable Content strategy found'],
          })
        }

        pendingEpisodes.push(episode)
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        syncLogger.debug(`[EpisodeSyncService] Error processing ${entityId}: ${errorMsg}`)
        allResults.push(this.makeErrorResult(entityId, SyncOperation.Content, context, errorMsg))
      }
    }

    // ── Bulk write the entire season at once ──────────────────────────────
    if (pendingEpisodes.length > 0) {
      try {
        syncLogger.debug(
          `[EpisodeSyncService] bulkUpsertSeason: show="${showTitle}" S${seasonNumber} count=${pendingEpisodes.length}`
        )
        await this.repository.bulkUpsertSeason(pendingEpisodes)
        syncLogger.debug(`[EpisodeSyncService] bulkUpsertSeason complete for S${seasonNumber}`)
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        syncLogger.debug(`[EpisodeSyncService] bulkUpsertSeason failed: ${errorMsg}`)
        throw new DatabaseError(
          `Bulk upsert failed for ${showTitle} S${seasonNumber}: ${errorMsg}`
        )
      }
    }

    return allResults
  }

  // ─── Internal helpers ─────────────────────────────────────────────────────

  /**
   * Run a single sync operation for an episode entity through the registered strategy
   */
  private async runOperation(
    episode: EpisodeEntity | null,
    operation: SyncOperation,
    context: SyncContext,
    entityId: string
  ): Promise<SyncResult> {
    const strategies = this.strategies.get(operation) ?? []

    if (strategies.length === 0) {
      return {
        status: SyncStatus.Skipped,
        entityId,
        mediaType: MediaType.Episode,
        operation,
        serverId: context.serverConfig.id,
        timestamp: new Date(),
        changes: [],
        errors: [`No strategies registered for operation: ${operation}`],
      }
    }

    const strategyContext: SyncContext = {
      ...context,
      operation,
      entityTitle: episode?.showTitle ?? entityId,
      entityOriginalTitle: episode?.originalTitle ?? episode?.showTitle ?? entityId,
    }

    const applicable = strategies.find(s => s.canHandle(strategyContext))
    if (!applicable) {
      return {
        status: SyncStatus.Skipped,
        entityId,
        mediaType: MediaType.Episode,
        operation,
        serverId: context.serverConfig.id,
        timestamp: new Date(),
        changes: [],
        errors: [`No applicable strategy for operation: ${operation}`],
      }
    }

    syncLogger.debug(
      `[EpisodeSyncService] Running strategy "${applicable.name}" for op=${operation} entity=${entityId}`
    )
    return await applicable.sync(episode, strategyContext)
  }

  /**
   * Ensure the episode entity has all required fields, whether new or existing.
   */
  private normalizeEpisodeEntity(
    existing: EpisodeEntity | null,
    showTitle: string,
    seasonNumber: number,
    episodeNumber: number,
    _context: SyncContext,
    displayTitle?: string
  ): EpisodeEntity {
    const now = new Date()

    if (existing) {
      return {
        ...existing,
        lastSynced: now,
        showTitle: existing.showTitle ?? showTitle,
        originalTitle: existing.originalTitle ?? showTitle,
      }
    }

    // New episode shell – content strategies will fill content fields
    return {
      title: displayTitle ?? `Episode ${episodeNumber}`,
      originalTitle: showTitle,
      showTitle,
      seasonNumber,
      episodeNumber,
      lastSynced: now,
      metadata: {},
    } as EpisodeEntity
  }

  /**
   * Create a standardised failed sync result
   */
  private makeErrorResult(
    entityId: string,
    operation: SyncOperation,
    context: SyncContext,
    error: string
  ): SyncResult {
    return {
      status: SyncStatus.Failed,
      entityId,
      mediaType: MediaType.Episode,
      operation,
      serverId: context.serverConfig.id,
      timestamp: new Date(),
      changes: [],
      errors: [error],
    }
  }

  // ─── Management API ───────────────────────────────────────────────────────

  /** Add or replace a strategy */
  addStrategy(strategy: SyncStrategy): void {
    this.registerStrategies([strategy])
  }

  /** Remove strategy by name */
  removeStrategy(strategyName: string): void {
    for (const [operation, strategies] of this.strategies.entries()) {
      this.strategies.set(
        operation,
        strategies.filter(s => s.name !== strategyName)
      )
    }
  }

  /** Inspect registered strategies (useful for debugging) */
  getStrategies(): Record<string, string[]> {
    const result: Record<string, string[]> = {}
    for (const [operation, strategies] of this.strategies.entries()) {
      result[operation] = strategies.map(s => s.name)
    }
    return result
  }

  /** Expose repository for advanced callers */
  getRepository(): EpisodeRepository {
    return this.repository
  }

  /** Expose file adapter for advanced callers */
  getFileAdapter(): FileServerAdapter {
    return this.fileAdapter
  }
}
