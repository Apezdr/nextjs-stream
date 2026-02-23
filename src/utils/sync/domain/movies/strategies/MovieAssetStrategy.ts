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
  syncEventBus,
  getFieldPath,
  MovieFieldPathMap
} from '../../../core'

import { 
  MovieRepository,
  UrlBuilder 
} from '../../../infrastructure'

import {
  FileServerAdapter
} from '../../../core'

import { isCurrentServerHighestPriorityForField } from '@src/utils/sync/utils'
import { httpGet } from '@src/lib/httpHelper'

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
          console.log(`💾 Cache HIT for "${originalTitle}"`)
        } else {
          console.log(`🔍 Cache MISS for "${originalTitle}", querying database...`)
          movie = await this.repository.findByOriginalTitle(originalTitle)
          if (!movie) {
            console.log(`🎬 Movie not in database, creating basic entity for assets: "${originalTitle}"`)
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
          } else if (field === 'posterBlurhash') {
            movieToSave.posterBlurhashSource = context.serverConfig.id
          } else if (field === 'backdropBlurhash') {
            movieToSave.backdropBlurhashSource = context.serverConfig.id
          }
        })
        await this.repository.upsert(movieToSave)
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
  }> {
    const updates: any = {}
    
    // Get file server data for this movie
    const fileServerData = context.fileServerData?.movies?.[originalTitle]
    if (!fileServerData?.urls) {
      console.log(`⏭️ No fileServerData.urls found for "${originalTitle}"`)
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
        console.log(`⏭️ No ${type} path in fileServerData.urls for "${originalTitle}"`)
        continue
      }
      
      // Check if current server has highest priority for this asset field
      // CRITICAL: Use type-safe field path mapping (e.g., posterURL → "urls.poster")
      const fieldPath = getFieldPath(urlField as keyof typeof MovieFieldPathMap)
      if (!this.shouldUpdateField(fieldPath, originalTitle, context)) {
        console.log(`⏭️ Skipping ${urlField} - server ${context.serverConfig.id} does not have highest priority for ${fieldPath}`)
        continue
      }
      
      // Build full URL: fileServerData paths already include prefix, so pass empty prefix
      const newAssetUrl = UrlBuilder.createFullUrl(assetRelativePath, { ...context.serverConfig, prefix: '' })
      const currentUrl = currentMovie[urlField as keyof MovieEntity] as string
      
      // Extract hash from URLs to compare (hash indicates if image changed)
      const newHash = this.extractHashFromUrl(newAssetUrl)
      const currentHash = currentUrl ? this.extractHashFromUrl(currentUrl) : null
      const assetChanged = newHash !== currentHash
      
      console.log(`🔍 Asset comparison for ${type}:`, {
        newHash,
        currentHash,
        changed: assetChanged
      })
      
      // Update asset URL if changed
      if (assetChanged) {
        updates[urlField] = newAssetUrl
        console.log(`✅ Updating ${urlField} from server ${context.serverConfig.id} (hash changed: ${currentHash} → ${newHash})`)
      }
      
      // Handle blurhash for poster and backdrop
      // Fetch blurhash if:
      // 1. Asset hash changed (new/modified image = new blurhash needed), OR
      // 2. Blurhash doesn't exist yet (missing data)
      if (type === 'poster' || type === 'backdrop') {
        const blurhashField = type === 'poster' ? 'posterBlurhash' : 'backdropBlurhash'
        const blurhashSourceField = type === 'poster' ? 'posterBlurhashSource' : 'backdropBlurhashSource'
        const currentBlurhash = currentMovie[blurhashField as keyof MovieEntity]
        
        // Determine if we should fetch blurhash based on image hash change or missing data
        const shouldFetchBlurhash = assetChanged || !currentBlurhash
        
        if (shouldFetchBlurhash) {
          // Check if current server has highest priority for blurhash field
          // CRITICAL: Use type-safe field path mapping (e.g., posterBlurhash → "urls.posterBlurhash")
          const blurhashFieldPath = getFieldPath(blurhashField as keyof typeof MovieFieldPathMap)
          
          if (!this.shouldUpdateField(blurhashFieldPath, originalTitle, context)) {
            console.log(`⏭️ Skipping ${blurhashField} - server ${context.serverConfig.id} does not have highest priority for ${blurhashFieldPath}`)
            continue
          }
          
          const blurhashUrl = await this.findBlurhashUrl(originalTitle, type as 'poster' | 'backdrop', context)
          if (blurhashUrl) {
            const blurhashData = await this.fetchBlurhashData(blurhashUrl, context)
            // Only add blurhash fields if data was successfully fetched
            // If blurhashData is null, fields are OMITTED (not set to null in database)
            if (blurhashData) {
              updates[blurhashField] = blurhashData
              updates[blurhashSourceField] = context.serverConfig.id
              const reason = assetChanged ? `image hash changed (${currentHash} → ${newHash})` : 'blurhash missing'
              console.log(`✅ Fetched ${blurhashField} from file server (${reason})`)
            } else {
              console.log(`⏭️ Skipping ${blurhashField} - fetch returned null (field will be omitted)`)
            }
          }
        } else {
          console.log(`⏭️ Skipping ${blurhashField} - image hash unchanged and blurhash exists`)
        }
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
    
    console.log(`🔍 Looking for blurhash URL:`, {
      originalTitle,
      assetType,
      hasFileServerData: !!fileServerData,
      hasUrls: !!fileServerData?.urls,
      availableUrlKeys: fileServerData?.urls ? Object.keys(fileServerData.urls) : []
    })
    
    if (!fileServerData?.urls) {
      console.log(`⚠️ No fileServerData.urls found for "${originalTitle}"`)
      return null
    }
    
    const blurhashField = assetType === 'poster' ? 'posterBlurhash' : 'backdropBlurhash'
    const blurhashRelativePath = fileServerData.urls[blurhashField]
    
    console.log(`🔍 Blurhash path lookup:`, {
      blurhashField,
      blurhashRelativePath,
      found: !!blurhashRelativePath
    })
    
    if (!blurhashRelativePath) {
      console.log(`⚠️ No blurhash path found at fileServerData.urls.${blurhashField}`)
      return null
    }
    
    // Use UrlBuilder with empty prefix since fileServerData paths already include the prefix
    const fullUrl = UrlBuilder.createFullUrl(blurhashRelativePath, { ...context.serverConfig, prefix: '' })
    
    console.log(`✅ Built blurhash URL: ${fullUrl}`)
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
          console.warn(`⚠️ Blurhash URL returned HTML (error page), Content-Type: ${contentType}`)
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
        console.warn(`⚠️ Failed to fetch blurhash:`, error instanceof Error ? error.message : String(error))
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
   * Check if current server should update a field using existing priority system
   * CRITICAL: Always use originalTitle (filesystem key) for fieldAvailability lookups
   */
  private shouldUpdateField(fieldPath: string, originalTitle: string, context: SyncContext): boolean {
    console.log(`🔍 Priority check: field="${fieldPath}", originalTitle="${originalTitle}", server=${context.serverConfig.id}`)
    
    // Check if fieldAvailability exists
    if (!context.fieldAvailability) {
      console.log(`⚠️ No fieldAvailability in context, defaulting to true for ${fieldPath}`)
      return true
    }
    
    // Check if movie exists in fieldAvailability (using originalTitle as key)
    const movieFields = context.fieldAvailability?.movies?.[originalTitle]
    if (!movieFields) {
      console.log(`⚠️ Movie "${originalTitle}" not found in fieldAvailability, defaulting to true`)
      return true
    }
    
    // Get servers that have this field
    const serversWithField = movieFields[fieldPath] || []
    console.log(`📊 Servers with ${fieldPath}: ${JSON.stringify(serversWithField)} (${serversWithField.length} total)`)
    
    // Check priority
    const hasHighestPriority = isCurrentServerHighestPriorityForField(
      context.fieldAvailability,
      'movies',
      originalTitle,  // ← CRITICAL: Always use originalTitle for consistency
      fieldPath,
      context.serverConfig
    )
    
    if (hasHighestPriority) {
      console.log(`✅ Server ${context.serverConfig.id} (priority ${context.serverConfig.priority}) has highest priority for ${fieldPath}`)
    } else {
      console.log(`❌ Server ${context.serverConfig.id} (priority ${context.serverConfig.priority}) does NOT have highest priority for ${fieldPath}`)
    }
    
    return hasHighestPriority
  }

  async validate?(entity: BaseMediaEntity, context: SyncContext): Promise<boolean> {
    return !!(entity.title && context.serverConfig.id)
  }
}