/**
 * Database initialization utilities for flat structure
 * 
 * This module provides functions to initialize the database with proper indexes
 * for optimal query performance with the flat database structure.
 */

import { createLogger, logError } from '@src/lib/logger';
import clientPromise from '@src/lib/mongodb';

/**
 * Helper function to create a single index with error handling
 * @param {object} collection - MongoDB collection
 * @param {object} indexSpec - Index specification
 * @param {object} log - Logger instance
 * @param {string} collectionName - Name of the collection for logging
 * @returns {Promise<boolean>} - True if successful, false otherwise
 */
async function createIndexSafely(collection, indexSpec, log, collectionName) {
  try {
    await collection.createIndex(indexSpec.key, {
      name: indexSpec.name,
      unique: indexSpec.unique || false
    });
    return true;
  } catch (error) {
    // Log warning but don't throw - allow other indexes to be created
    if (error.code === 85 || error.code === 86) {
      // Index already exists or exists with different options
      log.warn(`Index ${indexSpec.name} on ${collectionName}: ${error.message}`);
    } else {
      log.error(`Failed to create index ${indexSpec.name} on ${collectionName}:`, error);
    }
    return false;
  }
}

/**
 * Creates indexes for a collection with individual error handling
 * @param {object} collection - MongoDB collection
 * @param {Array} indexSpecs - Array of index specifications
 * @param {object} log - Logger instance
 * @param {string} collectionName - Name of the collection for logging
 * @returns {Promise<object>} - Object with success and failure counts
 */
async function createCollectionIndexes(collection, indexSpecs, log, collectionName) {
  let successCount = 0;
  let failureCount = 0;
  
  for (const indexSpec of indexSpecs) {
    const success = await createIndexSafely(collection, indexSpec, log, collectionName);
    if (success) {
      successCount++;
    } else {
      failureCount++;
    }
  }
  
  return { successCount, failureCount, totalCount: indexSpecs.length };
}

/**
 * Creates indexes for the flat database collections
 * @returns {Promise<void>}
 */
