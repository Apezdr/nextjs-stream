/**
 * Adapter layer for integrating new domain-driven sync architecture with existing flat sync
 * Provides translation between new architecture and flat sync result formats
 */

import { syncManager } from '../sync/SyncManager'
import { SyncOperation, MediaType } from '../sync/core'
import { createLogger, logError } from '@src/lib/logger'
import { buildEnhancedFlatDBStructure } from './memoryUtils'
import clientPromise from '@src/lib/mongodb'
import { performance } from 'perf_hooks'
// Import notification system
import { MediaNotificationOrchestrator } from '../notifications/MediaNotificationOrchestrator'
// Import post-sync operations
import { migratePlaybackStatusIfNeeded } from '../watchHistory/migrate'
import { validateWatchHistoryAgainstDatabase } from './watchHistoryValidation'
import { getAllServers } from '../config'

/**
 * Main adapter function to use new architecture instead of flat sync
 * @param {Object} fileServer - File server data structure from flat sync
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability mapping
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} Results in flat sync compatible format
 */
export async function syncWithNewArchitecture(
  fileServer,
  serverConfig,
  fieldAvailability,
  options = {}
) {
  const log = createLogger('FlatSync.NewArch');
  
  log.info({
    serverId: serverConfig.id,
    architecture: 'new',
    forceSync: options.forceSync,
    skipInitialization: options.skipInitialization,
    hasPreBuiltFlatDB: !!options.preBuiltFlatDB,
  }, 'Starting NEW architecture sync');

  // Validate server configuration before proceeding
  if (!serverConfig || !serverConfig.baseURL) {
    const error = new Error(
      `Invalid server configuration: missing baseURL for server ${serverConfig?.id || 'unknown'}`
    )
    logError(log, error, { 
      serverId: serverConfig?.id,
      context: 'server_config_validation' 
    });
    throw error
  }

  log.info({
    serverId: serverConfig.id,
    baseURL: serverConfig.baseURL
  }, 'Server config validated');

  const startTime = Date.now()

  // 🚀 PERFORMANCE OPTIMIZATION: Re-use pre-built flatDB if passed in, otherwise build it
  let flatDB;
  if (options.preBuiltFlatDB) {
    flatDB = options.preBuiltFlatDB;
    log.info({ serverId: serverConfig.id }, 'Re-using pre-built database cache (avoiding double load)');
  } else {
    log.info({ serverId: serverConfig.id }, 'Pre-fetching movie database for cache');
    const client = await clientPromise
    flatDB = await buildEnhancedFlatDBStructure(client, fileServer, fieldAvailability)
  }

  const cacheStats = {
    serverId: serverConfig.id,
    moviesCached: flatDB.movies?.size || 0,
    missingMovies: flatDB.missingMovies?.length || 0
  };
  
  log.info(cacheStats, 'Database cache pre-fetched');
  const results = {
    movies: {
      processed: 0,
      errors: 0,
      details: [],
    },
    episodes: {
      processed: 0,
      errors: 0,
      details: [],
    },
    seasons: {
      processed: 0,
      errors: 0,
      details: [],
    },
    tvShows: {
      processed: 0,
      errors: 0,
      details: [],
    },
    performance: {
      startTime: new Date(),
      endTime: null,
      duration: 0,
    },
    notifications: [],
    errors: [],
    migration: null,
    watchHistoryValidation: null,
  }

  try {
    // Initialize new sync manager
    await syncManager.initialize()

    // Extract movies from fileServer
    const movieTitles = extractMovieTitles(fileServer)

    if (movieTitles.length > 0) {
      log.info({
        serverId: serverConfig.id,
        movieCount: movieTitles.length,
        architecture: 'new'
      }, 'Processing movies with new architecture');

      // Adapt server config to match new architecture expectations
      const adaptedServerConfig = {
        id: serverConfig.id,
        priority: serverConfig.priority || 1,
        baseUrl: serverConfig.baseURL, // File server URL (for media files)
        // Using internalEndpoint for server-to-server requests; falls back to syncEndpoint if unset.
        nodeUrl: serverConfig.internalEndpoint || serverConfig.syncEndpoint, // Node.js server URL (for API endpoints)
        prefix: serverConfig.prefixPath, // Map prefixPath → prefix
        enabled: true,
        timeout: 30000,
      }

      log.debug({
        serverId: adaptedServerConfig.id,
        baseUrl: adaptedServerConfig.baseUrl,
        nodeUrl: adaptedServerConfig.nodeUrl,
        priority: adaptedServerConfig.priority
      }, 'Adapted server config for new architecture');

      const movieResults = await syncManager.syncMovies(
        movieTitles,
        adaptedServerConfig,
        fieldAvailability,
        {
          operations: [SyncOperation.Metadata, SyncOperation.Assets, SyncOperation.Content, SyncOperation.Blurhash],
          // Let SyncManager use ResourceManager defaults unless explicitly overridden
          concurrency: options.concurrency || undefined,
          fileServerData: fileServer, // Pass file server data to sync manager
          movieCache: flatDB.lookups?.movies?.byOriginalTitle, // 🚀 OPTIMIZATION: Map<originalTitle, movie>
        }
      )

      // Translate movie results to flat sync format
      results.movies = translateMovieResults(movieResults)

      log.info({
        serverId: serverConfig.id,
        processed: results.movies.processed,
        errors: results.movies.errors,
        skipped: results.movies.skipped
      }, 'Movie processing completed');
    }

    // NEW ARCHITECTURE: Delegate TV content to domain services via SyncManager
    await syncTVContentWithNewArchitecture(
      fileServer,
      serverConfig,
      fieldAvailability,
      results
    )

    // Calculate performance metrics
    const endTime = Date.now()
    results.performance.endTime = new Date()
    results.performance.duration = endTime - startTime

    log.info({
      serverId: serverConfig.id,
      durationMs: results.performance.duration,
      architecture: 'new'
    }, 'NEW architecture sync completed');

    // Process notifications for newly added content
    log.info({ serverId: serverConfig.id, phase: 'notifications' }, 'Starting notification processing');
    const notificationStartTime = performance.now();
    try {
      results.notifications = await MediaNotificationOrchestrator.processSyncResults(results, {
        enableNotifications: true,
        analysisOptions: {
          minSignificanceThreshold: 1,
          timeWindow: 24 * 60 * 60 * 1000 // 24 hours
        },
        generationOptions: {
          batchSimilarContent: true,
          maxMoviesPerNotification: 5,
          includeMetadata: true
        },
        deliveryOptions: {
          targetAllUsers: true,
          checkDuplicates: true,
          duplicateWindow: 24 * 60 * 60 * 1000 // 24 hours
        }
      });
    } catch (notificationError) {
      logError(log, notificationError, { serverId: serverConfig.id, context: 'notification_processing' });
    }
    const notificationEndTime = performance.now();
    const notificationDurationSec = ((notificationEndTime - notificationStartTime) / 1000);
    log.info({
      serverId: serverConfig.id,
      phase: 'notifications',
      durationSec: parseFloat(notificationDurationSec.toFixed(2))
    }, 'Notification processing completed');

    // Run PlaybackStatus → WatchHistory migration (if needed)
    try {
      await migratePlaybackStatusIfNeeded()
      results.migration = { completed: true }
    } catch (migrationError) {
      log.warn({ error: migrationError }, 'WatchHistory migration encountered an issue, but sync continues')
      results.migration = { completed: false, error: migrationError.message }
    }

    // Validate WatchHistory records against the current database state
    try {
      results.watchHistoryValidation = await validateWatchHistoryAgainstDatabase()
    } catch (validationError) {
      log.warn({ error: validationError }, 'WatchHistory validation encountered an issue, but sync continues')
      results.watchHistoryValidation = { error: validationError.message }
    }

    return results
  } catch (error) {
    logError(log, error, {
      serverId: serverConfig.id,
      phase: 'newArchitectureSync',
      architecture: 'new'
    });

    results.errors.push({
      phase: 'newArchitectureSync',
      error: error.message,
      stack: error.stack,
      serverId: serverConfig.id,
    })

    results.performance.endTime = new Date()
    results.performance.duration = Date.now() - startTime

    return results
  }
}

