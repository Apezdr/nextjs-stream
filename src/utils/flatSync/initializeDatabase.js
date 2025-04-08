/**
 * Database initialization utilities for flat structure
 * 
 * This module provides functions to initialize the database with proper indexes
 * for optimal query performance with the flat database structure.
 */

import clientPromise from '@src/lib/mongodb';
import chalk from 'chalk';

/**
 * Creates indexes for the flat database collections
 * @returns {Promise<void>}
 */
export async function createFlatDatabaseIndexes() {
  const client = await clientPromise;
  console.log(chalk.bold.green('Creating indexes for flat database collections...'));
  
  try {
    // Create indexes for FlatMovies collection
    await client.db('Media').collection('FlatMovies').createIndexes([
      { key: { title: 1 }, name: 'title_index', unique: true },
      { key: { originalTitle: 1 }, name: 'originalTitle_index', unique: true },
      { key: { 'metadata.genres.name': 1 }, name: 'genres_index' },
      { key: { 'metadata.release_date': -1 }, name: 'release_date_index' },
      { key: { 'metadata.vote_average': -1 }, name: 'rating_index' },
      { key: { type: 1 }, name: 'type_index' },
      { key: { videoURL: 1 }, name: 'videoURL_index' },
      { key: { normalizedVideoId: 1 }, name: 'normalized_id_index' },
      { key: { duration: 1 }, name: 'duration_index' } // Add index for duration field
    ]);
    console.log(chalk.green('Created indexes for FlatMovies collection'));
    
    // Create indexes for FlatTVShows collection
    await client.db('Media').collection('FlatTVShows').createIndexes([
      { key: { title: 1 }, name: 'title_index', unique: true },
      { key: { originalTitle: 1 }, name: 'originalTitle_index', unique: true },
      { key: { 'metadata.genres.name': 1 }, name: 'genres_index' },
      { key: { 'metadata.first_air_date': -1 }, name: 'first_air_date_index' },
      { key: { 'metadata.vote_average': -1 }, name: 'rating_index' },
      { key: { type: 1 }, name: 'type_index' }
    ]);
    console.log(chalk.green('Created indexes for FlatTVShows collection'));
    
    // Create indexes for FlatSeasons collection
    await client.db('Media').collection('FlatSeasons').createIndexes([
      { key: { showId: 1, seasonNumber: 1 }, name: 'show_season_index', unique: true },
      { key: { showTitle: 1, seasonNumber: 1 }, name: 'show_title_season_index', unique: true },
      { key: { type: 1 }, name: 'type_index' }
    ]);
    console.log(chalk.green('Created indexes for FlatSeasons collection'));
    
    // Create indexes for FlatEpisodes collection
    await client.db('Media').collection('FlatEpisodes').createIndexes([
      { key: { showId: 1, seasonId: 1, episodeNumber: 1 }, name: 'show_season_episode_index', unique: true },
      { key: { showTitle: 1, seasonNumber: 1, episodeNumber: 1 }, name: 'show_title_season_episode_index', unique: true },
      { key: { airDate: -1 }, name: 'air_date_index' },
      { key: { type: 1 }, name: 'type_index' },
      { key: { videoURL: 1 }, name: 'videoURL_index' },
      { key: { normalizedVideoId: 1 }, name: 'normalized_id_index' },
      { key: { duration: 1 }, name: 'duration_index' } // Add index for duration field
    ]);
    console.log(chalk.green('Created indexes for FlatEpisodes collection'));
    
    // Create indexes for PlaybackStatus collection
    await client.db('Media').collection('PlaybackStatus').createIndexes([
      // Standard user lookup index
      { key: { userId: 1 }, name: 'userId_index' },
      
      // Compound indexes for fast video lookups
      { key: { userId: 1, 'videosWatched.normalizedVideoId': 1 }, name: 'userId_normalizedId_index' },
      
      // Index for sorting by last updated timestamp
      { key: { userId: 1, 'videosWatched.lastUpdated': -1 }, name: 'userId_lastUpdated_index' },
      
      // Index for lookups by normalizedVideoId without userId (for view count aggregation)
      { key: { 'videosWatched.normalizedVideoId': 1 }, name: 'normalizedVideoId_index' }
    ]);
    console.log(chalk.green('Created indexes for PlaybackStatus collection'));
    
    console.log(chalk.bold.green('Successfully created all indexes for flat database collections'));
  } catch (error) {
    console.error('Error creating indexes:', error);
    throw error;
  }
}

/**
 * Initializes the flat database structure
 * This should be called before starting any sync operations
 * @returns {Promise<void>}
 */
export async function initializeFlatDatabase() {
  console.log(chalk.bold.cyan('Initializing flat database structure...'));
  
  try {
    // Create indexes
    await createFlatDatabaseIndexes();
    
    console.log(chalk.bold.cyan('Flat database initialization complete'));
  } catch (error) {
    console.error('Error initializing flat database:', error);
    throw error;
  }
}
