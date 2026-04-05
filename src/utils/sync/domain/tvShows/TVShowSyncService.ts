/**
 * TV show sync service - domain orchestrator for all TV show sync operations
 * Modeled after MovieSyncService for the domain-driven architecture with strategy pattern
 */

import {
  TVShowEntity,
  SyncContext,
  SyncResult,
  SyncStatus,
  MediaType,
  SyncOperation,
  SyncStrategy,
  syncEventBus
} from '../../core'

import { TVShowRepository } from '../../infrastructure'
import { FileServerAdapter } from '../../core'
import { syncLogger } from '../../core/logger'

export class TVShowSyncService {
  private repository: TVShowRepository
  private fileAdapter: FileServerAdapter
  private strategies: Map<SyncOperation, SyncStrategy[]> = new Map()

  constructor(
    repository: TVShowRepository,
    fileAdapter: FileServerAdapter,
    strategies: SyncStrategy[] = []
  ) {
    this.repository = repository
    this.fileAdapter = fileAdapter
    this.registerStrategies(strategies)
  }

  /**
   * Register sync strategies by operation type
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

  /**
   * Sync a single TV show with all applicable strategies
   */
  async syncTVShow(
    title: string,
    context: SyncContext,
    operations: SyncOperation[] = [SyncOperation.Metadata, SyncOperation.Assets]
  ): Promise<SyncResult[]> {
    const results: SyncResult[] = []

    syncEventBus.emitStarted(title, MediaType.TVShow, context.serverConfig.id)

    try {
      let show = await this.repository.findByOriginalTitle(title)
      show = this.normalizeTVShowEntity(show, title, title, context)

      for (const operation of operations) {
        try {
          const operationResult = await this.syncTVShowOperation(show, operation, context, title)
          results.push(operationResult)

          if (operationResult.status === SyncStatus.Completed && operationResult.changes.length > 0) {
            const refreshed = await this.repository.findByTitle(title)
            if (refreshed) show = refreshed
          }
        } catch (error) {
          const errorResult: SyncResult = {
            status: SyncStatus.Failed,
            entityId: title,
            mediaType: MediaType.TVShow,
            operation,
            serverId: context.serverConfig.id,
            timestamp: new Date(),
            changes: [],
            errors: [error instanceof Error ? error.message : String(error)]
          }
          results.push(errorResult)
          syncEventBus.emitError(title, MediaType.TVShow, context.serverConfig.id,
            errorResult.errors[0], operation)
        }
      }

      syncEventBus.emitComplete(title, MediaType.TVShow, context.serverConfig.id, undefined, {
        totalOperations: operations.length,
        successful: results.filter(r => r.status === SyncStatus.Completed).length,
        failed: results.filter(r => r.status === SyncStatus.Failed).length
      })

      return results

    } catch (error) {
      const errorResult: SyncResult = {
        status: SyncStatus.Failed,
        entityId: title,
        mediaType: MediaType.TVShow,
        operation: SyncOperation.Metadata,
        serverId: context.serverConfig.id,
        timestamp: new Date(),
        changes: [],
        errors: [error instanceof Error ? error.message : String(error)]
      }
      syncEventBus.emitError(title, MediaType.TVShow, context.serverConfig.id, errorResult.errors[0])
      return [errorResult]
    }
  }

  /**
   * Sync multiple TV shows efficiently with controlled concurrency
   */
  async syncTVShows(
    titles: string[],
    context: SyncContext,
    concurrency: number = 5
  ): Promise<SyncResult[]> {
    const allResults: SyncResult[] = []

    for (let i = 0; i < titles.length; i += concurrency) {
      const batch = titles.slice(i, i + concurrency)

      const batchPromises = batch.map(title =>
        this.syncTVShow(title, context).catch(error => [{
          status: SyncStatus.Failed,
          entityId: title,
          mediaType: MediaType.TVShow,
          operation: SyncOperation.Metadata,
          serverId: context.serverConfig.id,
          timestamp: new Date(),
          changes: [],
          errors: [error instanceof Error ? error.message : String(error)]
        }])
      )

      const batchResults = await Promise.allSettled(batchPromises)
      batchResults.forEach(result => {
        if (result.status === 'fulfilled') {
          allResults.push(...result.value)
        } else {
          syncLogger.error('Unexpected batch result failure:', result.reason)
        }
      })
    }

    return allResults
  }

  /**
   * Sync a single operation for a TV show
   */
  private async syncTVShowOperation(
    show: TVShowEntity | null,
    operation: SyncOperation,
    context: SyncContext,
    title: string
  ): Promise<SyncResult> {
    const strategies = this.strategies.get(operation) || []

    if (strategies.length === 0) {
      return {
        status: SyncStatus.Skipped,
        entityId: show?.title || 'unknown',
        mediaType: MediaType.TVShow,
        operation,
        serverId: context.serverConfig.id,
        timestamp: new Date(),
        changes: [],
        errors: [`No strategies available for operation: ${operation}`]
      }
    }

    const applicableStrategy = strategies.find(strategy =>
      strategy.canHandle({ ...context, operation })
    )

    if (!applicableStrategy) {
      return {
        status: SyncStatus.Skipped,
        entityId: show?.title || 'unknown',
        mediaType: MediaType.TVShow,
        operation,
        serverId: context.serverConfig.id,
        timestamp: new Date(),
        changes: [],
        errors: [`No applicable strategy found for operation: ${operation}`]
      }
    }

    const strategyContext = {
      ...context,
      operation,
      entityTitle: title,
      entityOriginalTitle: show?.originalTitle || show?.title || title
    }

    return await applicableStrategy.sync(show, strategyContext)
  }

  /**
   * Normalize TV show entity to ensure complete schema regardless of input state
   */
  private normalizeTVShowEntity(
    existingShow: TVShowEntity | null,
    title: string,
    originalTitle: string,
    context: SyncContext
  ): TVShowEntity {
    const now = new Date()

    if (existingShow) {
      syncLogger.debug(`Normalizing existing TV show entity for: "${title}"`)
      return {
        ...existingShow,
        lastSynced: now,
        title,
        originalTitle
      }
    }

    syncLogger.debug(`Creating new TV show entity for: "${title}" (originalTitle: "${originalTitle}")`)
    return {
      title,
      originalTitle,
      lastSynced: now,
      metadata: {},
      titleSource: context.serverConfig.id,
      originalTitleSource: context.serverConfig.id
    }
  }

  /**
   * Get repository reference for advanced operations
   */
  getRepository(): TVShowRepository {
    return this.repository
  }

  /**
   * Get file adapter reference for advanced operations
   */
  getFileAdapter(): FileServerAdapter {
    return this.fileAdapter
  }

  /**
   * Add or update sync strategy
   */
  addStrategy(strategy: SyncStrategy): void {
    this.registerStrategies([strategy])
  }

  /**
   * Remove strategy by name
   */
  removeStrategy(strategyName: string): void {
    for (const [operation, strategies] of this.strategies.entries()) {
      const filtered = strategies.filter(s => s.name !== strategyName)
      this.strategies.set(operation, filtered)
    }
  }

  /**
   * Get available strategies for debugging
   */
  getStrategies(): Record<SyncOperation, string[]> {
    const result: Record<SyncOperation, string[]> = {} as any
    for (const [operation, strategies] of this.strategies.entries()) {
      result[operation] = strategies.map(s => s.name)
    }
    return result
  }
}