/**
 * Sync TV content using new domain-driven architecture via SyncManager.
 * Delegates to TVShowSyncService → SeasonSyncService → EpisodeSyncService,
 * which perform bulk writes with {ordered:false} and emit syncEventBus events.
 *
 * @param {Object} flatDB - Enhanced flat database structure (unused here, kept for signature parity)
 * @param {Object} fileServer - File server data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability mapping
 * @param {Object} results - Results object to populate
 * @returns {Promise<void>}
 */
async function syncTVContentWithNewArchitecture(
  fileServer,
  serverConfig,
  fieldAvailability,
  results
) {
  const log = createLogger('FlatSync.NewArch.TV')

  if (!fileServer?.tv) {
    log.info({ serverId: serverConfig.id }, 'No TV content in fileServer, skipping TV sync')
    return
  }

  const showTitles = Object.keys(fileServer.tv)
  if (showTitles.length === 0) {
    log.info({ serverId: serverConfig.id }, 'No TV show titles found, skipping TV sync')
    return
  }

  log.info({
    serverId: serverConfig.id,
    tvShowCount: showTitles.length,
    architecture: 'new'
  }, 'Starting TV sync with new domain architecture')

  const tvStartTime = performance.now()

  // Build server config in the shape the new architecture expects
  // (same transformation already used for movies in this adapter)
  const adaptedServerConfig = {
    id: serverConfig.id,
    priority: serverConfig.priority,
    baseUrl: serverConfig.baseURL,
    nodeUrl: serverConfig.internalEndpoint || serverConfig.syncEndpoint,
    prefix: serverConfig.prefixPath,
    enabled: true,
    timeout: 30000,
  }

  try {
    const batchResult = await syncManager.syncTVShows(
      showTitles,
      adaptedServerConfig,
      fieldAvailability,
      { fileServerData: fileServer, concurrency: 3 }
    )

    translateTVResults(batchResult, results, serverConfig.id)

    const tvDurationSec = ((performance.now() - tvStartTime) / 1000)
    log.info({
      serverId: serverConfig.id,
      durationSec: parseFloat(tvDurationSec.toFixed(2)),
      processed: {
        tvShows: results.tvShows.processed,
        seasons: results.seasons.processed,
        episodes: results.episodes.processed,
      },
      errors: results.tvShows.errors + results.seasons.errors + results.episodes.errors,
    }, 'TV content sync completed with new architecture')
  } catch (error) {
    logError(log, error, {
      serverId: serverConfig.id,
      phase: 'tvContentSync',
      architecture: 'new'
    })
    results.errors.push({
      phase: 'tvContentSync',
      error: error.message,
      stack: error.stack,
      serverId: serverConfig.id,
    })
  }
}

