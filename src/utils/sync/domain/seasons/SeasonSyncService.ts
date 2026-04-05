/**
 * Season sync service — domain orchestrator for all season sync operations.
 * Modelled after MovieSyncService with strategy pattern.
 * Uses SeasonRepository.bulkUpsertShow() for efficient batch writes.
 */

import {
  SeasonEntity, SyncContext, SyncResult, SyncStatus,
  MediaType, SyncOperation, SyncStrategy, syncEventBus, syncLogger
} from '../../core'
import { SeasonRepository } from '../../infrastructure'
import { FileServerAdapter } from '../../core'

export class SeasonSyncService {
  private repository: SeasonRepository
  private fileAdapter: FileServerAdapter
  private strategies: Map<SyncOperation, SyncStrategy[]> = new Map()

  constructor(
    repository: SeasonRepository,
    fileAdapter: FileServerAdapter,
    strategies: SyncStrategy[] = []
  ) {
    this.repository = repository
    this.fileAdapter = fileAdapter
    this.registerStrategies(strategies)
  }

  private registerStrategies(strategies: SyncStrategy[]): void {
    for (const s of strategies) {
      for (const op of s.supportedOperations) {
        if (!this.strategies.has(op)) this.strategies.set(op, [])
        this.strategies.get(op)!.push(s)
      }
    }
  }

  addStrategy(strategy: SyncStrategy): void { this.registerStrategies([strategy]) }

  removeStrategy(name: string): void {
    for (const [op, strats] of this.strategies.entries())
      this.strategies.set(op, strats.filter(s => s.name !== name))
  }

  getStrategies(): Record<SyncOperation, string[]> {
    const out: Record<SyncOperation, string[]> = {} as any
    for (const [op, strats] of this.strategies.entries())
      out[op] = strats.map(s => s.name)
    return out
  }

  getRepository(): SeasonRepository { return this.repository }
  getFileAdapter(): FileServerAdapter { return this.fileAdapter }

  /**
   * Sync a single season through all applicable strategies.
   * @param showTitle    - Show filesystem key (originalTitle)
   * @param seasonNumber - Season number (1-based)
   * @param context      - Carries serverConfig, fieldAvailability, fileServerData, etc.
   * @param operations   - Operations to run (default: Metadata + Assets)
   */
  async syncSeason(
    showTitle: string,
    seasonNumber: number,
    context: SyncContext,
    operations: SyncOperation[] = [SyncOperation.Metadata, SyncOperation.Assets]
  ): Promise<SyncResult[]> {
    const results: SyncResult[] = []
    const entityId = `${showTitle}:S${seasonNumber}`

    syncLogger.debug(`SeasonSyncService.syncSeason: "${entityId}"`)
    syncEventBus.emitStarted(entityId, MediaType.Season, context.serverConfig.id)

    try {
      let existing: SeasonEntity | null = null
      try { existing = await this.repository.findSeason(showTitle, seasonNumber) }
      catch (_) { /* non-fatal — strategies will upsert */ }

      for (const operation of operations) {
        try {
          const r = await this.runOperation(
            existing, operation, context, showTitle, seasonNumber
          )
          results.push(r)
        } catch (error) {
          const err: SyncResult = {
            status: SyncStatus.Failed, entityId,
            mediaType: MediaType.Season, operation,
            serverId: context.serverConfig.id, timestamp: new Date(),
            changes: [],
            errors: [error instanceof Error ? error.message : String(error)]
          }
          results.push(err)
          syncEventBus.emitError(entityId, MediaType.Season, context.serverConfig.id,
            err.errors[0], operation)
        }
      }

      syncEventBus.emitComplete(entityId, MediaType.Season, context.serverConfig.id,
        undefined, {
          totalOperations: operations.length,
          successful: results.filter(r => r.status === SyncStatus.Completed).length,
          failed: results.filter(r => r.status === SyncStatus.Failed).length
        })
      return results

    } catch (error) {
      const err: SyncResult = {
        status: SyncStatus.Failed, entityId,
        mediaType: MediaType.Season, operation: SyncOperation.Metadata,
        serverId: context.serverConfig.id, timestamp: new Date(),
        changes: [],
        errors: [error instanceof Error ? error.message : String(error)]
      }
      syncEventBus.emitError(entityId, MediaType.Season, context.serverConfig.id, err.errors[0])
      return [err]
    }
  }

  /**
   * Sync all seasons for a show from a seasonsData map.
   * seasonsData mirrors fileServerData.tv[showTitle].seasons:
   *   { "Season 1": { ... }, "Season 2": { ... } }
   */
  async syncSeasons(
    showTitle: string,
    seasonsData: Record<string, { seasonNumber?: number; [key: string]: any }>,
    context: SyncContext
  ): Promise<SyncResult[]> {
    const allResults: SyncResult[] = []
    syncLogger.debug(`SeasonSyncService.syncSeasons: "${showTitle}" (${Object.keys(seasonsData).length} seasons)`)

    for (const [seasonKey, seasonInfo] of Object.entries(seasonsData)) {
      const match = seasonKey.match(/Season\s+(\d+)/i)
      const seasonNumber: number =
        seasonInfo.seasonNumber ?? (match ? parseInt(match[1], 10) : -1)

      if (seasonNumber < 0) {
        syncLogger.debug(`SeasonSyncService: bad seasonKey "${seasonKey}", skipping`)
        continue
      }

      const seasonResults = await this.syncSeason(showTitle, seasonNumber, context)
        .catch(error => ([{
          status: SyncStatus.Failed,
          entityId: `${showTitle}:S${seasonNumber}`,
          mediaType: MediaType.Season,
          operation: SyncOperation.Metadata,
          serverId: context.serverConfig.id, timestamp: new Date(),
          changes: [],
          errors: [error instanceof Error ? error.message : String(error)]
        } as SyncResult]))

      allResults.push(...seasonResults)
    }

    return allResults
  }

  // ─────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────

  /**
   * Run a single operation for a given season.
   * Injects entityShowTitle / entitySeasonNumber into context so strategies can read them.
   */
  private async runOperation(
    existing: SeasonEntity | null,
    operation: SyncOperation,
    context: SyncContext,
    showTitle: string,
    seasonNumber: number
  ): Promise<SyncResult> {
    const strats = this.strategies.get(operation) || []
    const entityId = `${showTitle}:S${seasonNumber}`

    if (strats.length === 0) {
      return {
        status: SyncStatus.Skipped, entityId,
        mediaType: MediaType.Season, operation,
        serverId: context.serverConfig.id, timestamp: new Date(),
        changes: [],
        errors: [`No strategies registered for operation: ${operation}`]
      }
    }

    // Enrich context with season-specific identifiers for strategies
    const strategyContext: SyncContext = {
      ...context,
      operation,
      // Strategies read these instead of entity fields (entity may be null)
      entityTitle: showTitle,
      entityOriginalTitle: showTitle,
      ...({ entityShowTitle: showTitle, entitySeasonNumber: seasonNumber } as any)
    }

    const applicable = strats.find(s => s.canHandle(strategyContext))

    if (!applicable) {
      return {
        status: SyncStatus.Skipped, entityId,
        mediaType: MediaType.Season, operation,
        serverId: context.serverConfig.id, timestamp: new Date(),
        changes: [],
        errors: [`No applicable strategy for operation: ${operation}`]
      }
    }

    return applicable.sync(existing, strategyContext)
  }
}
