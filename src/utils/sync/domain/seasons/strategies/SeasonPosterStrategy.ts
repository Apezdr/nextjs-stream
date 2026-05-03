/**
 * Season poster sync strategy - SyncOperation.Assets for MediaType.Season.
 * Builds posterURL via UrlBuilder.createFullUrl from
 * fileServerData.tv[showTitle].seasons[seasonKey].urls.poster
 * (falls back to season_poster for legacy compatibility).
 */

import {
  SyncStrategy, SyncContext, SyncResult, SyncStatus, SyncOperation,
  MediaType, BaseMediaEntity, SeasonEntity, syncEventBus, syncLogger
} from '../../../core'
import { SeasonRepository, UrlBuilder } from '../../../infrastructure'
import { FileServerAdapter } from '../../../core'
import { isCurrentServerHighestPriorityForField } from '@src/utils/sync/utils'

export class SeasonPosterStrategy implements SyncStrategy {
  readonly name = 'SeasonPosterStrategy'
  readonly supportedOperations = [SyncOperation.Assets]
  readonly supportedMediaTypes = [MediaType.Season]

  constructor(
    private repository: SeasonRepository,
    private fileAdapter: FileServerAdapter
  ) {}

  canHandle(context: SyncContext): boolean {
    return (
      context.mediaType === MediaType.Season &&
      context.operation === SyncOperation.Assets &&
      this.supportedMediaTypes.includes(context.mediaType) &&
      this.supportedOperations.includes(context.operation)
    )
  }

  async sync(entity: BaseMediaEntity | null, context: SyncContext): Promise<SyncResult> {
    const startTime = Date.now()
    const showTitle: string =
      (context as any).entityShowTitle || (entity as SeasonEntity)?.showTitle || ''
    const seasonNumber: number =
      (context as any).entitySeasonNumber ?? (entity as SeasonEntity)?.seasonNumber ?? -1

    syncLogger.debug(`SeasonPosterStrategy: starting for "${showTitle}" S${seasonNumber}`)

    if (!showTitle || showTitle.trim().length === 0) {
      return this.mkResult(showTitle, seasonNumber, context, SyncStatus.Failed, [],
        ['showTitle is required'], { processingTime: Date.now() - startTime })
    }
    if (seasonNumber < 0) {
      return this.mkResult(showTitle, seasonNumber, context, SyncStatus.Failed, [],
        ['seasonNumber is required'], { processingTime: Date.now() - startTime })
    }

    try {
      syncEventBus.emitProgress(showTitle, MediaType.Season, context.serverConfig.id,
        SyncOperation.Assets, { stage: 'starting', progress: 0 })

      const seasonKey = `Season ${seasonNumber}`
      const seasonFileData = context.fileServerData?.tv?.[showTitle]?.seasons?.[seasonKey]
      syncLogger.debug(
        `SeasonPosterStrategy: lookup tv["${showTitle}"].seasons["${seasonKey}"]`,
        { found: !!seasonFileData })

      if (!seasonFileData) {
        return this.mkResult(showTitle, seasonNumber, context, SyncStatus.Skipped, [], [],
          { processingTime: Date.now() - startTime,
            reason: `no fileServerData for ${seasonKey}` })
      }

      // Prefer urls.poster (new), fall back to season_poster (legacy)
      const posterRelativePath: string | undefined =
        seasonFileData?.urls?.poster ?? seasonFileData?.season_poster

      if (!posterRelativePath) {
        syncLogger.debug(`SeasonPosterStrategy: no poster path for "${showTitle}" ${seasonKey}`)
        return this.mkResult(showTitle, seasonNumber, context, SyncStatus.Skipped, [], [],
          { processingTime: Date.now() - startTime, reason: 'no poster path' })
      }

      // Field path mirrors flat-sync poster convention (tv namespace, keyed by showTitle)
      const fieldPath = `seasons.${seasonKey}.season_poster`
      if (!this.canUpdateField(fieldPath, showTitle, context)) {
        syncLogger.debug(`SeasonPosterStrategy: server ${context.serverConfig.id} lacks priority`)
        return this.mkResult(showTitle, seasonNumber, context, SyncStatus.Skipped, [], [],
          { processingTime: Date.now() - startTime, reason: 'server lacks priority' })
      }

      let existing = entity as SeasonEntity | null
      if (!existing) {
        existing = context.seasonCache?.get(`${showTitle}:${seasonNumber}`) ?? null
        if (!existing) existing = await this.repository.findSeason(showTitle, seasonNumber)
      }

      // Build full URL — fileServerData paths already include the server prefix
      const newPosterURL = UrlBuilder.createFullUrl(
        posterRelativePath,
        { ...context.serverConfig, prefix: '' }
      )
      syncLogger.debug(`SeasonPosterStrategy: new posterURL="${newPosterURL}"`)

      if (existing?.posterURL === newPosterURL) {
        syncEventBus.emitProgress(showTitle, MediaType.Season, context.serverConfig.id,
          SyncOperation.Assets, { stage: 'unchanged', progress: 100 })
        return this.mkResult(showTitle, seasonNumber, context, SyncStatus.Skipped, [], [],
          { processingTime: Date.now() - startTime, reason: 'poster unchanged' })
      }

      const toSave: SeasonEntity = {
        ...(existing || {}), showTitle, seasonNumber,
        title: existing?.title || `Season ${seasonNumber}`,
        originalTitle: showTitle, lastSynced: new Date(),
        posterURL: newPosterURL,
        posterSource: context.serverConfig.id,
      } as SeasonEntity

      await this.repository.bulkUpsertShow([toSave])
      syncLogger.debug(`SeasonPosterStrategy: upserted "${showTitle}" S${seasonNumber} posterURL`)
      syncEventBus.emitProgress(showTitle, MediaType.Season, context.serverConfig.id,
        SyncOperation.Assets, { stage: 'completed', progress: 100 })

      return this.mkResult(showTitle, seasonNumber, context, SyncStatus.Completed,
        ['Updated posterURL'], [],
        { processingTime: Date.now() - startTime, posterURL: newPosterURL })

    } catch (error) {
      syncEventBus.emitError(showTitle, MediaType.Season, context.serverConfig.id,
        error instanceof Error ? error.message : String(error), SyncOperation.Assets)
      return this.mkResult(showTitle, seasonNumber, context, SyncStatus.Failed, [],
        [error instanceof Error ? error.message : String(error)],
        { processingTime: Date.now() - startTime })
    }
  }

