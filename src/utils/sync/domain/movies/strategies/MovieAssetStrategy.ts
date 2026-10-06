/**
 * Movie asset sync strategy
 * Handles synchronization of movie assets (posters, backdrops, logos)
 */

import {
  SyncStrategy,
  SyncContext,
  SyncResult,
  SyncStatus,
  SyncOperation,
  MediaType,
  BaseMediaEntity,
  MovieEntity,
  BackdropFocal,
  syncEventBus,
  getFieldPath,
  MovieFieldPathMap
} from '../../../core'

import { 
  MovieRepository,
  UrlBuilder,
  isTopLevelFieldLocked
} from '../../../infrastructure'

import {
  FileServerAdapter
} from '../../../core'

import {
  isCurrentServerHighestPriorityForReportedField,
  getServersReportingField,
} from '@src/utils/sync/utils'
import { httpGet } from '@src/lib/httpHelper'
import { syncLogger } from '../../../core/logger'

// Carries the names of removed fields out of syncAssets without making them
// look like a field to write.
const CLEARED_FIELDS = Symbol('clearedFields')

export class MovieAssetStrategy implements SyncStrategy {
  readonly name = 'MovieAssetStrategy'
  readonly supportedOperations = [SyncOperation.Assets]
  readonly supportedMediaTypes = [MediaType.Movie]

  constructor(
    private repository: MovieRepository,
    private fileAdapter: FileServerAdapter
  ) {}

  canHandle(context: SyncContext): boolean {
    return (
      context.mediaType === MediaType.Movie &&
      context.operation === SyncOperation.Assets &&
      this.supportedMediaTypes.includes(context.mediaType) &&
      this.supportedOperations.includes(context.operation)
    )
  }

  async sync(entity: BaseMediaEntity | null, context: SyncContext): Promise<SyncResult> {
    const startTime = Date.now()
    const title = context.entityTitle || entity?.title || 'unknown'
    const originalTitle = context.entityOriginalTitle || entity?.originalTitle || title
    

    try {
      syncEventBus.emitProgress(
        title,
        MediaType.Movie,
        context.serverConfig.id,
        SyncOperation.Assets,
        { stage: 'starting', progress: 0 }
      )

      let movie = entity as MovieEntity | null
      if (!movie) {
        // 🚀 OPTIMIZATION: Check cache first, then database
        if (context.movieCache?.has(originalTitle)) {
          movie = context.movieCache.get(originalTitle)!
          syncLogger.debug(`💾 Cache HIT for "${originalTitle}"`)
        } else {
          syncLogger.debug(`🔍 Cache MISS for "${originalTitle}", querying database...`)
          movie = await this.repository.findByOriginalTitle(originalTitle)
          if (!movie) {
            syncLogger.debug(`🎬 Movie not in database, creating basic entity for assets: "${originalTitle}"`)
            movie = {
              title,
              originalTitle,
              lastSynced: new Date(),
              metadata: {}
            }
          }
        }
      }

      const changes: string[] = []
      const assetUpdates = await this.syncAssets(originalTitle, context, movie)
      const clearedFields: string[] = (assetUpdates as any)[CLEARED_FIELDS] ?? []
      changes.push(...clearedFields.map(key => `Cleared ${key}`))

      if (Object.keys(assetUpdates).length > 0) {
        // Use upsert to handle both new and existing movies with field-level source tracking
        const movieToSave = {
          ...movie,
          ...assetUpdates,
          title, // Ensure title is always set
          originalTitle, // Ensure originalTitle is always set
          lastSynced: new Date()
        }
        
        // Add source tracking for updated asset fields
        Object.keys(assetUpdates).forEach(field => {
          // Map field names to their source tracking fields
          if (field === 'posterURL') {
            movieToSave.posterSource = context.serverConfig.id
          } else if (field === 'backdrop') {
            movieToSave.backdropSource = context.serverConfig.id
          } else if (field === 'logo') {
            movieToSave.logoSource = context.serverConfig.id
          } else if (field === 'backdropFocal') {
            movieToSave.backdropFocalSource = context.serverConfig.id
          } else if (field === 'backdropFocalSuggested') {
            movieToSave.backdropFocalSuggestedSource = context.serverConfig.id
          }
        })
        // Accumulate changes for consolidated write in MovieSyncService
        if (context.pendingMovieUpdates) {
          const prev = context.pendingMovieUpdates.get(originalTitle) || {}
          context.pendingMovieUpdates.set(originalTitle, { ...prev, ...movieToSave })
        } else {
          await this.repository.upsert(movieToSave)
        }
        changes.push(...Object.keys(assetUpdates).map(key => `Updated ${key}`))
        
        syncEventBus.emitProgress(
          title,
          MediaType.Movie,
          context.serverConfig.id,
          SyncOperation.Assets,
          { 
            stage: 'completed', 
            progress: 100, 
            updatedAssets: Object.keys(assetUpdates)
          }
        )
      } else {
        syncEventBus.emitProgress(
          title,
          MediaType.Movie,
          context.serverConfig.id,
          SyncOperation.Assets,
          { stage: 'unchanged', progress: 100 }
        )
      }

      return this.createResult(
        title,
        context,
        changes.length > 0 ? SyncStatus.Completed : SyncStatus.Skipped,
        changes,
        [],
        { 
          processingTime: Date.now() - startTime,
          assetsProcessed: Object.keys(assetUpdates)
        }
      )

    } catch (error) {
      syncEventBus.emitError(
        title,
        MediaType.Movie,
        context.serverConfig.id,
        error instanceof Error ? error.message : String(error),
        SyncOperation.Assets
      )

      return this.createResult(
        title,
        context,
        SyncStatus.Failed,
        [],
        [error instanceof Error ? error.message : String(error)],
        { processingTime: Date.now() - startTime }
      )
    }
  }

