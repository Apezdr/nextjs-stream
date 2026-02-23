/**
 * Flat media structure sync utilities
 * 
 * This module provides utilities for syncing data between file servers and a flat database structure
 * with separate collections for Movies, TV Shows, Seasons, and Episodes.
 */

import { syncMovies } from './movies/index';
import { syncTVShows } from './tvShows/index';
import { syncSeasons } from './seasons/index';
import { syncEpisodes } from './episodes/index';
import { doesFieldExistAcrossServers, MediaType } from '../sync/utils';
import { initializeFlatDatabase } from './initializeDatabase';
import { performance } from 'perf_hooks';
import clientPromise from '@src/lib/mongodb';
import { createLogger, logError } from '@src/lib/logger';
// Import memory utilities for optimized data access
import { buildEnhancedFlatDBStructure, hasTVShowValidVideoURLs } from './memoryUtils';
// Import video availability functions
import {
  checkAndRemoveUnavailableVideosFlat,
} from './videoAvailability';
// Import blurhash sync module
import { syncBlurhashData } from './blurhashSync';
// Import PlaybackStatus validation module
import { validatePlaybackStatusAgainstDatabase } from './playbackStatusValidation';
// Import notification system
import { MediaNotificationOrchestrator } from '../notifications/MediaNotificationOrchestrator';
// Import feature flag utilities and new architecture adapter
import { shouldUseNewArchitecture, logFeatureFlagDecision } from '../sync/featureFlags';
import { syncWithNewArchitecture, validateNewArchitectureCompatibility } from './newArchitectureAdapter';

/**
 * Process new content notifications after sync operations
 * @param {Object} syncResults - Results from sync operations
 * @param {Object} options - Notification processing options
 * @returns {Promise<Object>} Notification results
 */
async function processNewContentNotifications(syncResults, options = {}) {
  const log = createLogger('FlatSync');
  try {
    return await MediaNotificationOrchestrator.processSyncResults(syncResults, options);
  } catch (error) {
    logError(log, error, { context: 'notification_processing' });
    return {
      analysis: null,
      notifications: [],
      delivered: [],
      errors: [{ type: 'notification_error', message: error.message }],
      summary: { totalGenerated: 0, totalDelivered: 0, totalErrors: 1 }
    };
  }
}

/**
 * Syncs all media data from file servers to the flat database structure
 * @param {Object} fileServer - File server data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @param {boolean} skipInitialization - Skip database initialization (default: false)
 * @param {boolean} forceSync - Force sync even if hashes match (default: false)
 * @param {Object} options - Additional options
 * @param {boolean} options.useNewArchitecture - Force use of new architecture (overrides feature flag)
 * @param {boolean} options.forceOldArchitecture - Force use of old architecture (overrides feature flag)
 * @returns {Promise<Object>} Sync results
 */
