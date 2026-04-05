/**
 * Season metadata sync strategy - SyncOperation.Metadata for MediaType.Season.
 * Reads from fileServerData.tv[showTitle].seasons[seasonKey].metadata
 * Upserts via SeasonRepository using { showTitle, seasonNumber } composite key.
 */

import {
  SyncStrategy, SyncContext, SyncResult, SyncStatus, SyncOperation,
  MediaType, BaseMediaEntity, SeasonEntity, syncEventBus, syncLogger
} from '../../../core'
import { SeasonRepository } from '../../../infrastructure'
import { FileServerAdapter } from '../../../core'
import { isCurrentServerHighestPriorityForField } from '@src/utils/sync/utils'

export class SeasonMetadataStrategy implements SyncStrategy {
  readonly name = 'SeasonMetadataStrategy'
  readonly supportedOperations = [SyncOperation.Metadata]
  readonly supportedMediaTypes = [MediaType.Season]

  constructor(
    private repository: SeasonRepository,
    private fileAdapter: FileServerAdapter
  ) {}

  canHandle(context: SyncContext): boolean {
    return (
      context.mediaType === MediaType.Season &&
      context.operation === SyncOperation.Metadata &&
      this.supportedMediaTypes.includes(context.mediaType) &&
      this.supportedOperations.includes(context.operation)
    )
  }

  async sync(entity: BaseMediaEntity | null, context: SyncContext): Promise<SyncResult> {
    const startTime = Date.now()
    // SeasonSyncService injects entityShowTitle / entitySeasonNumber into context
    const showTitle: string =
      (context as any).entityShowTitle || (entity as SeasonEntity)?.showTitle || ''
    const seasonNumber: number =
      (context as any).entitySeasonNumber ?? (entity as SeasonEntity)?.seasonNumber ?? -1

    syncLogger.debug(`SeasonMetadataStrategy: starting for "${showTitle}" S${seasonNumber}`)

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
        SyncOperation.Metadata, { stage: 'starting', progress: 0 })

      const seasonKey = `Season ${seasonNumber}`
      const seasonFileData = context.fileServerData?.tv?.[showTitle]?.seasons?.[seasonKey]
      syncLogger.debug(`SeasonMetadataStrategy: lookup tv["${showTitle}"].seasons["${seasonKey}"]`,
        { found: !!seasonFileData })

      if (!seasonFileData) {
        return this.mkResult(showTitle, seasonNumber, context, SyncStatus.Skipped, [], [],
          { processingTime: Date.now() - startTime, reason: `no fileServerData for ${seasonKey}` })
      }

      if (!this.canUpdateField('metadata', showTitle, context)) {
        return this.mkResult(showTitle, seasonNumber, context, SyncStatus.Skipped, [], [],
          { processingTime: Date.now() - startTime, reason: 'server lacks priority for season metadata' })
      }

      let existing = entity as SeasonEntity | null
      if (!existing) {
        existing = context.seasonCache?.get(`${showTitle}:${seasonNumber}`) ?? null
        if (!existing) existing = await this.repository.findSeason(showTitle, seasonNumber)
      }

      const rawMetadata = seasonFileData.metadata || {}
      const changes: string[] = []
      const now = new Date()

      const toSave: SeasonEntity = {
        ...(existing || {}), showTitle, seasonNumber,
        title: rawMetadata.name || existing?.title || `Season ${seasonNumber}`,
        originalTitle: showTitle, lastSynced: now,
        metadata: rawMetadata, metadataSource: context.serverConfig.id,
        ...(rawMetadata.episode_count !== undefined
          ? { episodeCount: rawMetadata.episode_count } : {}),
      } as SeasonEntity

      if (!existing) {
        changes.push('Created new season entity')
      } else {
        if (JSON.stringify(existing.metadata) !== JSON.stringify(rawMetadata))
          changes.push('Updated season metadata')
        if (existing.title !== toSave.title)
          changes.push(`Updated title: "${existing.title}" -> "${toSave.title}"`)
      }

      await this.repository.bulkUpsertShow([toSave])
      syncLogger.debug(`SeasonMetadataStrategy: upserted "${showTitle}" S${seasonNumber}`, { changes })
      syncEventBus.emitProgress(showTitle, MediaType.Season, context.serverConfig.id,
        SyncOperation.Metadata,
        { stage: changes.length > 0 ? 'updated' : 'unchanged', progress: 100 })

      return this.mkResult(showTitle, seasonNumber, context, SyncStatus.Completed, changes, [],
        { processingTime: Date.now() - startTime, metadataFields: Object.keys(rawMetadata) })

    } catch (error) {
      syncEventBus.emitError(showTitle, MediaType.Season, context.serverConfig.id,
        error instanceof Error ? error.message : String(error), SyncOperation.Metadata)
      return this.mkResult(showTitle, seasonNumber, context, SyncStatus.Failed, [],
        [error instanceof Error ? error.message : String(error)],
        { processingTime: Date.now() - startTime })
    }
  }

  /**
   * Priority gate — seasons tracked under fieldAvailability.tv[showTitle].
   * Field path follows the flat-sync convention used throughout the codebase.
   */
  private canUpdateField(fieldPath: string, showTitle: string, context: SyncContext): boolean {
    syncLogger.debug(
      `SeasonMetadataStrategy priority: field="${fieldPath}" server=${context.serverConfig.id}`
    )
    if (!context.fieldAvailability) return true
    if (!context.fieldAvailability?.tv?.[showTitle]) return true
    const ok = isCurrentServerHighestPriorityForField(
      context.fieldAvailability, 'tv', showTitle, fieldPath, context.serverConfig
    )
    syncLogger.debug(`SeasonMetadataStrategy: ${ok ? 'has' : 'lacks'} priority for ${fieldPath}`)
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
      operation: SyncOperation.Metadata,
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