  /**
   * Sync all asset types for a movie using originalTitle (filesystem key)
   * Gets URLs from fileServerData (which includes hash for cache-busting and change detection)
   */
  private async syncAssets(
    originalTitle: string,
    context: SyncContext,
    currentMovie: MovieEntity
  ): Promise<{
    posterURL?: string
    backdrop?: string
    logo?: string
    posterBlurhash?: string
    backdropBlurhash?: string
    posterBlurhashSource?: string
    backdropBlurhashSource?: string
    backdropFocal?: BackdropFocal
    backdropFocalSuggested?: BackdropFocal
  }> {
    const updates: any = {}
    // Fields this pass asked to have removed (see requestUnset).
    const cleared: string[] = []
    Object.defineProperty(updates, CLEARED_FIELDS, { value: cleared, enumerable: false })
    
    // Get file server data for this movie
    const fileServerData = context.fileServerData?.movies?.[originalTitle]
    if (!fileServerData?.urls) {
      syncLogger.debug(`⏭️ No fileServerData.urls found for "${originalTitle}"`)
      return updates
    }

    // Define asset types with their corresponding field names
    // IMPORTANT: poster uses "posterURL", but backdrop and logo do NOT have "URL" suffix
    const assetTypes = [
      { type: 'poster', urlField: 'posterURL', fileServerKey: 'poster' },
      { type: 'backdrop', urlField: 'backdrop', fileServerKey: 'backdrop' },
      { type: 'logo', urlField: 'logo', fileServerKey: 'logo' }
    ]

    // Process each asset type
    for (const { type, urlField, fileServerKey } of assetTypes) {
      const assetRelativePath = fileServerData.urls[fileServerKey]
      
      if (!assetRelativePath) {
        syncLogger.debug(`⏭️ No ${type} path in fileServerData.urls for "${originalTitle}"`)
        continue
      }
      
      // The asset belongs to the highest-priority server that HAS it.
      // CRITICAL: Use type-safe field path mapping (e.g., posterURL → "urls.poster")
      const fieldPath = getFieldPath(urlField as keyof typeof MovieFieldPathMap)
      if (!this.ownsReportedField(fieldPath, originalTitle, context)) {
        syncLogger.debug(`⏭️ Skipping ${urlField} - server ${context.serverConfig.id} does not have highest priority for ${fieldPath}`)
        continue
      }

      // Build full URL: fileServerData paths already include prefix, so pass empty prefix
      const newAssetUrl = UrlBuilder.createFullUrl(assetRelativePath, { ...context.serverConfig, prefix: '' })
      const currentUrl = currentMovie[urlField as keyof MovieEntity] as string

      // The stored URL must be the owner's URL. The two used to be compared by
      // their ?hash= alone, which is the image file's modified time: a copy of
      // the same file on another server has the same one. So when a title
      // moved to another server, or the owner was down when the title was
      // first synced, the stored URL kept pointing at the other server for good.
      const newHash = this.extractHashFromUrl(newAssetUrl)
      const currentHash = currentUrl ? this.extractHashFromUrl(currentUrl) : null
      const assetChanged = newAssetUrl !== currentUrl

      syncLogger.debug(`🔍 Asset comparison for ${type}:`, {
        newHash,
        currentHash,
        changed: assetChanged
      })
      
      // Update asset URL if changed
      if (assetChanged) {
        updates[urlField] = newAssetUrl
        syncLogger.debug(`✅ Updating ${urlField} from server ${context.serverConfig.id} (hash changed: ${currentHash} → ${newHash})`)
      }
      
      // Blurhash for poster and backdrop.
      //
      // A stored blurhash is good only while it is OF THE STORED IMAGE: taken
      // from this server (the image's owner, checked above) and not older than
      // the image. One that is not is replaced, and when this pass has nothing
      // to replace it with (the file server publishes no blurhash for the new
      // image yet, or the fetch failed) it is removed: no blurhash is right,
      // another picture's is not. A failed fetch is also recorded, so the pass
      // is not marked complete and the next run tries again.
      //
      // It used to be fetched "when the image changed or none is stored" and
      // otherwise left alone, so one failed fetch after an image was replaced
      // left the old image's blurhash for good: next run the image no longer
      // looked changed and a blurhash was there.
      if (type === 'poster' || type === 'backdrop') {
        const blurhashField = type === 'poster' ? 'posterBlurhash' : 'backdropBlurhash'
        const blurhashSourceField = type === 'poster' ? 'posterBlurhashSource' : 'backdropBlurhashSource'
        const lockedFields = (currentMovie as any).lockedFields
        // An image an admin locked is not the file server's image, and a
        // blurhash an admin locked is not ours to change.
        if (isTopLevelFieldLocked(lockedFields, urlField) || isTopLevelFieldLocked(lockedFields, blurhashField)) {
          continue
        }

        const currentBlurhash = currentMovie[blurhashField as keyof MovieEntity]
        const notOfThisImage =
          Boolean(currentBlurhash) &&
          (assetChanged || (currentMovie as any)[blurhashSourceField] !== context.serverConfig.id)

        let fetched: string | null = null
        if (!currentBlurhash || notOfThisImage) {
          const blurhashUrl = await this.findBlurhashUrl(originalTitle, type as 'poster' | 'backdrop', context)
          if (blurhashUrl) {
            fetched = await this.fetchBlurhashData(blurhashUrl, context)
            if (fetched) {
              context.pendingMovieFetchFailures?.get(originalTitle)?.delete(blurhashField)
            } else {
              this.noteFetchFailure(originalTitle, blurhashField, context)
            }
          }
        }

        if (fetched) {
          if (currentBlurhash !== fetched) updates[blurhashField] = fetched
          if ((currentMovie as any)[blurhashSourceField] !== context.serverConfig.id) {
            updates[blurhashSourceField] = context.serverConfig.id
          }
        } else if (notOfThisImage) {
          this.requestUnset(originalTitle, [blurhashField, blurhashSourceField], context)
          cleared.push(blurhashField)
        }
      }
    }

    // Backdrop focal-point hints — top-level scalars in fileServerData, plain
    // string enum (not URL/hash). The file server always publishes both keys,
    // null when it has no hint.
    //
    // A hint belongs to the highest-priority server that HAS one. A server
    // without one used to write its null whenever no higher-priority server
    // was listed for the field, and the server with the hint wrote it back:
    // the stored value flipped on every run and neither server was ever
    // skipped. The hint is removed only when no server has one, and then only
    // on a run where every server answered.
    // `undefined` means the server doesn't supply the field at all — skip.
    for (const focalField of ['backdropFocal', 'backdropFocalSuggested'] as const) {
      const incoming = fileServerData[focalField]
      if (incoming === undefined) {
        syncLogger.debug(`⏭️ No ${focalField} in fileServerData for "${originalTitle}"`)
        continue
      }

      const fieldPath = getFieldPath(focalField)
      const current = currentMovie[focalField] ?? null

      if (incoming !== null && incoming !== '') {
        if (!this.ownsReportedField(fieldPath, originalTitle, context)) {
          syncLogger.debug(`⏭️ Skipping ${focalField} - server ${context.serverConfig.id} does not have highest priority for ${fieldPath}`)
          continue
        }
        // The owner's id is the hint's source whether or not the value moved.
        if ((currentMovie as any)[`${focalField}Source`] !== context.serverConfig.id) {
          updates[`${focalField}Source`] = context.serverConfig.id
        }
        if (incoming !== current) {
          updates[focalField] = incoming as BackdropFocal
          syncLogger.debug(`✅ Updating ${focalField} from server ${context.serverConfig.id} ("${current}" → "${incoming}")`)
        }
        continue
      }

      // This server has no hint. Nothing to do unless one is stored and no
      // server has one any more.
      if (current === null) continue
      // A hint an admin locked stays, whatever the servers say.
      if (isTopLevelFieldLocked((currentMovie as any).lockedFields, focalField)) continue
      const serversWithHint = getServersReportingField(
        context.fieldAvailability, 'movies', originalTitle, fieldPath
      )
      if (serversWithHint.length > 0) continue
      if ((context.allEnabledServersProbed ?? context.cleanup?.allEnabledServersProbed) === true) {
        this.requestUnset(originalTitle, [focalField, `${focalField}Source`], context)
        cleared.push(focalField)
      } else {
        // Its server may simply be down. Retry on a run where they all answer.
        context.pendingMovieDeferrals?.add(originalTitle)
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
      // If URL parsing fails, return null
      return null
    }
  }


  /**
   * Find blurhash URL from file server (matches legacy behavior)
   */
  private async findBlurhashUrl(
    originalTitle: string,
    assetType: 'poster' | 'backdrop',
    context: SyncContext
  ): Promise<string | null> {
    // Check if file server data has blurhash URLs
    const fileServerData = context.fileServerData?.movies?.[originalTitle]
    
    syncLogger.debug(`🔍 Looking for blurhash URL:`, {
      originalTitle,
      assetType,
      hasFileServerData: !!fileServerData,
      hasUrls: !!fileServerData?.urls,
      availableUrlKeys: fileServerData?.urls ? Object.keys(fileServerData.urls) : []
    })
    
    if (!fileServerData?.urls) {
      syncLogger.debug(`⚠️ No fileServerData.urls found for "${originalTitle}"`)
      return null
    }
    
    const blurhashField = assetType === 'poster' ? 'posterBlurhash' : 'backdropBlurhash'
    const blurhashRelativePath = fileServerData.urls[blurhashField]
    
    syncLogger.debug(`🔍 Blurhash path lookup:`, {
      blurhashField,
      blurhashRelativePath,
      found: !!blurhashRelativePath
    })
    
    if (!blurhashRelativePath) {
      syncLogger.debug(`⚠️ No blurhash path found at fileServerData.urls.${blurhashField}`)
      return null
    }
    
    // Use UrlBuilder with empty prefix since fileServerData paths already include the prefix
    const fullUrl = UrlBuilder.createFullUrl(blurhashRelativePath, { ...context.serverConfig, prefix: '' })
    
    syncLogger.debug(`✅ Built blurhash URL: ${fullUrl}`)
    return fullUrl
  }
  
  /**
   * Fetch actual blurhash data from URL using httpHelper
   * httpHelper handles caching and HTTP errors internally
   * Returns null on failure so the field is OMITTED (not set to null in database)
   * Respects ResourceManager HTTP throttling when available in context
   */
  private async fetchBlurhashData(blurhashUrl: string, context?: SyncContext): Promise<string | null> {
    const doFetch = async () => {
      try {
        const response = await httpGet(
          blurhashUrl,
          {
            timeout: 3000,  // 3 second timeout for blurhash (matches legacy)
            responseType: 'text',
            headers: {
              'Accept': 'text/plain, */*'
            }
          },
          true  // returnCacheDataIfAvailable - return cached data on 304
        )
        
        // Check Content-Type header - should be text/plain, not text/html (error page)
        const contentType = response.headers['content-type'] || response.headers['Content-Type'] || ''
        if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
          syncLogger.warn(`⚠️ Blurhash URL returned HTML (error page), Content-Type: ${contentType}`)
          return null
        }
        
        // Extract data from wrapper if it's a cached response with _dataType
        // httpHelper stores text as: { _dataType: 'text', _isBuffer: false, data: actualText }
        let blurhashData = response.data
        if (blurhashData && typeof blurhashData === 'object' && blurhashData._dataType === 'text') {
          blurhashData = blurhashData.data
        }
        
        const trimmedData = blurhashData ? blurhashData.trim() : null
        
        if (!trimmedData) {
          return null
        }
        
        return trimmedData
      } catch (error) {
        // httpHelper throws on HTTP errors (404, 500, timeouts, etc)
        // Return null so field is OMITTED from database update (not set to null)
        syncLogger.warn(`⚠️ Failed to fetch blurhash:`, error instanceof Error ? error.message : String(error))
        return null
      }
    }

    // Throttle through ResourceManager if available
    if (context?.resourceManager) {
      return context.resourceManager.throttleHttp(doFetch)
    }
    return doFetch()
  }

