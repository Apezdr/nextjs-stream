/**
 * TV show metadata sync strategy
 * Modeled after MovieMetadataStrategy with TV-specific field paths
 */

import {
  SyncStrategy, SyncContext, SyncResult, SyncStatus, SyncOperation,
  MediaType, BaseMediaEntity, TVShowEntity, syncEventBus
} from '../../../core'
import { TVShowRepository } from '../../../infrastructure'
import { FileServerAdapter } from '../../../core'
import { syncLogger } from '../../../core/logger'
import { isCurrentServerHighestPriorityForField } from '@src/utils/sync/utils'
import { fetchMetadataMultiServer } from '@src/utils/admin_utils'

export class TVShowMetadataStrategy implements SyncStrategy {
  readonly name = 'TVShowMetadataStrategy'
  readonly supportedOperations = [SyncOperation.Metadata]
  readonly supportedMediaTypes = [MediaType.TVShow]
  readonly currentVersion = '1.0'

  constructor(
    private repository: TVShowRepository,
    private fileAdapter: FileServerAdapter
  ) {}

  canHandle(context: SyncContext): boolean {
    return (
      context.mediaType === MediaType.TVShow &&
      context.operation === SyncOperation.Metadata &&
      this.supportedMediaTypes.includes(context.mediaType) &&
      this.supportedOperations.includes(context.operation)
    )
  }

  async sync(entity: BaseMediaEntity | null, context: SyncContext): Promise<SyncResult> {
    const startTime = Date.now()
    const title = context.entityTitle || entity?.title
    const originalTitle = context.entityOriginalTitle || entity?.originalTitle || title

    syncLogger.debug(`TVShowMetadataStrategy starting for: "${title}"`)

    if (!title || title.trim().length === 0) {
      return this.createResult('unknown', context, SyncStatus.Failed, [],
        ['TV show title is required'], { processingTime: Date.now() - startTime })
    }
    if (!originalTitle || originalTitle.trim().length === 0) {
      return this.createResult(title || 'unknown', context, SyncStatus.Failed, [],
        ['Original title is required'], { processingTime: Date.now() - startTime })
    }

    try {
      syncEventBus.emitProgress(title, MediaType.TVShow, context.serverConfig.id,
        SyncOperation.Metadata, { stage: 'starting', progress: 0 })

      let show = entity as TVShowEntity | null
      if (!show) {
        if (context.tvShowCache?.has(originalTitle)) {
          show = context.tvShowCache.get(originalTitle)!
          syncLogger.debug(`Cache HIT for "${originalTitle}"`)
        } else {
          syncLogger.debug(`Cache MISS for "${originalTitle}", querying database...`)
          show = await this.repository.findByOriginalTitle(originalTitle)
        }
      }

      const changes: string[] = []
      if (!this.shouldUpdateField('metadata', originalTitle, context)) {
        syncLogger.debug(`Server ${context.serverConfig.id} skipping: no priority for metadata`)
        return this.createResult(title, context, SyncStatus.Skipped, [], [],
          { processingTime: Date.now() - startTime, reason: 'server does not have priority for metadata field' })
      }
      syncLogger.debug(`Server ${context.serverConfig.id} proceeding with metadata sync`)

      let metadata = await this.extractMetadata(originalTitle, context)
      if (!metadata) {
        metadata = { title, source: context.serverConfig.id,
          dateAdded: new Date().toISOString(), lastScanned: new Date().toISOString(), hasExternalMetadata: false }
      }

      const showToSave = { ...(show || {}), originalTitle, title, lastSynced: new Date() } as TVShowEntity
      const needsUpgrade = !show?.syncVersion || show.syncVersion < this.currentVersion
      const normalized = this.normalizeMetadata(metadata)
      const metaChanged = !this.isMetadataEqual(show?.metadata, normalized)

      if (needsUpgrade || metaChanged) {
        showToSave.metadata = normalized
        showToSave.metadataSource = context.serverConfig.id
        showToSave.syncVersion = this.currentVersion
        if (needsUpgrade && metaChanged) changes.push(`Updated TV show metadata (migration: ${show?.syncVersion || 'none'} -> ${this.currentVersion})`)
        else if (needsUpgrade) changes.push(`Schema version updated (${show?.syncVersion || 'none'} -> ${this.currentVersion})`)
        else changes.push('Updated TV show metadata')
      }

      const metaTitle = metadata?.name || metadata?.title
      if (metaTitle && metaTitle !== show?.title) {
        showToSave.title = metaTitle
        showToSave.titleSource = context.serverConfig.id
        changes.push(`Updated title from metadata: "${metaTitle}"`)
        syncLogger.debug(`Title from metadata: "${metaTitle}"`)
      }

      if (show?.originalTitle !== originalTitle) {
        showToSave.originalTitle = originalTitle
        showToSave.originalTitleSource = context.serverConfig.id
        changes.push('Updated originalTitle')
      }

      const hasChanges = changes.length > 0
      await this.repository.upsert(showToSave)

      if (!show) {
        changes.push('Created new TV show entity')
        syncEventBus.emitProgress(title, MediaType.TVShow, context.serverConfig.id,
          SyncOperation.Metadata, { stage: 'created', progress: 100 })
      } else {
        syncEventBus.emitProgress(title, MediaType.TVShow, context.serverConfig.id,
          SyncOperation.Metadata, { stage: hasChanges ? 'updated' : 'unchanged', progress: 100 })
      }

      return this.createResult(title, context, SyncStatus.Completed, changes, [],
        { processingTime: Date.now() - startTime, metadataFields: Object.keys(metadata) })

    } catch (error) {
      syncEventBus.emitError(title, MediaType.TVShow, context.serverConfig.id,
        error instanceof Error ? error.message : String(error), SyncOperation.Metadata)
      return this.createResult(title, context, SyncStatus.Failed, [],
        [error instanceof Error ? error.message : String(error)], { processingTime: Date.now() - startTime })
    }
  }

