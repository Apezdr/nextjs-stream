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
    
    console.log(`🎬 MovieMetadataStrategy starting for: "${title}"`)
    
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
          console.log(`💾 Cache HIT for "${originalTitle}"`)
        } else {
          console.log(`🔍 Cache MISS for "${originalTitle}", querying database...`)
          movie = await this.repository.findByOriginalTitle(originalTitle)
        }
      }

      const changes: string[] = []
      
      // 🚀 CRITICAL FIX: Check priority FIRST before doing any work
      // This prevents lower-priority servers from wasting API calls
      const canUpdateMetadata = this.shouldUpdateField(getFieldPath('metadata'), originalTitle, context)
      
      if (!canUpdateMetadata) {
        console.log(`⏭️ Server ${context.serverConfig.id} (priority ${context.serverConfig.priority}) does not have priority for metadata, skipping`)
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
      
      console.log(`✅ Server ${context.serverConfig.id} (priority ${context.serverConfig.priority}) has priority for metadata, proceeding`)
      
      // Check if we have metadata hash from context for change detection
      const metadataHashInfo = context.metadataHashesCache?.titles?.[originalTitle]
      const currentMetadataHash = movie?.metadataHash
      
      // If we have both hashes and they match, skip metadata fetch (optimization)
      if (metadataHashInfo?.hash && currentMetadataHash && metadataHashInfo.hash === currentMetadataHash) {
        console.log(`📝 Metadata hash unchanged for "${originalTitle}" (${metadataHashInfo.hash}), skipping fetch`)
        
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
        console.log(`🔄 Metadata hash changed for "${originalTitle}": ${currentMetadataHash || 'none'} → ${metadataHashInfo.hash}`)
      }
      
      let metadata = await this.extractMetadata(originalTitle, context)

      // If metadata extraction failed, create basic metadata
      if (!metadata) {
        console.log(`📝 Metadata extraction failed for "${title}", creating basic metadata`)
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
          console.log(`📊 Storing metadata hash: ${metadata._metadataHash}`)
        }
        
        if (needsVersionUpgrade && metadataChanged) {
          changes.push(`Updated movie metadata (schema migration: ${movie?.syncVersion || 'none'} → ${this.currentVersion})`)
          console.log(`🔄 Schema migration with changes: "${originalTitle}" ${movie?.syncVersion || 'none'} → ${this.currentVersion}`)
        } else if (needsVersionUpgrade && !metadataChanged) {
          changes.push(`Schema version updated (${movie?.syncVersion || 'none'} → ${this.currentVersion})`)
          console.log(`📋 Schema version updated (no data changes): "${originalTitle}" ${movie?.syncVersion || 'none'} → ${this.currentVersion}`)
        } else if (!needsVersionUpgrade && metadataChanged) {
          changes.push('Updated movie metadata')
          console.log(`🔄 Metadata changed for: "${originalTitle}"`)
        } else {
          // This case should never happen (both conditions false inside the parent if statement)
          console.log(`⚠️ Unexpected condition in metadata update for: "${originalTitle}"`)
        }
        
        // Log Date objects being saved for debugging
        if (normalizedMetadata.release_date instanceof Date) {
          console.log(`📅 Saving release_date as Date object: ${normalizedMetadata.release_date.toISOString()}`)
        } else if (normalizedMetadata.release_date) {
          console.log(`📅 Saving release_date as ${typeof normalizedMetadata.release_date}: ${normalizedMetadata.release_date}`)
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
        console.log(`📝 Title from metadata: "${metadata.title}"`)
      }

      // originalTitle should always be set as it's the filesystem key, but only update if changed
      if (movie?.originalTitle !== originalTitle) {
        console.log(`🔄 OriginalTitle change detected: "${movie?.originalTitle}" → "${originalTitle}"`)
        movieToSave.originalTitle = originalTitle
        movieToSave.originalTitleSource = context.serverConfig.id
        changes.push('Updated originalTitle')
      }

      // Only record a change if we actually made changes
      const hasActualChanges = changes.length > 0;
      
      // Use upsert operation to either create or update
      await this.repository.upsert(movieToSave)
      
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
   */
  private async extractMetadata(originalTitle: string, context: SyncContext): Promise<Record<string, any> | null> {
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
      
      console.log(`✅ Fetched metadata for "${originalTitle}" from ${context.serverConfig.id}`)
      return metadata

    } catch (error) {
      console.error(`Failed to extract metadata for ${originalTitle}:`, error)
      return null
    }
  }

  /**
   * Normalize metadata to ensure proper data types
   */
  private normalizeMetadata(metadata: Record<string, any>): Record<string, any> {
    if (!metadata || typeof metadata !== 'object') {
      console.log('🔧 Normalizing metadata: input is null or not an object')
      return metadata
    }

    const normalized = { ...metadata }
    let hasChanges = false

    console.log(`🔧 Normalizing metadata with ${Object.keys(metadata).length} fields`)

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
            console.log(`✅ Normalized release_date: "${originalValue}" (${originalType}) -> ${dateObj.toISOString()} (Date object)`)
          } else {
            console.warn(`⚠️ Invalid date string, keeping original: ${originalValue}`)
          }
        } catch (error) {
          console.warn(`⚠️ Failed to convert release_date to Date: ${originalValue} - ${error.message}`)
          // Keep original value if conversion fails
        }
      } else if (normalized.release_date instanceof Date) {
        console.log(`✅ release_date already a Date object: ${normalized.release_date.toISOString()}`)
      } else {
        console.log(`ℹ️ release_date is ${originalType}, no normalization needed: ${originalValue}`)
      }
    } else {
      console.log('ℹ️ No release_date field found in metadata')
    }

    // Add other normalization rules here as needed
    // e.g., normalize runtime to number, genres to array, etc.
    
    if (normalized.runtime && typeof normalized.runtime === 'string') {
      const runtimeNum = parseInt(normalized.runtime, 10)
      if (!isNaN(runtimeNum)) {
        normalized.runtime = runtimeNum
        hasChanges = true
        console.log(`✅ Normalized runtime: "${metadata.runtime}" -> ${runtimeNum} (number)`)
      }
    }

    if (hasChanges) {
      console.log(`🔧 Metadata normalization completed with changes`)
    } else {
      console.log(`🔧 Metadata normalization completed - no changes needed`)
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
        console.log(`🔍 Metadata difference found for key "${key}": ${current[key]} !== ${incoming[key]}`)
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
        console.log(`🔍 Date comparison: ${current.toISOString()} !== ${incoming.toISOString()}`)
      }
      return result
    }

    // Handle Date vs string comparison (for backwards compatibility)
    if (current instanceof Date && typeof incoming === 'string') {
      try {
        const incomingDate = new Date(incoming)
        const result = current.getTime() === incomingDate.getTime()
        if (!result) {
          console.log(`🔍 Date vs string comparison: ${current.toISOString()} !== ${incoming}`)
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
          console.log(`🔍 String vs Date comparison: ${current} !== ${incoming.toISOString()}`)
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
