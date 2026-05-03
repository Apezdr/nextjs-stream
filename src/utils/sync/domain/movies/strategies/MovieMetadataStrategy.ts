/**
 * Movie metadata sync strategy
 * Handles synchronization of movie metadata information with hash-based change detection
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
  DatabaseError,
  syncEventBus,
  getFieldPath,
  MovieFieldPathMap
} from '../../../core'

import { syncLogger } from '../../../core/logger'

import {
  MovieRepository,
  UrlBuilder
} from '../../../infrastructure'

import {
  FileServerAdapter
} from '../../../core'

import { isCurrentServerHighestPriorityForField } from '@src/utils/sync/utils'
import { fetchMetadataMultiServer } from '@src/utils/admin_utils'

export class MovieMetadataStrategy implements SyncStrategy {
  readonly name = 'MovieMetadataStrategy'
  readonly supportedOperations = [SyncOperation.Metadata]
  readonly supportedMediaTypes = [MediaType.Movie]
  /*
   * Current version of the metadata schema, updated as schema/output changes are made
   */
  readonly currentVersion = '2.1'

  constructor(
    private repository: MovieRepository,
    private fileAdapter: FileServerAdapter
  ) {}

  /**
   * Check if this strategy can handle the sync context
   */
  canHandle(context: SyncContext): boolean {
    return (
      context.mediaType === MediaType.Movie &&
      context.operation === SyncOperation.Metadata &&
      this.supportedMediaTypes.includes(context.mediaType) &&
      this.supportedOperations.includes(context.operation)
    )
  }

  /**
   * Sync movie metadata
   */
  async sync(entity: BaseMediaEntity | null, context: SyncContext): Promise<SyncResult> {
    const startTime = Date.now()
    const title = context.entityTitle || entity?.title
    const originalTitle = context.entityOriginalTitle || entity?.originalTitle || title
    
    syncLogger.debug(`🎬 MovieMetadataStrategy starting for: "${title}"`)
    
    if (!title || title.trim().length === 0) {
      return this.createResult(
        'unknown',
        context,
        SyncStatus.Failed,
        [],
        ['Movie title is required but was not provided'],
        { processingTime: Date.now() - startTime }
      )
    }

    if (!originalTitle || originalTitle.trim().length === 0) {
      return this.createResult(
        title || 'unknown',
        context,
        SyncStatus.Failed,
        [],
        ['Original title is required for metadata sync operations'],
        { processingTime: Date.now() - startTime }
      )
    }
    
    try {
      syncEventBus.emitProgress(
        title,
        MediaType.Movie,
        context.serverConfig.id,
        SyncOperation.Metadata,
        { stage: 'starting', progress: 0 }
      )

      // Get current movie entity using originalTitle (filesystem key)
      let movie = entity as MovieEntity | null
      if (!movie) {
        // 🚀 OPTIMIZATION: Check cache first, then database
        if (context.movieCache?.has(originalTitle)) {
          movie = context.movieCache.get(originalTitle)!
          syncLogger.debug(`💾 Cache HIT for "${originalTitle}"`)
        } else {
          syncLogger.debug(`🔍 Cache MISS for "${originalTitle}", querying database...`)
          movie = await this.repository.findByOriginalTitle(originalTitle)
        }
      }

      const changes: string[] = []
      
      // 🚀 CRITICAL FIX: Check priority FIRST before doing any work
      // This prevents lower-priority servers from wasting API calls
      const canUpdateMetadata = this.shouldUpdateField(getFieldPath('metadata'), originalTitle, context)
      
      if (!canUpdateMetadata) {
        syncLogger.debug(`⏭️ Server ${context.serverConfig.id} (priority ${context.serverConfig.priority}) does not have priority for metadata, skipping`)
        return this.createResult(
          title,
          context,
          SyncStatus.Skipped,
          [],
          [],
          {
            processingTime: Date.now() - startTime,
            reason: 'server does not have priority for metadata field'
          }
        )
      }
      
      syncLogger.debug(`✅ Server ${context.serverConfig.id} (priority ${context.serverConfig.priority}) has priority for metadata, proceeding`)
      
      // Check if we have metadata hash from context for change detection
      const metadataHashInfo = context.metadataHashesCache?.titles?.[originalTitle]
      const currentMetadataHash = movie?.metadataHash
      
      // Guard: only trust the hash skip when metadata is actually populated.
      // If metadata is empty ({} or absent), force a re-fetch even when hashes match —
      // this repairs movies that previously had their metadata clobbered by a bug
      // while the metadataHash was still stored, leaving them permanently stuck in skip.
      const metadataIsPopulated = movie?.metadata
        && typeof movie.metadata === 'object'
        && Object.keys(movie.metadata).length > 0
        && movie.metadata.hasExternalMetadata !== false

      // If we have both hashes and they match, skip metadata fetch (optimization)
      if (metadataHashInfo?.hash && currentMetadataHash && metadataHashInfo.hash === currentMetadataHash && metadataIsPopulated) {
        syncLogger.debug(`📝 Metadata hash unchanged for "${originalTitle}" (${metadataHashInfo.hash}), skipping fetch`)
        
        // Still return success but with no changes
        return this.createResult(
          title,
          context,
          SyncStatus.Skipped,
          [],
          [],
          {
            processingTime: Date.now() - startTime,
            reason: 'metadata hash unchanged'
          }
        )
      }
      
      if (metadataHashInfo?.hash) {
        syncLogger.debug(`🔄 Metadata hash changed for "${originalTitle}": ${currentMetadataHash || 'none'} → ${metadataHashInfo.hash}`)
      }
      
      let metadata = await this.extractMetadata(originalTitle, context)

      // If metadata extraction failed, create basic metadata
      if (!metadata) {
        syncLogger.debug(`📝 Metadata extraction failed for "${title}", creating basic metadata`)
        metadata = {
          title,
          source: context.serverConfig.id,
          dateAdded: new Date().toISOString(),
          lastScanned: new Date().toISOString(),
          hasExternalMetadata: false
        }
      }
      
      // Attach metadata hash if available
      if (metadataHashInfo?.hash) {
        metadata._metadataHash = metadataHashInfo.hash
      }

      // Create or update movie entity using proven priority system
      const movieToSave = {
        ...(movie || {}), // Include existing movie data if it exists
        originalTitle,
        title: title, // Always ensure title is set as fallback
        lastSynced: new Date(),
      }

      // Check if entity needs version upgrade or normal metadata update
      const needsVersionUpgrade = !movie?.syncVersion || movie.syncVersion < this.currentVersion
      
      // Note: canUpdateMetadata was already checked at the start (priority check)
      // We only reach here if we have priority for metadata
      // Apply metadata normalization (includes migrations for version upgrades)
      const normalizedMetadata = this.normalizeMetadata(metadata)
      
      // For version upgrades, apply normalization but still check if values actually changed
      // This ensures old data gets migrated to new schema (e.g., string → Date conversion)
      const metadataChanged = !this.isMetadataEqual(movie?.metadata, normalizedMetadata)
      
      if (needsVersionUpgrade || metadataChanged) {
        movieToSave.metadata = normalizedMetadata
        movieToSave.metadataSource = context.serverConfig.id
        movieToSave.syncVersion = this.currentVersion  // Update version after successful migration
        
        // Store metadata hash for future change detection
        if (metadata._metadataHash) {
          movieToSave.metadataHash = metadata._metadataHash
          syncLogger.debug(`📊 Storing metadata hash: ${metadata._metadataHash}`)
        }
        
        if (needsVersionUpgrade && metadataChanged) {
          changes.push(`Updated movie metadata (schema migration: ${movie?.syncVersion || 'none'} → ${this.currentVersion})`)
          syncLogger.debug(`🔄 Schema migration with changes: "${originalTitle}" ${movie?.syncVersion || 'none'} → ${this.currentVersion}`)
        } else if (needsVersionUpgrade && !metadataChanged) {
          changes.push(`Schema version updated (${movie?.syncVersion || 'none'} → ${this.currentVersion})`)
          syncLogger.debug(`📋 Schema version updated (no data changes): "${originalTitle}" ${movie?.syncVersion || 'none'} → ${this.currentVersion}`)
        } else if (!needsVersionUpgrade && metadataChanged) {
          changes.push('Updated movie metadata')
          syncLogger.debug(`🔄 Metadata changed for: "${originalTitle}"`)
        } else {
          // This case should never happen (both conditions false inside the parent if statement)
          syncLogger.debug(`⚠️ Unexpected condition in metadata update for: "${originalTitle}"`)
        }
        
        // Log Date objects being saved for debugging
        if (normalizedMetadata.release_date instanceof Date) {
          syncLogger.debug(`📅 Saving release_date as Date object: ${normalizedMetadata.release_date.toISOString()}`)
        } else if (normalizedMetadata.release_date) {
          syncLogger.debug(`📅 Saving release_date as ${typeof normalizedMetadata.release_date}: ${normalizedMetadata.release_date}`)
        }
      }

      // Note: The "pretty" title comes from metadata.json, not from fileserver
      // The metadata priority check above already handles this
      // The fileserver key IS the originalTitle (filesystem key)
      
      // If metadata fetch succeeded and contains a title, use it
      if (metadata?.title && metadata.title !== movie?.title) {
        movieToSave.title = metadata.title
        movieToSave.titleSource = context.serverConfig.id
        changes.push(`Updated title from metadata: "${metadata.title}"`)
        syncLogger.debug(`📝 Title from metadata: "${metadata.title}"`)
      }

      // originalTitle should always be set as it's the filesystem key, but only update if changed
      if (movie?.originalTitle !== originalTitle) {
        syncLogger.debug(`🔄 OriginalTitle change detected: "${movie?.originalTitle}" → "${originalTitle}"`)
        movieToSave.originalTitle = originalTitle
        movieToSave.originalTitleSource = context.serverConfig.id
        changes.push('Updated originalTitle')
      }

      // Only record a change if we actually made changes
      const hasActualChanges = changes.length > 0;
      
      // Accumulate changes for consolidated write in MovieSyncService.
      // MovieSyncService performs a single smartUpsert after all strategies complete.
      if (context.pendingMovieUpdates) {
        const prev = context.pendingMovieUpdates.get(originalTitle) || {}
        context.pendingMovieUpdates.set(originalTitle, { ...prev, ...movieToSave })
      } else {
        // Fallback: direct write when called outside the consolidated movie sync path
        await this.repository.upsert(movieToSave)
      }
      
      if (!movie) {
        changes.push('Created new movie entity')
        syncEventBus.emitProgress(
          title,
          MediaType.Movie,
          context.serverConfig.id,
          SyncOperation.Metadata,
          { stage: 'created', progress: 100 }
        )
      } else if (hasActualChanges) {
        // Only emit the 'updated' event if we actually made changes
        syncEventBus.emitProgress(
          title,
          MediaType.Movie,
          context.serverConfig.id,
          SyncOperation.Metadata,
          { stage: 'updated', progress: 100 }
        )
      } else {
        // No changes were made
        syncEventBus.emitProgress(
          title,
          MediaType.Movie,
          context.serverConfig.id,
          SyncOperation.Metadata,
          { stage: 'unchanged', progress: 100 }
        )
      }

      return this.createResult(
        title,
        context,
        SyncStatus.Completed,
        changes,
        [],
        { 
          processingTime: Date.now() - startTime,
          metadataFields: Object.keys(metadata)
        }
      )

    } catch (error) {
      syncEventBus.emitError(
        title,
        MediaType.Movie,
        context.serverConfig.id,
        error instanceof Error ? error.message : String(error),
        SyncOperation.Metadata
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
   * Extract metadata from file server using originalTitle (filesystem key)
   * Now uses fetchMetadataMultiServer for caching and reliability
   * Respects ResourceManager HTTP throttling when available in context
   */
  private async extractMetadata(originalTitle: string, context: SyncContext): Promise<Record<string, any> | null> {
    const doFetch = async () => {
      try {
        // Get metadata URL from fileserver data if available
        const fileServerData = context.fileServerData?.movies?.[originalTitle]
        const metadataRelativePath = fileServerData?.urls?.metadata
        
        // Use fetchMetadataMultiServer from admin_utils for caching and reliability
        const metadata = await fetchMetadataMultiServer(
          context.serverConfig.id,
          metadataRelativePath,
          'file',
          'movie',
          originalTitle
        )
        
        syncLogger.debug(`✅ Fetched metadata for "${originalTitle}" from ${context.serverConfig.id}`)
        return metadata

      } catch (error) {
        syncLogger.error(`Failed to extract metadata for ${originalTitle}:`, error)
        return null
      }
    }

    // Throttle through ResourceManager if available
    if (context.resourceManager) {
      return context.resourceManager.throttleHttp(doFetch)
    }
    return doFetch()
  }

  /**
   * Normalize metadata to ensure proper data types
   */
  private normalizeMetadata(metadata: Record<string, any>): Record<string, any> {
    if (!metadata || typeof metadata !== 'object') {
      syncLogger.debug('🔧 Normalizing metadata: input is null or not an object')
      return metadata
    }

    const normalized = { ...metadata }
    let hasChanges = false

    syncLogger.debug(`🔧 Normalizing metadata with ${Object.keys(metadata).length} fields`)

    // Convert release_date to Date object if it's a string
    if (normalized.release_date) {
      const originalType = typeof normalized.release_date
      const originalValue = normalized.release_date
      
      if (typeof normalized.release_date === 'string') {
        try {
          const dateObj = new Date(normalized.release_date)
          
          // Validate that the date is valid
          if (!isNaN(dateObj.getTime())) {
            normalized.release_date = dateObj
            hasChanges = true
            syncLogger.debug(`✅ Normalized release_date: "${originalValue}" (${originalType}) -> ${dateObj.toISOString()} (Date object)`)
          } else {
            syncLogger.warn(`⚠️ Invalid date string, keeping original: ${originalValue}`)
          }
        } catch (error) {
          syncLogger.warn(`⚠️ Failed to convert release_date to Date: ${originalValue} - ${error.message}`)
          // Keep original value if conversion fails
        }
      } else if (normalized.release_date instanceof Date) {
        syncLogger.debug(`✅ release_date already a Date object: ${normalized.release_date.toISOString()}`)
      } else {
        syncLogger.debug(`ℹ️ release_date is ${originalType}, no normalization needed: ${originalValue}`)
      }
    } else {
      syncLogger.debug('ℹ️ No release_date field found in metadata')
    }

    // Add other normalization rules here as needed
    // e.g., normalize runtime to number, genres to array, etc.
    
    if (normalized.runtime && typeof normalized.runtime === 'string') {
      const runtimeNum = parseInt(normalized.runtime, 10)
      if (!isNaN(runtimeNum)) {
        normalized.runtime = runtimeNum
        hasChanges = true
        syncLogger.debug(`✅ Normalized runtime: "${metadata.runtime}" -> ${runtimeNum} (number)`)
      }
    }

    if (hasChanges) {
      syncLogger.debug(`🔧 Metadata normalization completed with changes`)
    } else {
      syncLogger.debug(`🔧 Metadata normalization completed - no changes needed`)
    }

    return normalized
  }

  /**
   * Compare metadata objects for equality with proper Date object handling
   */
  private isMetadataEqual(current: Record<string, any> = {}, incoming: Record<string, any>): boolean {
    const currentKeys = Object.keys(current)
    const incomingKeys = Object.keys(incoming)

    // Check if any new keys or different values
    for (const key of incomingKeys) {
      if (!this.valuesEqual(current[key], incoming[key])) {
        syncLogger.debug(`🔍 Metadata difference found for key "${key}": ${current[key]} !== ${incoming[key]}`)
        return false
      }
    }

    return true
  }

  /**
   * Compare two values with proper handling for Date objects and other types
   */
  private valuesEqual(current: any, incoming: any): boolean {
    // Handle null/undefined cases
    if (current === null && incoming === null) return true
    if (current === undefined && incoming === undefined) return true
    if (current == null || incoming == null) return false

    // Handle Date objects - compare by time value
    if (current instanceof Date && incoming instanceof Date) {
      const result = current.getTime() === incoming.getTime()
      if (!result) {
        syncLogger.debug(`🔍 Date comparison: ${current.toISOString()} !== ${incoming.toISOString()}`)
      }
      return result
    }

    // Handle Date vs string comparison (for backwards compatibility)
    if (current instanceof Date && typeof incoming === 'string') {
      try {
        const incomingDate = new Date(incoming)
        const result = current.getTime() === incomingDate.getTime()
        if (!result) {
          syncLogger.debug(`🔍 Date vs string comparison: ${current.toISOString()} !== ${incoming}`)
        }
        return result
      } catch {
        return false
      }
    }

    if (typeof current === 'string' && incoming instanceof Date) {
      try {
        const currentDate = new Date(current)
        const result = currentDate.getTime() === incoming.getTime()
        if (!result) {
          syncLogger.debug(`🔍 String vs Date comparison: ${current} !== ${incoming.toISOString()}`)
        }
        return result
      } catch {
        return false
      }
    }

    // Handle arrays
    if (Array.isArray(current) && Array.isArray(incoming)) {
      if (current.length !== incoming.length) return false
      return current.every((item, index) => this.valuesEqual(item, incoming[index]))
    }

    // Handle objects (but not Date objects, which are handled above)
    if (typeof current === 'object' && typeof incoming === 'object' && 
        !(current instanceof Date) && !(incoming instanceof Date)) {
      const currentKeys = Object.keys(current || {})
      const incomingKeys = Object.keys(incoming || {})
      
      if (currentKeys.length !== incomingKeys.length) return false
      
      return currentKeys.every(key => this.valuesEqual(current[key], incoming[key]))
    }

    // Handle primitive types
    return current === incoming
  }

  /**
   * Check if current server should update a field using existing priority system
   * CRITICAL: Always use originalTitle (filesystem key) for fieldAvailability lookups
   */
  private shouldUpdateField(fieldPath: string, originalTitle: string, context: SyncContext): boolean {
    syncLogger.debug(`🔍 Priority check: field="${fieldPath}", originalTitle="${originalTitle}", server=${context.serverConfig.id}`)
    
    // Check if fieldAvailability exists
    if (!context.fieldAvailability) {
      syncLogger.debug(`⚠️ No fieldAvailability in context, defaulting to true for ${fieldPath}`)
      return true
    }
    
    // Check if movie exists in fieldAvailability (using originalTitle as key)
    const movieFields = context.fieldAvailability?.movies?.[originalTitle]
    if (!movieFields) {
      syncLogger.debug(`⚠️ Movie "${originalTitle}" not found in fieldAvailability, defaulting to true`)
      return true
    }
    
    // Get servers that have this field
    const serversWithField = movieFields[fieldPath] || []
    syncLogger.debug(`📊 Servers with ${fieldPath}: ${JSON.stringify(serversWithField)} (${serversWithField.length} total)`)
    
    // Check priority
    const hasHighestPriority = isCurrentServerHighestPriorityForField(
      context.fieldAvailability,
      'movies',
      originalTitle,  // ← CRITICAL: Always use originalTitle for consistency
      fieldPath,
      context.serverConfig
    )
    
    if (hasHighestPriority) {
      syncLogger.debug(`✅ Server ${context.serverConfig.id} (priority ${context.serverConfig.priority}) has highest priority for ${fieldPath}`)
    } else {
      syncLogger.debug(`❌ Server ${context.serverConfig.id} (priority ${context.serverConfig.priority}) does NOT have highest priority for ${fieldPath}`)
    }
    
    return hasHighestPriority
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
      operation: SyncOperation.Metadata,
      serverId: context.serverConfig.id,
      timestamp: new Date(),
      changes,
      errors,
      metadata
    }
  }

  /**
   * Validate metadata before processing
   */
  async validate?(entity: BaseMediaEntity, context: SyncContext): Promise<boolean> {
    if (!entity.title || entity.title.trim().length === 0) {
      return false
    }

    if (!context.serverConfig.id) {
      return false
    }

    return true
  }
}