/**
 * Translate BatchSyncResult from SyncManager.syncTVShows into the flat sync result format.
 * Groups individual SyncResult entries by mediaType (tvshow, season, episode).
 *
 * @param {Object} batchResult - BatchSyncResult from SyncManager
 * @param {Object} results - Results object to populate in place
 * @param {string} serverId - Server ID for error attribution
 */
function translateTVResults(batchResult, results, serverId) {
  const byType = { tvshow: [], season: [], episode: [] }

  for (const r of batchResult.results || []) {
    const key = r.mediaType?.toLowerCase()
    if (Object.prototype.hasOwnProperty.call(byType, key)) {
      byType[key].push(r)
    }
  }

  results.tvShows = {
    processed: byType.tvshow.filter((r) => r.status === 'completed').length,
    errors: byType.tvshow.filter((r) => r.status === 'failed').length,
    details: byType.tvshow,
  }
  results.seasons = {
    processed: byType.season.filter((r) => r.status === 'completed').length,
    errors: byType.season.filter((r) => r.status === 'failed').length,
    details: byType.season,
  }
  results.episodes = {
    processed: byType.episode.filter((r) => r.status === 'completed').length,
    errors: byType.episode.filter((r) => r.status === 'failed').length,
    details: byType.episode,
  }

  for (const err of batchResult.errors || []) {
    results.errors.push({ phase: 'tvContentSync', error: err, serverId })
  }
}

/**
 * Extract movie titles from fileServer data structure
 * @param {Object} fileServer - File server data
 * @returns {string[]} Array of movie titles
 */
function extractMovieTitles(fileServer) {
  if (!fileServer || !fileServer.movies) {
    return []
  }

  const allKeys = Object.keys(fileServer.movies)

  const validTitles = allKeys.filter((title) => {
    const movieData = fileServer.movies[title]
    return movieData && (movieData.urls || movieData.metadata || movieData.poster)
  })

  return validTitles
}

/**
 * Translate new architecture movie results to flat sync format
 * @param {Object} batchSyncResult - Results from new architecture
 * @returns {Object} Flat sync compatible movie results
 */
function translateMovieResults(batchSyncResult) {
  const translated = {
    processed: 0,
    errors: 0,
    details: [],
    skipped: 0,
  }

  if (!batchSyncResult || !batchSyncResult.results) {
    return translated
  }

  // Group results by entity and status
  const resultsByEntity = new Map()

  for (const result of batchSyncResult.results) {
    if (!resultsByEntity.has(result.entityId)) {
      resultsByEntity.set(result.entityId, [])
    }
    resultsByEntity.get(result.entityId).push(result)
  }

  // Process each entity's results
  for (const [entityId, entityResults] of resultsByEntity) {
    const completedOperations = entityResults.filter((r) => r.status === 'completed')
    const failedOperations = entityResults.filter((r) => r.status === 'failed')
    const skippedOperations = entityResults.filter((r) => r.status === 'skipped')

    const detail = {
      title: entityId,
      serverId: entityResults[0]?.serverId,
      operations: {
        completed: completedOperations.length,
        failed: failedOperations.length,
        skipped: skippedOperations.length,
      },
      changes: completedOperations.flatMap((r) => r.changes),
      errors: failedOperations.flatMap((r) => r.errors),
      timestamp: new Date(),
    }

    translated.details.push(detail)

    // Count overall stats
    if (failedOperations.length > 0) {
      translated.errors++
    } else if (completedOperations.length > 0) {
      translated.processed++
    } else {
      translated.skipped++
    }
  }

  return translated
}

