/**
 * TV show asset sync strategy
 * Handles synchronization of TV show assets: posterURL, backdropURL, logoURL
 * Modeled after MovieAssetStrategy with TV-specific field paths and entity structure
 */

import {
  SyncStrategy, SyncContext, SyncResult, SyncStatus, SyncOperation,
  MediaType, BaseMediaEntity, TVShowEntity, syncEventBus
} from '../../../core'

import { TVShowRepository, UrlBuilder } from '../../../infrastructure'
import { FileServerAdapter } from '../../../core'
import { syncLogger } from '../../../core/logger'
import { isCurrentServerHighestPriorityForField } from '@src/utils/sync/utils'

export class TVShowAssetStrategy implements SyncStrategy {
  readonly name = 'TVShowAssetStrategy'
  readonly supportedOperations = [SyncOperation.Assets]
  readonly supportedMediaTypes = [MediaType.TVShow]

  constructor(
    private repository: TVShowRepository,
    private fileAdapter: FileServerAdapter
  ) {}

  canHandle(context: SyncContext): boolean {
    return (
      context.mediaType === MediaType.TVShow &&
      context.operation === SyncOperation.Assets &&
      this.supportedMediaTypes.includes(context.mediaType) &&
      this.supportedOperations.includes(context.operation)
    )
  }

  async sync(entity: BaseMediaEntity | null, context: SyncContext): Promise<SyncResult> {
    const startTime = Date.now()
    const title = context.entityTitle || entity?.title || 'unknown'
    const originalTitle = context.entityOriginalTitle || entity?.originalTitle || title

    syncLogger.debug(`TVShowAssetStrategy starting for: "${title}"`)

    try {
      syncEventBus.emitProgress(title, MediaType.TVShow, context.serverConfig.id,
        SyncOperation.Assets, { stage: 'starting', progress: 0 })

      let show = entity as TVShowEntity | null
      if (!show) {
        if (context.tvShowCache?.has(originalTitle)) {
          show = context.tvShowCache.get(originalTitle)!
          syncLogger.debug(`Cache HIT for "${originalTitle}"`)
        } else {
          syncLogger.debug(`Cache MISS for "${originalTitle}", querying database...`)
          show = await this.repository.findByOriginalTitle(originalTitle)
          if (!show) {
            syncLogger.debug(`TV show not in database, creating basic entity for assets: "${originalTitle}"`)
            show = { title, originalTitle, lastSynced: new Date(), metadata: {} } as TVShowEntity
          }
        }
      }

      const changes: string[] = []
      const assetUpdates = await this.syncAssets(originalTitle, context, show)

      if (Object.keys(assetUpdates).length > 0) {
        const showToSave = {
          ...show,
          ...assetUpdates,
          title,
          originalTitle,
          lastSynced: new Date()
        } as TVShowEntity

        // Source tracking for updated asset fields
        Object.keys(assetUpdates).forEach(field => {
          if (field === 'posterURL') (showToSave as any).posterSource = context.serverConfig.id
          else if (field === 'backdropURL') (showToSave as any).backdropSource = context.serverConfig.id
          else if (field === 'logoURL') (showToSave as any).logoSource = context.serverConfig.id
        })

        await this.repository.upsert(showToSave)
        changes.push(...Object.keys(assetUpdates).map(key => `Updated ${key}`))

        syncEventBus.emitProgress(title, MediaType.TVShow, context.serverConfig.id,
          SyncOperation.Assets,
          { stage: 'completed', progress: 100, updatedAssets: Object.keys(assetUpdates) })
      } else {
        syncEventBus.emitProgress(title, MediaType.TVShow, context.serverConfig.id,
          SyncOperation.Assets, { stage: 'unchanged', progress: 100 })
      }

      return this.createResult(
        title, context,
        changes.length > 0 ? SyncStatus.Completed : SyncStatus.Skipped,
        changes, [],
        { processingTime: Date.now() - startTime, assetsProcessed: Object.keys(assetUpdates) }
      )

    } catch (error) {
      syncEventBus.emitError(title, MediaType.TVShow, context.serverConfig.id,
        error instanceof Error ? error.message : String(error), SyncOperation.Assets)
      return this.createResult(title, context, SyncStatus.Failed, [],
        [error instanceof Error ? error.message : String(error)],
        { processingTime: Date.now() - startTime })
    }
  }

