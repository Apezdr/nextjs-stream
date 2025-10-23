/**
 * Movie sync service - domain orchestrator for all movie sync operations
 * Demonstrates the new domain-driven architecture with strategy pattern
 */

import {
  MovieEntity,
  SyncContext,
  SyncResult,
  SyncStatus,
  MediaType,
  SyncOperation,
  SyncStrategy,
  ValidationError,
  DatabaseError,
  syncEventBus,
  validateEntityOrThrow
} from '../../core'

import {
  MovieRepository
} from '../../infrastructure'

import {
  FileServerAdapter
} from '../../core'

export class MovieSyncService {
  private repository: MovieRepository
  private fileAdapter: FileServerAdapter
  private strategies: Map<SyncOperation, SyncStrategy[]> = new Map()

  constructor(
    repository: MovieRepository,
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
   * Sync a single movie with all applicable strategies
   */
  async syncMovie(
    title: string,
    context: SyncContext,
    operations: SyncOperation[] = [
      SyncOperation.Metadata,
      SyncOperation.Assets,
      SyncOperation.Content
    ],
    originalTitle?: string  // Optional filesystem key title
  ): Promise<SyncResult[]> {
    const results: SyncResult[] = []

    syncEventBus.emitStarted(title, MediaType.Movie, context.serverConfig.id)

    try {
      // Determine the filesystem key and display title
      // When originalTitle is provided, it's the definitive filesystem key
      const effectiveOriginalTitle = originalTitle || title
      // For display title, use the originalTitle as fallback since that's what we have
      const effectiveTitle = originalTitle ? originalTitle : title
      
      let movie = await this.repository.findByOriginalTitle(effectiveOriginalTitle)
      
      // Normalize entity to ensure complete schema (handles new, existing, and partial records)
      movie = this.normalizeMovieEntity(movie, effectiveTitle, effectiveOriginalTitle, context)

      for (const operation of operations) {
        try {
          const operationResult = await this.syncMovieOperation(movie, operation, context, effectiveTitle)
          results.push(operationResult)

          // Update movie entity if changes were made
          if (operationResult.status === SyncStatus.Completed && operationResult.changes.length > 0) {
            movie = await this.repository.findByTitle(title) // Refresh from DB
          }

        } catch (error) {
          const errorResult: SyncResult = {
            status: SyncStatus.Failed,
            entityId: title,
            mediaType: MediaType.Movie,
            operation,
            serverId: context.serverConfig.id,
            timestamp: new Date(),
            changes: [],
            errors: [error instanceof Error ? error.message : String(error)]
          }

          results.push(errorResult)
          
          syncEventBus.emitError(
            title,
            MediaType.Movie,
            context.serverConfig.id,
            errorResult.errors[0],
            operation
          )
        }
      }

      syncEventBus.emitComplete(title, MediaType.Movie, context.serverConfig.id, undefined, {
        totalOperations: operations.length,
        successful: results.filter(r => r.status === SyncStatus.Completed).length,
        failed: results.filter(r => r.status === SyncStatus.Failed).length
      })

      return results

    } catch (error) {
      const errorResult: SyncResult = {
        status: SyncStatus.Failed,
        entityId: title,
        mediaType: MediaType.Movie,
        operation: SyncOperation.Metadata, // Default operation for general failures
        serverId: context.serverConfig.id,
        timestamp: new Date(),
        changes: [],
        errors: [error instanceof Error ? error.message : String(error)]
      }

      syncEventBus.emitError(
        title,
        MediaType.Movie,
        context.serverConfig.id,
        errorResult.errors[0]
      )

      return [errorResult]
    }
  }

  /**
   * Sync multiple movies efficiently
   */
  async syncMovies(
    titles: string[],
    context: SyncContext,
    concurrency: number = 5
  ): Promise<SyncResult[]> {
    const allResults: SyncResult[] = []

    // Process movies in batches to control concurrency
    for (let i = 0; i < titles.length; i += concurrency) {
      const batch = titles.slice(i, i + concurrency)
      
      const batchPromises = batch.map(title =>
        this.syncMovie(title, context).catch(error => [{
          status: SyncStatus.Failed,
          entityId: title,
          mediaType: MediaType.Movie,
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
          // This shouldn't happen due to catch above, but handle anyway
          console.error('Unexpected batch result failure:', result.reason)
        }
      })
    }

    return allResults
  }

  /**
   * Sync a single operation for a movie
   */
  private async syncMovieOperation(
    movie: MovieEntity | null,
    operation: SyncOperation,
    context: SyncContext,
    title: string
  ): Promise<SyncResult> {
    const strategies = this.strategies.get(operation) || []
    
    if (strategies.length === 0) {
      return {
        status: SyncStatus.Skipped,
        entityId: movie?.title || 'unknown',
        mediaType: MediaType.Movie,
        operation,
        serverId: context.serverConfig.id,
        timestamp: new Date(),
        changes: [],
        errors: [`No strategies available for operation: ${operation}`]
      }
    }

    // Find the first strategy that can handle this context
    const applicableStrategy = strategies.find(strategy => 
      strategy.canHandle({ ...context, operation })
    )

    if (!applicableStrategy) {
      return {
        status: SyncStatus.Skipped,
        entityId: movie?.title || 'unknown',
        mediaType: MediaType.Movie,
        operation,
        serverId: context.serverConfig.id,
        timestamp: new Date(),
        changes: [],
        errors: [`No applicable strategy found for operation: ${operation}`]
      }
    }

    // Execute the strategy with both titles in context
    const strategyContext = { 
      ...context, 
      operation,
      entityTitle: title,
      entityOriginalTitle: movie?.originalTitle || movie?.title || title
    }
    
    
    return await applicableStrategy.sync(movie, strategyContext)
  }

  /**
   * Normalize movie entity to ensure complete schema regardless of input state
   * Handles new entities, existing entities, partial records, and schema migrations
   */
  private normalizeMovieEntity(
    existingMovie: MovieEntity | null,
    title: string,
    originalTitle: string,
    context: SyncContext
  ): MovieEntity {
    const now = new Date()
    
    // If existing movie found, preserve all existing data
    if (existingMovie) {
      console.log(`🔄 Normalizing existing movie entity for: "${title}"`)
      
      // Start with existing movie data - preserve everything
      const normalizedMovie: MovieEntity = {
        ...existingMovie,
        // Update sync timestamp
        lastSynced: now,
        // Ensure core fields are current
        title,
        originalTitle
      }
      
      // Heal any critical missing fields
      this.healCriticalFields(normalizedMovie, existingMovie, context)
      
      console.log(`🔧 Entity normalized: preserved all ${Object.keys(existingMovie).length} existing fields`)
      return normalizedMovie
    }
    
    // Creating new movie - set all required legacy fields for compatibility
    console.log(`🆕 Creating new movie entity for: "${title}" (originalTitle: "${originalTitle}")`)
    
    const normalizedMovie: MovieEntity = {
      // Core identification
      title,
      originalTitle,
      
      // REQUIRED: Legacy discovery fields (for "recently added" queries, type filtering, etc.)
      type: 'movie',
      createdAt: now,
      initialDiscoveryDate: now,
      initialDiscoveryServer: context.serverConfig.id,
      
      // Sync tracking
      lastSynced: now,
      
      // Content metadata (empty object, will be populated by strategies)
      metadata: {},
      
      // Source tracking for field-level ownership
      titleSource: context.serverConfig.id,
      originalTitleSource: context.serverConfig.id,
      
      // All other fields will be populated by strategies as needed
      // No need to initialize them as undefined - strategies will set them when data is available
    }
    
    console.log(`🔍 TRACE: New entity created with ${Object.keys(normalizedMovie).length} fields:`, Object.keys(normalizedMovie).sort())
    
    return normalizedMovie
  }
  
  /**
   * Heal critical fields that must never be null/undefined for system stability
   */
  private healCriticalFields(
    normalizedMovie: MovieEntity,
    existingMovie: MovieEntity,
    context: SyncContext
  ): void {
    const healedFields: string[] = []
    
    // Ensure legacy discovery fields exist (for backward compatibility)
    if (!normalizedMovie.type) {
      normalizedMovie.type = 'movie'
      healedFields.push('type')
    }
    
    if (!normalizedMovie.createdAt) {
      normalizedMovie.createdAt = new Date()
      healedFields.push('createdAt')
    }
    
    if (!normalizedMovie.initialDiscoveryDate) {
      normalizedMovie.initialDiscoveryDate = normalizedMovie.createdAt || new Date()
      healedFields.push('initialDiscoveryDate')
    }
    
    if (!normalizedMovie.initialDiscoveryServer) {
      normalizedMovie.initialDiscoveryServer = context.serverConfig.id
      healedFields.push('initialDiscoveryServer')
    }
    
    // Ensure source tracking for critical fields
    if (!normalizedMovie.titleSource) {
      normalizedMovie.titleSource = context.serverConfig.id
      healedFields.push('titleSource')
    }
    
    if (!normalizedMovie.originalTitleSource) {
      normalizedMovie.originalTitleSource = context.serverConfig.id
      healedFields.push('originalTitleSource')
    }
    
    // Ensure metadata is always an object
    if (!normalizedMovie.metadata || typeof normalizedMovie.metadata !== 'object') {
      normalizedMovie.metadata = {}
      healedFields.push('metadata')
    }
    
    if (healedFields.length > 0) {
      console.log(`🏥 Healed critical fields: ${healedFields.join(', ')}`)
    }
  }

  /**
   * Get movie sync statistics
   */
  async getSyncStats(): Promise<{
    totalMovies: number
    needingSync: number
    recentlyUpdated: number
    byOperation: Record<SyncOperation, number>
  }> {
    try {
      const [
        totalMovies,
        recentlyUpdated,
        missingVideo,
        missingPosters,
        missingBackdrops
      ] = await Promise.all([
        this.repository.count(),
        this.repository.findModifiedSince(new Date(Date.now() - 24 * 60 * 60 * 1000)).then(movies => movies.length),
        this.repository.findMissingAssets('poster').then(movies => movies.length),
        this.repository.findMissingAssets('backdrop').then(movies => movies.length),
        this.repository.findWithVideo().then(movies => totalMovies - movies.length)
      ])

      const needingSync = missingVideo + missingPosters + missingBackdrops

      return {
        totalMovies,
        needingSync,
        recentlyUpdated,
        byOperation: {
          [SyncOperation.Metadata]: 0, // Would need to calculate based on missing metadata
          [SyncOperation.Assets]: missingPosters + missingBackdrops,
          [SyncOperation.Content]: missingVideo,
          [SyncOperation.Validation]: 0
        }
      }
    } catch (error) {
      throw new DatabaseError(`Failed to get movie sync statistics: ${error}`)
    }
  }

  /**
   * Find movies that need sync based on criteria
   */
  async findMoviesNeedingSync(criteria: {
    missingAssets?: boolean
    missingVideo?: boolean
    olderThan?: Date
    limit?: number
  }): Promise<MovieEntity[]> {
    const conditions: Promise<MovieEntity[]>[] = []

    if (criteria.missingVideo) {
      conditions.push(
        this.repository.findAll({
          $or: [
            { videoURL: { $exists: false } },
            { videoURL: null },
            { videoURL: '' }
          ]
        })
      )
    }

    if (criteria.missingAssets) {
      conditions.push(
        this.repository.findMissingAssets('poster'),
        this.repository.findMissingAssets('backdrop')
      )
    }

    if (criteria.olderThan) {
      conditions.push(
        this.repository.findAll({
          $or: [
            { lastSynced: { $lt: criteria.olderThan } },
            { lastSynced: { $exists: false } }
          ]
        })
      )
    }

    if (conditions.length === 0) {
      return []
    }

    // Combine results and deduplicate
    const allResults = await Promise.all(conditions)
    const combined = allResults.flat()
    const unique = Array.from(
      new Map(combined.map(movie => [movie.title, movie])).values()
    )

    // Apply limit if specified
    if (criteria.limit && unique.length > criteria.limit) {
      return unique.slice(0, criteria.limit)
    }

    return unique
  }

  /**
   * Validate movie data
   */
  async validateMovie(movie: MovieEntity): Promise<boolean> {
    try {
      validateEntityOrThrow(movie, MediaType.Movie)
      
      // Additional movie-specific validation
      if (movie.videoURL) {
        const availability = await this.fileAdapter.validateAvailability([movie.videoURL])
        if (availability.unavailable.includes(movie.videoURL)) {
          throw new ValidationError(
            `Video URL is not accessible: ${movie.videoURL}`,
            movie.title,
            MediaType.Movie
          )
        }
      }

      return true
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error
      }
      
      throw new ValidationError(
        `Movie validation failed: ${error}`,
        movie.title,
        MediaType.Movie
      )
    }
  }

  /**
   * Get repository reference for advanced operations
   */
  getRepository(): MovieRepository {
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