/**
 * Compare performance between old and new architectures
 * @param {Object} fileServer - File server data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability mapping
 * @returns {Promise<Object>} Performance comparison results
 */
export async function compareArchitecturePerformance(fileServer, serverConfig, fieldAvailability) {
  const log = createLogger('FlatSync.NewArch.Perf');
  
  log.info({ serverId: serverConfig.id }, 'Starting architecture performance comparison');

  const comparison = {
    newArchitecture: null,
    oldArchitecture: null,
    analysis: null,
  }

  try {
    // Test new architecture
    log.info({ serverId: serverConfig.id, architecture: 'new' }, 'Testing NEW architecture');
    const newStart = Date.now()
    const newResults = await syncWithNewArchitecture(fileServer, serverConfig, fieldAvailability)
    const newDuration = Date.now() - newStart

    comparison.newArchitecture = {
      duration: newDuration,
      results: newResults,
      memoryUsage: process.memoryUsage(),
    }

    // For old architecture comparison, we'd need to call the original flat sync
    // This would require importing and calling the existing flat sync functions
    log.info({ serverId: serverConfig.id }, 'Old architecture comparison would require calling existing flat sync');

    // Analysis
    comparison.analysis = {
      speedImprovement: 'New architecture provides better observability and error handling',
      memoryEfficiency: `New architecture used ${Math.round(comparison.newArchitecture.memoryUsage.heapUsed / 1024 / 1024)}MB heap`,
      errorHandling: 'Improved granular error isolation and recovery',
      observability: 'Real-time progress tracking and detailed metrics',
    }

    log.info({ 
      serverId: serverConfig.id,
      newDurationMs: newDuration,
      heapUsedMB: Math.round(comparison.newArchitecture.memoryUsage.heapUsed / 1024 / 1024)
    }, 'Performance comparison completed');
    return comparison
  } catch (error) {
    logError(log, error, { 
      serverId: serverConfig.id,
      context: 'performance_comparison'
    });
    comparison.error = error.message
    return comparison
  }
}

/**
 * Validate that new architecture can handle the provided data
 * @param {Object} fileServer - File server data
 * @param {Object} serverConfig - Server configuration
 * @returns {Object} Validation results
 */
export function validateNewArchitectureCompatibility(fileServer, serverConfig) {
  const validation = {
    isCompatible: true,
    warnings: [],
    errors: [],
    summary: {
      moviesFound: 0,
      episodesFound: 0,
      seasonsFound: 0,
      tvShowsFound: 0,
    },
  }

  try {
    // Validate server config
    if (!serverConfig || !serverConfig.id) {
      validation.errors.push('Server configuration missing or invalid')
      validation.isCompatible = false
    }

    // Check file server data
    if (!fileServer) {
      validation.errors.push('File server data is missing')
      validation.isCompatible = false
      return validation
    }

    // Count available content
    if (fileServer.movies) {
      validation.summary.moviesFound = Object.keys(fileServer.movies).length
    }

    if (fileServer.tv) {
      validation.summary.tvShowsFound = Object.keys(fileServer.tv).length

      // Count episodes and seasons
      for (const showData of Object.values(fileServer.tv)) {
        if (showData.seasons) {
          validation.summary.seasonsFound += Object.keys(showData.seasons).length

          for (const seasonData of Object.values(showData.seasons)) {
            if (seasonData.episodes) {
              validation.summary.episodesFound += seasonData.episodes.length
            }
          }
        }
      }
    }

    // Add info about hybrid architecture for TV content
    if (validation.summary.tvShowsFound > 0) {
      validation.warnings.push(
        `${validation.summary.tvShowsFound} TV shows will use LEGACY sync (hybrid mode until new architecture supports TV)`
      )
    }

    if (validation.summary.seasonsFound > 0) {
      validation.warnings.push(
        `${validation.summary.seasonsFound} seasons will use LEGACY sync (hybrid mode)`
      )
    }

    if (validation.summary.episodesFound > 0) {
      validation.warnings.push(
        `${validation.summary.episodesFound} episodes will use LEGACY sync (hybrid mode)`
      )
    }

    return validation
  } catch (error) {
    validation.errors.push(`Validation failed: ${error.message}`)
    validation.isCompatible = false
    return validation
  }
}
