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
import chalk from 'chalk';
import { initializeFlatDatabase } from './initializeDatabase';
import { performance } from 'perf_hooks';
import clientPromise from '@src/lib/mongodb';
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

/**
 * Process new content notifications after sync operations
 * @param {Object} syncResults - Results from sync operations
 * @param {Object} options - Notification processing options
 * @returns {Promise<Object>} Notification results
 */
async function processNewContentNotifications(syncResults, options = {}) {
  try {
    return await MediaNotificationOrchestrator.processSyncResults(syncResults, options);
  } catch (error) {
    console.error('Error processing new content notifications:', error);
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
 * @returns {Promise<Object>} Sync results
 */
export async function syncToFlatStructure(fileServer, serverConfig, fieldAvailability, skipInitialization = false, forceSync = false) {
  console.log(chalk.bold.green(`Starting sync to flat structure for server ${serverConfig.id}...`));

  // Track performance
  const startTime = performance.now();
  
  // Initialize database with indexes if not skipped
  if (!skipInitialization) {
    try {
      await initializeFlatDatabase();
    } catch (error) {
      console.error('Error initializing database:', error);
      // Continue with sync even if initialization fails
    }
  }
  
  // Get MongoDB client
  const client = await clientPromise;
  
  // Build the enhanced data structure with optimized lookups
  console.log(chalk.green('Using enhanced in-memory data structure for improved performance...'));
  const flatDB = await buildEnhancedFlatDBStructure(client, fileServer, fieldAvailability);
  
  // Log missing media info
  if (flatDB.missingMovies && flatDB.missingMovies.length > 0) {
    console.log(chalk.cyan(`Found ${flatDB.missingMovies.length} movies that need to be created during sync`));
  }
  if (flatDB.missingTVShows && flatDB.missingTVShows.length > 0) {
    console.log(chalk.cyan(`Found ${flatDB.missingTVShows.length} TV shows that need to be created during sync`));
  }
  if (flatDB.missingSeasons && flatDB.missingSeasons.length > 0) {
    console.log(chalk.cyan(`Found ${flatDB.missingSeasons.length} seasons that need to be created during sync`));
  }
  if (flatDB.missingEpisodes && flatDB.missingEpisodes.length > 0) {
    console.log(chalk.cyan(`Found ${flatDB.missingEpisodes.length} episodes that need to be created during sync`));
  }
  
  // Sync in order: Movies -> TV Shows -> Seasons -> Episodes
  // This order ensures that parent entities exist before child entities

  // Sync movies (independent of other entities)
  console.log(chalk.blue(`Starting movie sync to flat structure...`));
  const movieStartTime = performance.now();
  const movieResults = await syncMovies(flatDB, fileServer, serverConfig, fieldAvailability);
  const movieEndTime = performance.now();
  console.log(chalk.blue(`Movie sync completed in ${((movieEndTime - movieStartTime) / 1000).toFixed(2)} seconds`));
  
  // First sync TV shows
  console.log(chalk.cyan(`Starting TV show sync to flat structure...`));
  const tvShowStartTime = performance.now();
  const tvShowResults = await syncTVShows(flatDB, fileServer, serverConfig, fieldAvailability);
  const tvShowEndTime = performance.now();
  console.log(chalk.cyan(`TV show sync completed in ${((tvShowEndTime - tvShowStartTime) / 1000).toFixed(2)} seconds`));
  
  // Then sync seasons (which depend on TV shows)
  console.log(chalk.magenta(`Starting season sync to flat structure...`));
  const seasonStartTime = performance.now();
  const seasonResults = await syncSeasons(flatDB, fileServer, serverConfig, fieldAvailability);
  const seasonEndTime = performance.now();
  console.log(chalk.magenta(`Season sync completed in ${((seasonEndTime - seasonStartTime) / 1000).toFixed(2)} seconds`));
  
  // Then sync episodes (which depend on seasons)
  console.log(chalk.yellow(`Starting episode sync to flat structure...`));
  const episodeStartTime = performance.now();
  const episodeResults = await syncEpisodes(flatDB, fileServer, serverConfig, fieldAvailability);
  const episodeEndTime = performance.now();
  console.log(chalk.yellow(`Episode sync completed in ${((episodeEndTime - episodeStartTime) / 1000).toFixed(2)} seconds`));
  
  // Sync blurhashes using the most efficient available method
  console.log(chalk.magenta(`Starting blurhash sync to flat structure...`));
  const blurhashStartTime = performance.now();
  const blurhashResults = await syncBlurhashData(client, flatDB, fileServer, serverConfig, fieldAvailability);
  const blurhashEndTime = performance.now();
  console.log(chalk.magenta(`Blurhash sync completed in ${((blurhashEndTime - blurhashStartTime) / 1000).toFixed(2)} seconds`));
  
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
  
  // Log summary of results
  console.log(chalk.bold.green(`Completed sync to flat structure for server ${serverConfig.id}`));
  
  // Count skipped TV shows due to no valid videoURLs
  const skippedTVShows = tvShowResults.processed?.filter(show => show.skipped && show.skippedReason === 'no_valid_video_urls')?.length || 0;
  const actualProcessedTVShows = (tvShowResults.processed?.length || 0) - skippedTVShows;
  
  console.log(`TV Shows processed: ${actualProcessedTVShows}, skipped due to no valid videoURLs: ${skippedTVShows}, errors: ${tvShowResults.errors?.length || 0}`);
  console.log(`Seasons processed: ${seasonResults.processed?.length || 0}, errors: ${seasonResults.errors?.length || 0}`);
  console.log(`Episodes processed: ${episodeResults.processed?.length || 0}, errors: ${episodeResults.errors?.length || 0}`);
  console.log(`Movies processed: ${movieResults.processed?.length || 0}, errors: ${movieResults.errors?.length || 0}`);
  
  // Log blurhash sync results if available
  if (blurhashResults) {
    const method = blurhashResults.method || 'unknown';
    console.log(chalk.cyan(`Blurhash sync method: ${method}`));
    
    if (method === 'traditional') {
      const movieResults = blurhashResults.results?.movies;
      const tvResults = blurhashResults.results?.tvShows;
      
      if (movieResults) {
        console.log(`Blurhash movie posters processed: ${movieResults.poster || 0}, backdrops: ${movieResults.backdrop || 0}`);
      }
      
      if (tvResults) {
        console.log(`Blurhash TV shows processed: ${tvResults.show || 0}, seasons: ${tvResults.seasons || 0}`);
      }
    } else if (method === 'optimized' || method === 'basic') {
      const movieResults = blurhashResults.results?.movies;
      const tvResults = blurhashResults.results?.tvShows;
      
      if (movieResults) {
        console.log(`Blurhash movies processed: ${movieResults.processed?.length || 0}, errors: ${movieResults.errors?.length || 0}`);
      }
      
      if (tvResults) {
        console.log(`Blurhash TV shows processed: ${tvResults.processed?.length || 0}, errors: ${tvResults.errors?.length || 0}`);
      }
    }
    
    if (blurhashResults.status === 'no_changes') {
      console.log(chalk.green(`No blurhash changes detected`));
    }
  }
  
  console.log(chalk.bold.green(`Total sync time: ${totalTimeSeconds.toFixed(2)} seconds`));
  
  // Process notifications for newly added content
  console.log(chalk.green('Processing notifications for new content...'));
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
  console.log(chalk.green(`Notification processing completed in ${((notificationEndTime - notificationStartTime) / 1000).toFixed(2)} seconds`));
  
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
  console.log(chalk.bold.yellow('Performing final availability check across all servers...'));
  const startTime = performance.now();
  
  // Get MongoDB client
  const client = await clientPromise;
  
  // Build the enhanced data structure with optimized lookups
  console.log(chalk.green('Using enhanced in-memory data structure for improved performance...'));
  const flatDB = await buildEnhancedFlatDBStructure(client, null, fieldAvailability);
  
  // Perform the availability check with all servers' data
  const results = await checkAndRemoveUnavailableVideosFlat(flatDB, allFileServers, fieldAvailability);
  
  const endTime = performance.now();
  const timeSeconds = (endTime - startTime) / 1000;
  
  console.log(chalk.bold.yellow(`Final availability check completed in ${timeSeconds.toFixed(2)} seconds`));
  
  // Log summary of removed items
  if (results.removed) {
    const { movies, tvShows, tvSeasons, tvEpisodes } = results.removed;
    console.log(`Removed ${movies?.length || 0} unavailable movies`);
    console.log(`Removed ${tvShows?.length || 0} unavailable TV shows`);
    console.log(`Removed ${tvSeasons?.length || 0} unavailable seasons`);
    console.log(`Removed ${tvEpisodes?.length || 0} unavailable episodes`);
  }
  
  // Now that availability checks are complete and database is cleaned,
  // validate PlaybackStatus records against the current state
  const validationStartTime = performance.now();
  const validationResults = await validatePlaybackStatusAgainstDatabase();
  const validationEndTime = performance.now();
  const validationTimeSeconds = (validationEndTime - validationStartTime) / 1000;
  
  console.log(chalk.bold.green(`PlaybackStatus validation completed in ${validationTimeSeconds.toFixed(2)} seconds`));
  
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
