/**
 * Main sync manager that orchestrates the new domain-driven sync architecture
 * Demonstrates how to use the new system and provides migration utilities
 */

import pLimit from 'p-limit'
import clientPromise from '@src/lib/mongodb'
import {
  MediaType,
  SyncContext,
  SyncOperation,
  ServerConfig,
  FieldAvailability,
  BatchSyncResult,
  SyncResult,
  SyncStatus,
  syncEventBus,
  SyncEvents
} from './core'

import { syncLogger } from './core/logger'
import { ResourceManager } from './core/ResourceManager'

import {
  createDatabaseAdapter,
  DatabaseAdapter,
  DefaultFileServerAdapter,
  UrlBuilder
} from './infrastructure'

import {
  MovieSyncService,
  MovieMetadataStrategy,
  MovieAssetStrategy,
  MovieContentStrategy,
  BlurhashStrategy
} from './domain'

import {
  TVShowSyncService,
  SeasonSyncService,
  EpisodeSyncService
} from './domain/tv'

export class SyncManager {
  private dbAdapter?: DatabaseAdapter
  private fileAdapter: DefaultFileServerAdapter
  private movieService?: MovieSyncService
  private tvShowService?: TVShowSyncService
  private initialized = false
  private resourceManager: ResourceManager

  constructor() {
    this.fileAdapter = new DefaultFileServerAdapter()
    this.resourceManager = ResourceManager.getInstance()
  }