export async function syncToFlatStructure(fileServer, serverConfig, fieldAvailability, skipInitialization = false, forceSync = false, options = {}) {
  const log = createLogger('FlatSync');
  
  log.info({ 
    serverId: serverConfig.id, 
    skipInitialization, 
    forceSync,
    useNewArchitecture: options.useNewArchitecture,
    forceOldArchitecture: options.forceOldArchitecture
  }, 'Starting sync to flat structure');

  // Check feature flag to determine which architecture to use
  const useNewArchitecture = shouldUseNewArchitecture({
    forceNew: options.useNewArchitecture,
    forceOld: options.forceOldArchitecture
  });

  logFeatureFlagDecision('syncToFlatStructure', useNewArchitecture, 
    options.useNewArchitecture ? 'runtime override' : 
    options.forceOldArchitecture ? 'forced old architecture' : 'environment/default');

  // If using new architecture, delegate to the adapter
  if (useNewArchitecture) {
    try {
      // Validate compatibility first
      const validation = validateNewArchitectureCompatibility(fileServer, serverConfig);
      
      if (!validation.isCompatible) {
        log.warn({ 
          serverId: serverConfig.id,
          errors: validation.errors 
        }, 'New architecture compatibility issues detected, falling back to old architecture');
        logFeatureFlagDecision('syncToFlatStructure', false, 'compatibility fallback');
      } else {
        // Show compatibility warnings
        if (validation.warnings.length > 0) {
          log.warn({ 
            serverId: serverConfig.id,
            warnings: validation.warnings 
          }, 'New architecture warnings detected');
        }

        // Use new architecture — pass pre-built flatDB if available to avoid double loading
        log.info({ serverId: serverConfig.id }, 'Delegating to NEW domain-driven sync architecture');
        return await syncWithNewArchitecture(fileServer, serverConfig, fieldAvailability, {
          forceSync,
          skipInitialization,
          preBuiltFlatDB: options.preBuiltFlatDB
        });
      }
    } catch (error) {
      logError(log, error, { 
        serverId: serverConfig.id,
        context: 'new_architecture_fallback' 
      });
      logFeatureFlagDecision('syncToFlatStructure', false, 'error fallback');
      // Continue with old architecture below
    }
  }

  // Continue with original flat sync implementation
  log.info({ serverId: serverConfig.id }, 'Using ORIGINAL flat sync architecture');

  // Track performance
  const startTime = performance.now();
  
  // Initialize database with indexes if not skipped
  if (!skipInitialization) {
    try {
      await initializeFlatDatabase();
    } catch (error) {
      logError(log, error, { 
        serverId: serverConfig.id,
        context: 'database_initialization' 
      });
      // Continue with sync even if initialization fails
    }
  }
  
  // Get MongoDB client
  const client = await clientPromise;
  
  // Build the enhanced data structure with optimized lookups
  // Re-use pre-built flatDB from caller if available to avoid double loading
  log.info({ serverId: serverConfig.id }, 'Using enhanced in-memory data structure for improved performance');
  const flatDB = options.preBuiltFlatDB || await buildEnhancedFlatDBStructure(client, fileServer, fieldAvailability);
  
  // Log missing media info with structured data
  const missingCounts = {
    movies: flatDB.missingMovies?.length || 0,
    tvShows: flatDB.missingTVShows?.length || 0,
    seasons: flatDB.missingSeasons?.length || 0,
    episodes: flatDB.missingEpisodes?.length || 0
  };
  
  if (missingCounts.movies > 0 || missingCounts.tvShows > 0 || missingCounts.seasons > 0 || missingCounts.episodes > 0) {
    log.info({ 
      serverId: serverConfig.id,
      missingCounts 
    }, 'Found missing media that needs to be created during sync');
  }
  
  // Sync in order: Movies -> TV Shows -> Seasons -> Episodes
  // This order ensures that parent entities exist before child entities

  // Sync movies (independent of other entities)
  log.info({ serverId: serverConfig.id, phase: 'movies' }, 'Starting sync phase');
  const movieStartTime = performance.now();
  const movieResults = await syncMovies(flatDB, fileServer, serverConfig, fieldAvailability);
  const movieEndTime = performance.now();
  const movieDurationSec = ((movieEndTime - movieStartTime) / 1000);
  log.info({ 
    serverId: serverConfig.id, 
    phase: 'movies', 
    durationSec: parseFloat(movieDurationSec.toFixed(2)) 
  }, 'Sync phase completed');
  
  // First sync TV shows
  log.info({ serverId: serverConfig.id, phase: 'tvShows' }, 'Starting sync phase');
  const tvShowStartTime = performance.now();
  const tvShowResults = await syncTVShows(flatDB, fileServer, serverConfig, fieldAvailability);
  const tvShowEndTime = performance.now();
  const tvShowDurationSec = ((tvShowEndTime - tvShowStartTime) / 1000);
  log.info({ 
    serverId: serverConfig.id, 
    phase: 'tvShows', 
    durationSec: parseFloat(tvShowDurationSec.toFixed(2)) 
  }, 'Sync phase completed');
  
  // Then sync seasons (which depend on TV shows)
  log.info({ serverId: serverConfig.id, phase: 'seasons' }, 'Starting sync phase');
  const seasonStartTime = performance.now();
  const seasonResults = await syncSeasons(flatDB, fileServer, serverConfig, fieldAvailability);
  const seasonEndTime = performance.now();
  const seasonDurationSec = ((seasonEndTime - seasonStartTime) / 1000);
  log.info({ 
    serverId: serverConfig.id, 
    phase: 'seasons', 
    durationSec: parseFloat(seasonDurationSec.toFixed(2)) 
  }, 'Sync phase completed');
  
  // Then sync episodes (which depend on seasons)
  log.info({ serverId: serverConfig.id, phase: 'episodes' }, 'Starting sync phase');
  const episodeStartTime = performance.now();
  const episodeResults = await syncEpisodes(flatDB, fileServer, serverConfig, fieldAvailability);
  const episodeEndTime = performance.now();
  const episodeDurationSec = ((episodeEndTime - episodeStartTime) / 1000);
  log.info({ 
    serverId: serverConfig.id, 
    phase: 'episodes', 
    durationSec: parseFloat(episodeDurationSec.toFixed(2)) 
  }, 'Sync phase completed');
  
  // Sync blurhashes using the most efficient available method
  log.info({ serverId: serverConfig.id, phase: 'blurhash' }, 'Starting sync phase');
  const blurhashStartTime = performance.now();
  const blurhashResults = await syncBlurhashData(client, flatDB, fileServer, serverConfig, fieldAvailability);
  const blurhashEndTime = performance.now();
  const blurhashDurationSec = ((blurhashEndTime - blurhashStartTime) / 1000);
  log.info({ 
    serverId: serverConfig.id, 
    phase: 'blurhash', 
    durationSec: parseFloat(blurhashDurationSec.toFixed(2)) 
  }, 'Sync phase completed');
  
  const results = {
    tvShows: tvShowResults,
    seasons: seasonResults,
    episodes: episodeResults,
    movies: movieResults,
    blurhash: blurhashResults
  };
  
  // Calculate total time
  const endTime = performance.now();
  const totalTimeSeconds = (endTime - startTime) / 1000;
  
  // Count skipped TV shows due to no valid videoURLs
  const skippedTVShows = tvShowResults.processed?.filter(show => show.skipped && show.skippedReason === 'no_valid_video_urls')?.length || 0;
  const actualProcessedTVShows = (tvShowResults.processed?.length || 0) - skippedTVShows;
  
  // Log summary of results with structured data
  const syncSummary = {
    serverId: serverConfig.id,
    totalDurationSec: parseFloat(totalTimeSeconds.toFixed(2)),
    processed: {
      movies: movieResults.processed?.length || 0,
      tvShows: actualProcessedTVShows,
      tvShowsSkipped: skippedTVShows,
      seasons: seasonResults.processed?.length || 0,
      episodes: episodeResults.processed?.length || 0
    },
    errors: {
      movies: movieResults.errors?.length || 0,
      tvShows: tvShowResults.errors?.length || 0,
      seasons: seasonResults.errors?.length || 0,
      episodes: episodeResults.errors?.length || 0
    }
  };
  
  log.info(syncSummary, 'Completed sync to flat structure');
  
  // Log blurhash sync results if available
  if (blurhashResults) {
    const method = blurhashResults.method || 'unknown';
    const blurhashSummary = { 
      serverId: serverConfig.id, 
      method,
      status: blurhashResults.status
    };
    
    if (method === 'traditional') {
      const movieResults = blurhashResults.results?.movies;
      const tvResults = blurhashResults.results?.tvShows;
      
      blurhashSummary.processed = {
        moviePosters: movieResults?.poster || 0,
        movieBackdrops: movieResults?.backdrop || 0,
        tvShows: tvResults?.show || 0,
        seasons: tvResults?.seasons || 0
      };
    } else if (method === 'optimized' || method === 'basic') {
      const movieResults = blurhashResults.results?.movies;
      const tvResults = blurhashResults.results?.tvShows;
      
      blurhashSummary.processed = {
        movies: movieResults?.processed?.length || 0,
        tvShows: tvResults?.processed?.length || 0
      };
      blurhashSummary.errors = {
        movies: movieResults?.errors?.length || 0,
        tvShows: tvResults?.errors?.length || 0
      };
    }
    
    log.info(blurhashSummary, 'Blurhash sync results');
  }
  
  // Process notifications for newly added content
  log.info({ serverId: serverConfig.id, phase: 'notifications' }, 'Starting notification processing');
  const notificationStartTime = performance.now();
  const notificationResults = await processNewContentNotifications(results, {
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
  const notificationEndTime = performance.now();
  const notificationDurationSec = ((notificationEndTime - notificationStartTime) / 1000);
  log.info({ 
    serverId: serverConfig.id, 
    phase: 'notifications',
    durationSec: parseFloat(notificationDurationSec.toFixed(2))
  }, 'Notification processing completed');
  
  // NOTE: We don't perform availability checks here anymore.
  // Availability checks should be performed once after all servers have been processed,
  // using the checkAvailabilityAcrossAllServers function.
  // This avoids the issue of content being removed by one server and then re-added by another.
  
  return {
    ...results,
    notifications: notificationResults,
    performance: {
      totalTimeSeconds,
      tvShowTimeSeconds: (tvShowEndTime - tvShowStartTime) / 1000,
      seasonTimeSeconds: (seasonEndTime - seasonStartTime) / 1000,
      episodeTimeSeconds: (episodeEndTime - episodeStartTime) / 1000,
      movieTimeSeconds: (movieEndTime - movieStartTime) / 1000,
      blurhashTimeSeconds: (blurhashEndTime - blurhashStartTime) / 1000,
      notificationTimeSeconds: (notificationEndTime - notificationStartTime) / 1000
    }
  };
}

/**
 * Checks and removes unavailable videos across all servers after all servers have been processed
 * @param {Object} allFileServers - All file servers data in a map of server ID to file server data
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object>} Availability check results
 */
export async function checkAvailabilityAcrossAllServers(allFileServers, fieldAvailability) {
  const log = createLogger('FlatSync.Availability');
  
  log.info({ serverCount: Object.keys(allFileServers).length }, 'Performing final availability check across all servers');
  const startTime = performance.now();
  
  // Get MongoDB client
  const client = await clientPromise;
  
  // Build the enhanced data structure with optimized lookups
  log.info({}, 'Using enhanced in-memory data structure for improved performance');
  const flatDB = await buildEnhancedFlatDBStructure(client, null, fieldAvailability);
  
  // Perform the availability check with all servers' data
  const results = await checkAndRemoveUnavailableVideosFlat(flatDB, allFileServers, fieldAvailability);
  
  const endTime = performance.now();
  const durationSec = (endTime - startTime) / 1000;
  
  // Log summary of removed items
  const removalSummary = {
    durationSec: parseFloat(durationSec.toFixed(2)),
    removed: results.removed ? {
      movies: results.removed.movies?.length || 0,
      tvShows: results.removed.tvShows?.length || 0,
      seasons: results.removed.tvSeasons?.length || 0,
      episodes: results.removed.tvEpisodes?.length || 0
    } : { movies: 0, tvShows: 0, seasons: 0, episodes: 0 }
  };
  
  log.info(removalSummary, 'Final availability check completed');
  
  // Now that availability checks are complete and database is cleaned,
  // validate PlaybackStatus records against the current state
  const validationStartTime = performance.now();
  const validationResults = await validatePlaybackStatusAgainstDatabase();
  const validationEndTime = performance.now();
  const validationDurationSec = (validationEndTime - validationStartTime) / 1000;
  
  log.info({ 
    durationSec: parseFloat(validationDurationSec.toFixed(2))
  }, 'PlaybackStatus validation completed');
  
  results.playbackValidation = validationResults;
  return results;
}

export {
  syncMovies,
  syncTVShows,
  syncSeasons,
  syncEpisodes,
  initializeFlatDatabase,
  MediaType,

  doesFieldExistAcrossServers,
  
  // Export memory utilities
  buildEnhancedFlatDBStructure,
  
  // Export video availability functions
  checkAndRemoveUnavailableVideosFlat,
  
  // Export blurhash sync functions
  syncBlurhashData,
  
  // Export PlaybackStatus validation functions
  validatePlaybackStatusAgainstDatabase,
};