  /**
   * Sync all asset types for a TV show using originalTitle (filesystem key)
   * TV show data is at fileServerData.tv[originalTitle]
   * TVShowEntity uses posterURL, backdropURL, logoURL (all with URL suffix, unlike movies)
   */
  private async syncAssets(
    originalTitle: string,
    context: SyncContext,
    currentShow: TVShowEntity
  ): Promise<{ posterURL?: string; backdropURL?: string; logoURL?: string }> {
    const updates: any = {}

    // TV show data lives under fileServerData.tv[originalTitle]
    const fileServerData = context.fileServerData?.tv?.[originalTitle]
    if (!fileServerData?.urls) {
      syncLogger.debug(`No fileServerData.urls found for "${originalTitle}"`)
      return updates
    }

    // TV show asset types — all fields end with URL (unlike movies where backdrop/logo omit URL)
    // Field paths in fieldAvailability for TV shows follow the legacy 'poster', 'backdrop', 'logo' keys
    const assetTypes = [
      { type: 'poster',   urlField: 'posterURL',   fileServerKey: 'poster',   fieldAvailKey: 'poster' },
      { type: 'backdrop', urlField: 'backdropURL',  fileServerKey: 'backdrop', fieldAvailKey: 'backdrop' },
      { type: 'logo',     urlField: 'logoURL',      fileServerKey: 'logo',     fieldAvailKey: 'logo' }
    ]

    for (const { type, urlField, fileServerKey, fieldAvailKey } of assetTypes) {
      const assetRelativePath = fileServerData.urls[fileServerKey]

      if (!assetRelativePath) {
        syncLogger.debug(`No ${type} path in fileServerData.urls for "${originalTitle}"`)
        continue
      }

      // Check if current server has highest priority for this asset field
      // TV uses raw field names (poster, backdrop, logo) in fieldAvailability
      if (!this.shouldUpdateField(fieldAvailKey, originalTitle, context)) {
        syncLogger.debug(
          `Skipping ${urlField} — server ${context.serverConfig.id} does not have highest priority for ${fieldAvailKey}`
        )
        continue
      }

      // Build full URL — fileServerData paths already include prefix, so pass empty prefix
      const newAssetUrl = UrlBuilder.createFullUrl(assetRelativePath, { ...context.serverConfig, prefix: '' })
      const currentUrl = currentShow[urlField as keyof TVShowEntity] as string

      const newHash = this.extractHashFromUrl(newAssetUrl)
      const currentHash = currentUrl ? this.extractHashFromUrl(currentUrl) : null
      const assetChanged = newHash !== currentHash

      syncLogger.debug(`Asset comparison for ${type}: newHash=${newHash}, currentHash=${currentHash}, changed=${assetChanged}`)

      if (assetChanged) {
        updates[urlField] = newAssetUrl
        syncLogger.debug(
          `Updating ${urlField} from server ${context.serverConfig.id} (hash changed: ${currentHash} -> ${newHash})`
        )
      }
    }

    return updates
  }

  /**
   * Extract hash parameter from URL for change detection
   * URLs include hash like: /path/to/image.jpg?hash=abc123
   */
  private extractHashFromUrl(url: string): string | null {
    try {
      const urlObj = new URL(url)
      return urlObj.searchParams.get('hash')
    } catch {
      return null
    }
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
      operation: SyncOperation.Assets,
      serverId: context.serverConfig.id,
      timestamp: new Date(),
      changes,
      errors,
      metadata
    }
  }

  async validate?(entity: BaseMediaEntity, context: SyncContext): Promise<boolean> {
    return !!(entity.title && context.serverConfig.id)
  }
}