export async function createFlatDatabaseIndexes() {
  const client = await clientPromise;
  const log = createLogger('FlatSync.InitializeDatabase');
  log.info('Creating indexes for flat database collections...');
  
  const results = {};
  
  try {
    // Create indexes for FlatMovies collection
    const flatMoviesIndexes = [
      { key: { title: 1 }, name: 'title_index', unique: true },
      { key: { originalTitle: 1 }, name: 'originalTitle_index', unique: true },
      { key: { 'metadata.genres.name': 1 }, name: 'genres_index' },
      { key: { 'metadata.release_date': -1 }, name: 'release_date_index' },
      { key: { 'metadata.vote_average': -1 }, name: 'rating_index' },
      { key: { type: 1 }, name: 'type_index' },
      { key: { videoURL: 1 }, name: 'videoURL_index' },
      { key: { normalizedVideoId: 1 }, name: 'normalized_id_index' },
      // Index for trailer URL lookups (e.g., YouTube trailers stored on metadata.trailer_url)
      // Used by: getFlatRecentlyWatchedForUser when resolving trailer watch entries to movies
      { key: { 'metadata.trailer_url': 1 }, name: 'trailer_url_index' },
      { key: { duration: 1 }, name: 'duration_index' },
      { key: { videoSource: 1 }, name: 'videoSource_index' },
      
      // CRITICAL: Compound indexes for genre filtering + sorting (fixes 30s query delays)
      // These allow MongoDB to filter by genre AND return sorted results using a single index
      { key: { 'metadata.genres.name': 1, 'metadata.release_date': -1 }, name: 'genres_release_date_index' },
      { key: { 'metadata.genres.name': 1, 'metadata.vote_average': -1 }, name: 'genres_rating_index' },
      { key: { 'metadata.genres.name': 1, 'title': 1 }, name: 'genres_title_index' },
      
      // CRITICAL: Covered query index for validation scans (fixes COLLSCAN in watchHistoryValidation)
      // Enables index-only lookups without reading documents from disk
      // Used by: validateWatchHistoryAgainstDatabase() - improves performance from COLLSCAN to IXSCAN
      { key: { videoURL: 1, normalizedVideoId: 1 }, name: 'videoURL_normalizedId_covered_index' }
    ];
    results.FlatMovies = await createCollectionIndexes(
      client.db('Media').collection('FlatMovies'),
      flatMoviesIndexes,
      log,
      'FlatMovies'
    );
    log.info(`FlatMovies indexes: ${results.FlatMovies.successCount}/${results.FlatMovies.totalCount} created`);
    
    // Create indexes for FlatTVShows collection
    const flatTVShowsIndexes = [
      { key: { title: 1 }, name: 'title_index', unique: true },
      { key: { originalTitle: 1 }, name: 'originalTitle_index', unique: true },
      { key: { 'metadata.genres.name': 1 }, name: 'genres_index' },
      { key: { 'metadata.first_air_date': -1 }, name: 'first_air_date_index' },
      { key: { 'metadata.vote_average': -1 }, name: 'rating_index' },
      { key: { 'metadata.trailer_url': 1 }, name: 'trailer_url_index' },
      { key: { type: 1 }, name: 'type_index' },
      
      // CRITICAL: Compound indexes for genre filtering + sorting (fixes 30s query delays)
      // These allow MongoDB to filter by genre AND return sorted results using a single index
      { key: { 'metadata.genres.name': 1, 'metadata.first_air_date': -1 }, name: 'genres_first_air_date_index' },
      { key: { 'metadata.genres.name': 1, 'metadata.vote_average': -1 }, name: 'genres_rating_index' },
      { key: { 'metadata.genres.name': 1, 'title': 1 }, name: 'genres_title_index' }
    ];
    results.FlatTVShows = await createCollectionIndexes(
      client.db('Media').collection('FlatTVShows'),
      flatTVShowsIndexes,
      log,
      'FlatTVShows'
    );
    log.info(`FlatTVShows indexes: ${results.FlatTVShows.successCount}/${results.FlatTVShows.totalCount} created`);
    
    // Create indexes for FlatSeasons collection
    const flatSeasonsIndexes = [
      { key: { showId: 1, seasonNumber: 1 }, name: 'show_season_index', unique: true },
      { key: { showTitle: 1, seasonNumber: 1 }, name: 'show_title_season_index', unique: true },
      { key: { type: 1 }, name: 'type_index' }
    ];
    results.FlatSeasons = await createCollectionIndexes(
      client.db('Media').collection('FlatSeasons'),
      flatSeasonsIndexes,
      log,
      'FlatSeasons'
    );
    log.info(`FlatSeasons indexes: ${results.FlatSeasons.successCount}/${results.FlatSeasons.totalCount} created`);
    
    // Create indexes for FlatEpisodes collection
    const flatEpisodesIndexes = [
      { key: { showId: 1, seasonId: 1, episodeNumber: 1 }, name: 'show_season_episode_index', unique: true },
      { key: { showTitle: 1, seasonNumber: 1, episodeNumber: 1 }, name: 'show_title_season_episode_index', unique: true },
      
      // CRITICAL: Index for queries filtering by seasonId alone (fixes COLLSCAN slow query)
      // This enables efficient episode lookups within a season and eliminates in-memory sorting
      // Used by: next episode queries, season episode listings, episode navigation
      { key: { seasonId: 1, episodeNumber: 1 }, name: 'season_episode_index' },
      
      { key: { airDate: -1 }, name: 'air_date_index' },
      { key: { type: 1 }, name: 'type_index' },
      { key: { videoURL: 1 }, name: 'videoURL_index' },
      { key: { normalizedVideoId: 1 }, name: 'normalized_id_index' },
      { key: { duration: 1 }, name: 'duration_index' },
      { key: { videoSource: 1 }, name: 'videoSource_index' },
      
      // CRITICAL: Index for sorting by mediaLastModified (fixes COLLSCAN in recent episodes aggregation)
      // This enables the aggregation pipeline to efficiently sort and group episodes by modification time
      // Used by: recently modified episodes queries, sync aggregation pipeline
      { key: { mediaLastModified: -1 }, name: 'mediaLastModified_index' },
      
      // CRITICAL: Covered query index for validation scans (fixes COLLSCAN in watchHistoryValidation)
      // Enables index-only lookups without reading documents from disk
      // Used by: validateWatchHistoryAgainstDatabase() - improves performance from COLLSCAN to IXSCAN
      { key: { videoURL: 1, normalizedVideoId: 1 }, name: 'videoURL_normalizedId_covered_index' }
    ];
    results.FlatEpisodes = await createCollectionIndexes(
      client.db('Media').collection('FlatEpisodes'),
      flatEpisodesIndexes,
      log,
      'FlatEpisodes'
    );
    log.info(`FlatEpisodes indexes: ${results.FlatEpisodes.successCount}/${results.FlatEpisodes.totalCount} created`);
    
    // Create indexes for Notifications collection
    const notificationsIndexes = [
      // CRITICAL: Compound index for unread notification queries (fixes COLLSCAN slow query)
      // Used by: unread count queries, notification list filtering, mark all as read operations
      // This eliminates scanning 78k+ documents for simple unread counts
      { key: { userId: 1, read: 1 }, name: 'userId_read_index' },
      
      // Index for sorting by creation date
      { key: { userId: 1, createdAt: -1 }, name: 'userId_createdAt_index' },
      
      // Index for category filtering
      { key: { userId: 1, category: 1 }, name: 'userId_category_index' },
      
      // Index for priority filtering
      { key: { userId: 1, priority: -1 }, name: 'userId_priority_index' }
    ];
    results.Notifications = await createCollectionIndexes(
      client.db('Media').collection('Notifications'),
      notificationsIndexes,
      log,
      'Notifications'
    );
    log.info(`Notifications indexes: ${results.Notifications.successCount}/${results.Notifications.totalCount} created`);
    
    // Create indexes for WatchHistory collection
    const watchHistoryIndexes = [
      // CRITICAL: Compound unique index prevents duplicate watch history entries per user+video
      // Used by: playback sync, watch history queries, migration from old PlaybackStatus schema
      { key: { userId: 1, normalizedVideoId: 1 }, unique: true, name: 'userId_normalizedId_unique' },
      
      // Index for user-specific queries
      { key: { userId: 1 }, name: 'userId_index' },
      
      // Index for video-specific queries
      { key: { normalizedVideoId: 1 }, name: 'normalizedVideoId_index' },
      
      // Index for sorting by last updated (recent watch history)
      { key: { userId: 1, lastUpdated: -1 }, name: 'userId_lastUpdated_index' }
    ];
    results.WatchHistory = await createCollectionIndexes(
      client.db('Media').collection('WatchHistory'),
      watchHistoryIndexes,
      log,
      'WatchHistory'
    );
    log.info(`WatchHistory indexes: ${results.WatchHistory.successCount}/${results.WatchHistory.totalCount} created`);
    
    // Summary
    const totalSuccess = Object.values(results).reduce((sum, r) => sum + r.successCount, 0);
    const totalIndexes = Object.values(results).reduce((sum, r) => sum + r.totalCount, 0);
    const totalFailures = Object.values(results).reduce((sum, r) => sum + r.failureCount, 0);
    
    log.info(`Index creation complete: ${totalSuccess}/${totalIndexes} successful, ${totalFailures} failed`);
    
    if (totalFailures > 0) {
      log.warn(`Some indexes failed to create, but database initialization will continue`);
    }
  } catch (error) {
    logError(log, error, { context: 'create_indexes' });
    throw error;
  }
}

/**
 * Initializes the flat database structure
 * This should be called before starting any sync operations
 * @returns {Promise<void>}
 */
export async function initializeFlatDatabase() {
  const log = createLogger('FlatSync.InitializeDatabase');
  log.info('Initializing flat database structure...');
  
  try {
    // Create indexes
    await createFlatDatabaseIndexes();
    
    log.info('Flat database initialization complete');
  } catch (error) {
    logError(log, error, { context: 'initialize_flat_database' });
    throw error;
  }
}