  /**
   * Priority gate — seasons tracked under fieldAvailability.tv[showTitle].
   * Field path: "seasons.Season N.season_poster" (matches flat-sync convention).
   */
  private canUpdateField(fieldPath: string, showTitle: string, context: SyncContext): boolean {
    syncLogger.debug(
      `SeasonPosterStrategy priority: field="${fieldPath}" server=${context.serverConfig.id}`
    )
    if (!context.fieldAvailability) return true
    if (!context.fieldAvailability?.tv?.[showTitle]) return true
    const ok = isCurrentServerHighestPriorityForField(
      context.fieldAvailability, 'tv', showTitle, fieldPath, context.serverConfig
    )
    syncLogger.debug(`SeasonPosterStrategy: ${ok ? 'has' : 'lacks'} priority for ${fieldPath}`)
    return ok
  }

  private mkResult(
    showTitle: string, seasonNumber: number, context: SyncContext,
    status: SyncStatus, changes: string[], errors: string[],
    metadata?: Record<string, any>
  ): SyncResult {
    return {
      status,
      entityId: `${showTitle}:S${seasonNumber}`,
      mediaType: MediaType.Season,
      operation: SyncOperation.Assets,
      serverId: context.serverConfig.id,
      timestamp: new Date(),
      changes, errors, metadata
    }
  }

  async validate?(entity: BaseMediaEntity, context: SyncContext): Promise<boolean> {
    const s = entity as SeasonEntity
    return !!(s.showTitle && typeof s.seasonNumber === 'number' && context.serverConfig.id)
  }
}