  /**
   * Create standardized sync result
   */
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
      mediaType: MediaType.Movie,
      operation: SyncOperation.Assets,
      serverId: context.serverConfig.id,
      timestamp: new Date(),
      changes,
      errors,
      metadata
    }
  }

  /**
   * Whether this server is the highest-priority server that HAS a value at
   * `fieldPath` for the title. Fails closed: a server that does not report the
   * field never owns it, and neither does anyone when the availability map is
   * missing.
   */
  private ownsReportedField(fieldPath: string, originalTitle: string, context: SyncContext): boolean {
    return isCurrentServerHighestPriorityForReportedField(
      context.fieldAvailability, 'movies', originalTitle, fieldPath, context.serverConfig
    )
  }

  /**
   * Ask MovieSyncService to remove fields in its consolidated write. The map
   * is created by the service: this strategy only ever sees a copy of the
   * context, so a map created here would be lost.
   */
  private requestUnset(originalTitle: string, fields: string[], context: SyncContext): void {
    const pending = context.pendingMovieUnsets?.get(originalTitle)
    if (!pending) {
      throw new Error(`MovieAssetStrategy: no pending-unset set for "${originalTitle}"; cannot remove ${fields.join(', ')}`)
    }
    for (const field of fields) pending.add(field)
    const updates: any = context.pendingMovieUpdates?.get(originalTitle)
    if (updates) for (const field of fields) delete updates[field]
  }

  /** Record that a file the server publishes could not be fetched this pass. */
  private noteFetchFailure(originalTitle: string, what: string, context: SyncContext): void {
    const failures = context.pendingMovieFetchFailures
    if (!failures) return
    const forTitle = failures.get(originalTitle) ?? new Set<string>()
    forTitle.add(what)
    failures.set(originalTitle, forTitle)
  }

  async validate?(entity: BaseMediaEntity, context: SyncContext): Promise<boolean> {
    return !!(entity.title && context.serverConfig.id)
  }
}