  /**
   * Extract metadata from file server using originalTitle (filesystem key)
   * TV show data lives under fileServerData.tv[originalTitle].urls.metadata
   * Respects ResourceManager HTTP throttling when available in context
   */
  private async extractMetadata(
    originalTitle: string,
    context: SyncContext
  ): Promise<Record<string, any> | null> {
    const doFetch = async () => {
      try {
        const fileServerData = context.fileServerData?.tv?.[originalTitle]
        const metadataRelativePath = fileServerData?.urls?.metadata
        syncLogger.debug(`Fetching TV show metadata for "${originalTitle}" from ${context.serverConfig.id}`)
        const metadata = await fetchMetadataMultiServer(
          context.serverConfig.id,
          metadataRelativePath,
          'file',
          'tv',
          originalTitle
        )
        syncLogger.debug(`Fetched metadata for "${originalTitle}" from ${context.serverConfig.id}`)
        return metadata
      } catch (error) {
        console.error(`Failed to extract TV show metadata for ${originalTitle}:`, error)
        return null
      }
    }
    if (context.resourceManager) return context.resourceManager.throttleHttp(doFetch)
    return doFetch()
  }

  private normalizeMetadata(metadata: Record<string, any>): Record<string, any> {
    if (!metadata || typeof metadata !== 'object') return metadata
    const normalized = { ...metadata }
    for (const field of ['first_air_date', 'last_air_date']) {
      if (normalized[field] && typeof normalized[field] === 'string') {
        try {
          const d = new Date(normalized[field])
          if (!isNaN(d.getTime())) normalized[field] = d
        } catch { /* keep original */ }
      }
    }
    return normalized
  }

  private isMetadataEqual(
    current: Record<string, any> = {},
    incoming: Record<string, any>
  ): boolean {
    for (const key of Object.keys(incoming)) {
      if (!this.valuesEqual(current[key], incoming[key])) return false
    }
    return true
  }

  private valuesEqual(current: any, incoming: any): boolean {
    if (current === null && incoming === null) return true
    if (current === undefined && incoming === undefined) return true
    if (current == null || incoming == null) return false
    if (current instanceof Date && incoming instanceof Date) return current.getTime() === incoming.getTime()
    if (current instanceof Date && typeof incoming === 'string') {
      try { return current.getTime() === new Date(incoming).getTime() } catch { return false }
    }
    if (typeof current === 'string' && incoming instanceof Date) {
      try { return new Date(current).getTime() === incoming.getTime() } catch { return false }
    }
    if (Array.isArray(current) && Array.isArray(incoming)) {
      if (current.length !== incoming.length) return false
      return current.every((item, i) => this.valuesEqual(item, incoming[i]))
    }
    if (typeof current === 'object' && typeof incoming === 'object' &&
        !(current instanceof Date) && !(incoming instanceof Date)) {
      const ck = Object.keys(current || {})
      const ik = Object.keys(incoming || {})
      if (ck.length !== ik.length) return false
      return ck.every(k => this.valuesEqual(current[k], incoming[k]))
    }
    return current === incoming
  }

  /**
   * Check if current server should update a field using the priority system
   * CRITICAL: Always use originalTitle (filesystem key) for fieldAvailability lookups
   * TV shows use 'tv' as the media type key in fieldAvailability
   */
  private shouldUpdateField(
    fieldPath: string,
    originalTitle: string,
    context: SyncContext
  ): boolean {
    syncLogger.debug(
      `Priority check: field="${fieldPath}", originalTitle="${originalTitle}", server=${context.serverConfig.id}`
    )
    if (!context.fieldAvailability) {
      syncLogger.debug(`No fieldAvailability in context, defaulting to true for ${fieldPath}`)
      return true
    }
    const showFields = context.fieldAvailability?.tv?.[originalTitle]
    if (!showFields) {
      syncLogger.debug(`TV show "${originalTitle}" not found in fieldAvailability, defaulting to true`)
      return true
    }
    const serversWithField = showFields[fieldPath] || []
    syncLogger.debug(
      `Servers with ${fieldPath}: ${JSON.stringify(serversWithField)} (${serversWithField.length} total)`
    )
    const hasHighestPriority = isCurrentServerHighestPriorityForField(
      context.fieldAvailability,
      'tv',
      originalTitle,  // <- CRITICAL: Always use originalTitle for consistency
      fieldPath,
      context.serverConfig
    )
    if (hasHighestPriority) {
      syncLogger.debug(
        `Server ${context.serverConfig.id} (priority ${context.serverConfig.priority}) has highest priority for ${fieldPath}`
      )
    } else {
      syncLogger.debug(
        `Server ${context.serverConfig.id} (priority ${context.serverConfig.priority}) does NOT have highest priority for ${fieldPath}`
      )
    }
    return hasHighestPriority
  }

  private createResult(
    entityId: string,
    context: SyncContext,
    status: SyncStatus,
    changes: string[],
    errors: string[],
    metadata?: Record<string, any>
  ): SyncResult {
    return {
      status,
      entityId,
      mediaType: MediaType.TVShow,
      operation: SyncOperation.Metadata,
      serverId: context.serverConfig.id,
      timestamp: new Date(),
      changes,
      errors,
      metadata
    }
  }

  async validate?(entity: BaseMediaEntity, context: SyncContext): Promise<boolean> {
    return !!(entity.originalTitle && context.serverConfig.id)
  }
}