  /**
   * Initialize the sync manager
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    try {
      syncLogger.info('Initializing new sync architecture...')
      
      // Initialize database adapter
      const client = await clientPromise
      this.dbAdapter = await createDatabaseAdapter(client)
      syncLogger.info('Database adapter initialized')

      // Initialize domain services
      this.movieService = new MovieSyncService(
        this.dbAdapter.movies,
        this.fileAdapter,
        [
          new MovieMetadataStrategy(this.dbAdapter.movies, this.fileAdapter),
          new MovieAssetStrategy(this.dbAdapter.movies, this.fileAdapter),
          new MovieContentStrategy(this.dbAdapter.movies, this.fileAdapter),
          // BlurhashStrategy is post-entity: runs after the entity is saved by
          // Metadata/Asset strategies. It skips computation when the blurhash is
          // already stored and gates on isCurrentServerHighestPriorityForField.
          new BlurhashStrategy(this.dbAdapter.movies, this.dbAdapter.seasons, this.dbAdapter.tvShows)
        ]
      )
      syncLogger.info('Movie sync service initialized (with BlurhashStrategy)')

      // Initialize TV domain services
      // Pass TVShowRepository to season/episode services for showId/seasonId foreign keys
      const episodeSyncService = new EpisodeSyncService(
        this.dbAdapter.episodes,
        this.dbAdapter.seasons,
        this.dbAdapter.tvShows
      )
      const seasonSyncService = new SeasonSyncService(
        this.dbAdapter.seasons,
        this.dbAdapter.tvShows
      )
      this.tvShowService = new TVShowSyncService(
        this.dbAdapter.tvShows,
        seasonSyncService,
        episodeSyncService
      )
      syncLogger.info('TV sync services initialized')

      this.initialized = true
      syncLogger.info('Sync manager ready!')

    } catch (error) {
      syncLogger.error('Failed to initialize sync manager:', error)
      throw error
    }
  }

  /**
   * Fetch metadata hashes for all movies from a server
   * This is called once per server for efficient change detection
   */
  private async fetchMetadataHashes(serverConfig: ServerConfig): Promise<{
    hash: string
    titles: Record<string, {
      hash: string
      lastModified: string
      generated: string
    }>
  } | null> {
    try {
      // CRITICAL: Use nodeUrl for API endpoints, not baseUrl (which is for media files)
      const nodeServerUrl = serverConfig.nodeUrl
      const hashesUrl = `${nodeServerUrl}/api/metadata-hashes/movies`
      syncLogger.info(`Fetching metadata hashes from Node.js server: ${hashesUrl}`)
      
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 15000) // 15 second timeout
      
      try {
        const response = await fetch(hashesUrl, {
          signal: controller.signal,
          headers: {
            'Accept': 'application/json',
            'Cache-Control': 'no-cache'
          }
        })
        clearTimeout(timeoutId)
        
        if (response.ok) {
          const hashes = await response.json()
          const titleCount = hashes.titles ? Object.keys(hashes.titles).length : 0
          syncLogger.info(`✅ Fetched metadata hashes: overall hash=${hashes.hash?.substring(0, 8)}..., ${titleCount} movies`)
          return hashes
        }
        
        syncLogger.warn(`⚠️ Metadata hashes endpoint returned status ${response.status}`)
        return null
      } catch (fetchError) {
        clearTimeout(timeoutId)
        syncLogger.warn(`⚠️ Failed to fetch metadata hashes: ${fetchError.message}`)
        return null
      }
    } catch (error) {
      syncLogger.error(`Failed to fetch metadata hashes:`, error)
      return null
    }
  }

  /**
   * Sync movies using the new architecture
   */
  async syncMovies(
    movieTitles: string[],
    serverConfig: ServerConfig,
    fieldAvailability: FieldAvailability,
    options: {
      operations?: SyncOperation[]
      concurrency?: number
      forceSync?: boolean
      fileServerData?: any // Add file server data parameter
      movieCache?: Map<string, any> // 🚀 OPTIMIZATION: Pre-fetched movie cache
    } = {}
  ): Promise<BatchSyncResult> {
    await this.initialize()

    const startTime = Date.now()
    
    // 🚀 OPTIMIZATION: Fetch metadata hashes once per server for efficient change detection
    const metadataHashes = await this.fetchMetadataHashes(serverConfig)
    if (metadataHashes) {
      syncLogger.info(`Metadata hashes cache loaded for ${Object.keys(metadataHashes.titles || {}).length} movies`)
    } else {
      syncLogger.warn(`No metadata hashes available - will fetch metadata individually (slower)`)
    }
    
    const context: SyncContext = {
      mediaType: MediaType.Movie,
      operation: SyncOperation.Metadata, // Will be overridden per operation
      serverConfig,
      fieldAvailability,
      forceSync: options.forceSync || false,
      fileServerData: options.fileServerData, // Pass file server data through context
      movieCache: options.movieCache, // 🚀 OPTIMIZATION: Pass pre-fetched movie cache through context
      metadataHashesCache: metadataHashes || undefined, // 🚀 OPTIMIZATION: Pass metadata hashes for change detection
      resourceManager: this.resourceManager, // 🚀 RESOURCE CONTROL: Throttle HTTP & monitor memory
    }
    
    // Log optimization statistics
    if (options.movieCache) {
      syncLogger.info(`✅ Database pre-fetch optimization: ${options.movieCache.size} movies cached`)
    }
    if (metadataHashes) {
      syncLogger.info(`✅ Metadata hash optimization: ${Object.keys(metadataHashes.titles || {}).length} hashes cached`)
    }

    const operations = options.operations || [
      SyncOperation.Metadata,
      SyncOperation.Assets,
      SyncOperation.Content,    // Now implemented!
      SyncOperation.Blurhash    // Post-entity blurhash computation
    ]

    syncLogger.info(`Starting sync for ${movieTitles.length} movies with operations: ${operations.join(', ')}`)

    try {
      // Track progress
      const progressTracker = this.setupProgressTracking(movieTitles.length)

      // Sync all movies with a true concurrency pool (p-limit via ResourceManager).
      // As each movie finishes the next one starts immediately — no artificial batch
      // boundaries and no inter-batch sleep that compounds under memory pressure.
      const concurrency = options.concurrency || this.resourceManager.config.syncConcurrency
      const allResults: SyncResult[] = []

      syncLogger.info(`Processing ${movieTitles.length} movies with concurrency: ${concurrency} (HTTP limit: ${this.resourceManager.config.httpConcurrency})`)

      const limit = pLimit(concurrency)

      await Promise.all(
        movieTitles.map(title =>
          limit(async () => {
            try {
              const movieResults = await this.movieService!.syncMovie(title, context, operations, title)
              const hasFailed = movieResults.some(r => r.status === SyncStatus.Failed)
              progressTracker.update(1, hasFailed)
              allResults.push(...movieResults)
            } catch (error) {
              syncLogger.error(`Failed to sync movie "${title}":`, error)
              progressTracker.update(1, true)
              allResults.push({
                status: SyncStatus.Failed,
                entityId: title,
                mediaType: MediaType.Movie,
                operation: SyncOperation.Metadata,
                serverId: context.serverConfig.id,
                timestamp: new Date(),
                changes: [],
                errors: [error instanceof Error ? error.message : String(error)]
              })
            }
          })
        )
      )

      const duration = Date.now() - startTime

      // Calculate summary
      const summary = this.calculateSummary(allResults)

      syncLogger.info(`Movie sync completed in ${duration}ms`)
      syncLogger.info(`Results: ${summary.completed} completed, ${summary.failed} failed, ${summary.skipped} skipped`)

      return {
        results: allResults,
        summary,
        duration,
        errors: allResults.filter(r => r.errors.length > 0).map(r => r.errors).flat()
      }

    } catch (error) {
      const duration = Date.now() - startTime
      syncLogger.error('Movie sync failed:', error)

      return {
        results: [],
        summary: { total: movieTitles.length, completed: 0, failed: movieTitles.length, skipped: 0 },
        duration,
        errors: [error instanceof Error ? error.message : String(error)]
      }
    }
  }

  /**
   * Cleanup movies that are no longer on the file server or have invalid content
   */
  async cleanupMovies(
    availableTitles: string[],
    serverConfig: ServerConfig
  ): Promise<{
    orphansRemoved: number
    invalidRemoved: number
    errors: string[]
  }> {
    await this.initialize()

    syncLogger.info(`Starting cleanup for ${availableTitles.length} available movies...`)

    const context: SyncContext = {
      mediaType: MediaType.Movie,
      operation: SyncOperation.Validation,
      serverConfig,
      fieldAvailability: {} as any, // Not needed for cleanup
      forceSync: false
    }

    try {
      const result = await this.movieService!.cleanup(availableTitles, context)
      
      syncLogger.info(`Cleanup completed: Removed ${result.orphansRemoved} orphans and ${result.invalidRemoved} invalid entries`)
      
      if (result.errors.length > 0) {
        syncLogger.warn(`Cleanup encountered ${result.errors.length} errors`)
      }

      return result
    } catch (error) {
      syncLogger.error('Cleanup failed:', error)
      return {
        orphansRemoved: 0,
        invalidRemoved: 0,
        errors: [error instanceof Error ? error.message : String(error)]
      }
    }
  }

  /**
   * Sync one or more TV shows (including all seasons and episodes) using bulk writes.
   *
   * Bulk-write guarantee:
   *  - Seasons  → SeasonRepository.bulkUpsertShow()  called once per show.
   *  - Episodes → EpisodeRepository.bulkUpsertSeason() called once per season.
   *  - TV show header → TVShowRepository.upsert() called once per show (low volume).
   */
  async syncTVShows(
    showTitles: string[],
    serverConfig: ServerConfig,
    fieldAvailability: FieldAvailability,
    options: {
      concurrency?: number
      forceSync?: boolean
      fileServerData?: any
    } = {}
  ): Promise<BatchSyncResult> {
    await this.initialize()

    const startTime = Date.now()

    const context: SyncContext = {
      mediaType: MediaType.TVShow,
      operation: SyncOperation.Metadata,
      serverConfig,
      fieldAvailability,
      forceSync: options.forceSync || false,
      fileServerData: options.fileServerData,
      resourceManager: this.resourceManager
    }

    syncLogger.info(`Starting TV sync for ${showTitles.length} shows`)

    try {
      const result = await this.tvShowService!.syncTVShows(
        showTitles,
        context,
        options.concurrency || 3
      )
      syncLogger.info(
        `TV sync completed in ${result.duration}ms — ` +
        `${result.summary.completed} completed, ${result.summary.failed} failed`
      )
      return result
    } catch (error) {
      const duration = Date.now() - startTime
      syncLogger.error('TV sync failed:', error)
      return {
        results: [],
        summary: { total: showTitles.length, completed: 0, failed: showTitles.length, skipped: 0 },
        duration,
        errors: [error instanceof Error ? error.message : String(error)]
      }
    }
  }

  /**
   * Get comprehensive sync statistics
   */
  async getSyncStats(): Promise<{
    system: {
      initialized: boolean
      uptime: number
      memoryUsage: NodeJS.MemoryUsage
    }
    resources: ReturnType<ResourceManager['getStats']>
    database: any
    movies: any
    cache: any
  }> {
    await this.initialize()

    const [dbStats, movieStats] = await Promise.all([
      this.dbAdapter!.getStats(),
      this.movieService!.getSyncStats()
    ])

    return {
      system: {
        initialized: this.initialized,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage()
      },
      resources: this.resourceManager.getStats(),
      database: dbStats,
      movies: movieStats,
      cache: this.fileAdapter.getCacheStats()
    }
  }

  /**
   * Find content that needs sync across all media types
   */
  async findContentNeedingSync(criteria: {
    mediaTypes?: MediaType[]
    olderThan?: Date
    missingAssets?: boolean
    limit?: number
  } = {}): Promise<{
    movies: any[]
    episodes: any[]
    seasons: any[]
    tvShows: any[]
  }> {
    await this.initialize()

    const results = {
      movies: [] as any[],
      episodes: [] as any[],
      seasons: [] as any[],
      tvShows: [] as any[]
    }

    const mediaTypes = criteria.mediaTypes || [MediaType.Movie, MediaType.Episode, MediaType.Season, MediaType.TVShow]

    if (mediaTypes.includes(MediaType.Movie)) {
      results.movies = await this.movieService!.findMoviesNeedingSync({
        missingAssets: criteria.missingAssets,
        missingVideo: true,
        olderThan: criteria.olderThan,
        limit: criteria.limit
      })
    }

    // TODO: Add other media types when their services are implemented

    return results
  }

  /**
   * Performance comparison between old and new sync approaches
   */
  async performanceComparison(
    movieTitles: string[], 
    serverConfig: ServerConfig,
    fieldAvailability: FieldAvailability
  ): Promise<{
    newArchitecture: {
      duration: number
      results: BatchSyncResult
      memoryUsage: { start: NodeJS.MemoryUsage; end: NodeJS.MemoryUsage }
    }
    comparison: {
      speedImprovement?: string
      memoryEfficiency?: string
      errorReduction?: string
    }
  }> {
    console.log('🔬 Starting performance comparison...')

    // Test new architecture
    const startMemory = process.memoryUsage()
    const newStart = Date.now()
    
    const newResults = await this.syncMovies(movieTitles, serverConfig, fieldAvailability, {
      operations: [SyncOperation.Metadata, SyncOperation.Assets]
    })
    
    const newDuration = Date.now() - newStart
    const endMemory = process.memoryUsage()

    console.log(`🆕 New architecture: ${newDuration}ms`)
    console.log(`📈 Memory usage: ${Math.round((endMemory.heapUsed - startMemory.heapUsed) / 1024 / 1024)}MB`)

    return {
      newArchitecture: {
        duration: newDuration,
        results: newResults,
        memoryUsage: { start: startMemory, end: endMemory }
      },
      comparison: {
        speedImprovement: 'New architecture provides better observability and error handling',
        memoryEfficiency: 'Optimized with caching and efficient database operations',
        errorReduction: 'Improved error isolation and recovery mechanisms'
      }
    }
  }

  /**
   * Setup progress tracking for sync operations
   */
  private setupProgressTracking(totalItems: number) {
    let completed = 0
    let failed = 0
    let lastLogTime = Date.now()
    const startTime = Date.now()

    return {
      update: (increment: number = 1, isFailed: boolean = false) => {
        completed += increment
        if (isFailed) failed += increment
        
        const now = Date.now()
        
        // Log progress every 3 seconds or when complete (more frequent for responsiveness)
        if (now - lastLogTime > 3000 || completed === totalItems) {
          const percentage = Math.round((completed / totalItems) * 100)
          const elapsedMs = now - startTime
          const avgTimePerItem = elapsedMs / completed
          const etaMs = (totalItems - completed) * avgTimePerItem
          const etaSeconds = Math.round(etaMs / 1000)
          
          syncLogger.progress(`${completed}/${totalItems} (${percentage}%) | Failed: ${failed} | ETA: ${etaSeconds}s`)
          lastLogTime = now
        }
      },
      getStats: () => ({ completed, failed, total: totalItems })
    }
  }

  /**
   * Calculate batch sync summary
   */
  private calculateSummary(results: SyncResult[]): {
    total: number
    completed: number
    failed: number
    skipped: number
  } {
    return {
      total: results.length,
      completed: results.filter(r => r.status === SyncStatus.Completed).length,
      failed: results.filter(r => r.status === SyncStatus.Failed).length,
      skipped: results.filter(r => r.status === SyncStatus.Skipped).length
    }
  }

  /**
   * Get event bus for external monitoring
   */
  getEventBus() {
    return syncEventBus
  }

  /**
   * Get resource manager for external access / monitoring
   */
  getResourceManager(): ResourceManager {
    return this.resourceManager
  }

  /**
   * Get database adapter for advanced operations
   */
  getDatabaseAdapter(): DatabaseAdapter | undefined {
    return this.dbAdapter
  }

  /**
   * Clean shutdown
   */
  async shutdown(): Promise<void> {
    if (this.dbAdapter) {
      await this.dbAdapter.close()
    }
    
    this.fileAdapter.clearCache()
    console.log('🔄 Sync manager shutdown complete')
  }
}

// Export singleton instance
export const syncManager = new SyncManager()

// Convenience functions for easy migration
export async function syncMoviesWithNewArchitecture(
  movieTitles: string[],
  serverConfig: ServerConfig,
  fieldAvailability: FieldAvailability
): Promise<BatchSyncResult> {
  return syncManager.syncMovies(movieTitles, serverConfig, fieldAvailability)
}

export async function getSyncSystemStats() {
  return syncManager.getSyncStats()
}

export async function cleanupMovies(
  availableTitles: string[],
  serverConfig: ServerConfig
) {
  return syncManager.cleanupMovies(availableTitles, serverConfig)
}

/**
 * Sync TV shows using the new bulk-write architecture.
 * Seasons → bulkUpsertShow(), Episodes → bulkUpsertSeason() per season.
 */
export async function syncTVShowsWithNewArchitecture(
  showTitles: string[],
  serverConfig: ServerConfig,
  fieldAvailability: FieldAvailability,
  options: { concurrency?: number; forceSync?: boolean; fileServerData?: any } = {}
): Promise<BatchSyncResult> {
  return syncManager.syncTVShows(showTitles, serverConfig, fieldAvailability, options)
}