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
// Import video availability functions
import {
  checkAndRemoveUnavailableVideosFlat,
} from './videoAvailability';

/**
 * Builds a compatible data structure from the flat database collections
 * @param {Object} fileServer - Optional file server data to check for missing media
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object>} Data structure compatible with sync functions with missing media info
 */
export async function buildFlatDBStructure(fileServer = null, fieldAvailability) {
  const client = await clientPromise;
  try {
    console.log(chalk.cyan('Building data structure from flat database collections...'));
    
    // Get all TV shows from FlatTVShows collection
    const flatTVShows = await client
      .db('Media')
      .collection('FlatTVShows')
      .find({})
      .toArray();
    
    // For each TV show, get its seasons and episodes
    const tvShowsWithSeasonsAndEpisodes = await Promise.all(
      flatTVShows.map(async (show) => {
        const showId = show._id;
        // Get all seasons for this show
        const seasons = await client
          .db('Media')
          .collection('FlatSeasons')
          .find({ showId: showId })
          .sort({ seasonNumber: 1 })
          .toArray();
        
        // For each season, get all episodes
        const seasonsWithEpisodes = await Promise.all(
          seasons.map(async (season) => {
            const seasonId = season._id;
            
            // Get episodes with the correct showId AND seasonId
            // Any episodes with incorrect IDs will be fixed by the getEpisodeFromFlatDB function
            // the next time they are accessed
            const episodes = await client
              .db('Media')
              .collection('FlatEpisodes')
              .find({ 
                showId: showId,
                seasonId: seasonId 
              })
              .sort({ episodeNumber: 1 })
              .toArray();
            
            return {
              ...season,
              episodes
            };
          })
        );
        
        return {
          ...show,
          seasons: seasonsWithEpisodes
        };
      })
    );
    
    // Get all movies from FlatMovies collection
    const flatMovies = await client
      .db('Media')
      .collection('FlatMovies')
      .find({})
      .toArray();
    
    // Analyze missing media if fileServer data is provided
    const missingMedia = {
      movieTitles: [],
      tvShowTitles: []
    };
    
    if (fileServer) {
      // Create maps for faster lookups
      const movieTitleMap = flatMovies.reduce((map, movie) => {
        if (movie.title) map[movie.title] = true;
        if (movie.originalTitle && movie.originalTitle !== movie.title) map[movie.originalTitle] = true;
        return map;
      }, {});
      
      // Check for missing movies
      if (fileServer.movies) {
        const movieTitlesFromServer = Object.keys(fileServer.movies);
        missingMedia.movieTitles = movieTitlesFromServer.filter((title) => {
          if (
            doesFieldExistAcrossServers(
              fieldAvailability,
              'movies',
              title,
              'urls.mp4'
            )
          ) {
            return !movieTitleMap[title];
          }
        });
        
        if (missingMedia.movieTitles.length > 0) {
          console.log(chalk.yellow(`Identified ${missingMedia.movieTitles.length} movies missing from database`));
        }
      }
      
      // Similar logic could be added for TV shows if needed
    }

    const data = {
      tv: tvShowsWithSeasonsAndEpisodes,
      movies: flatMovies,
    };

    if (missingMedia.movieTitles.length > 0) {
      data.missingMovies = missingMedia.movieTitles;
    }
    if (missingMedia.tvShowTitles.length > 0) {
      data.missingTVShows = missingMedia.tvShowTitles;
    }
    
    return data;
  } catch (error) {
    console.error('Error building flat database structure:', error);
    return { tv: [], movies: [] };
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
  
  // Build a compatible data structure from the flat database collections
  // Pass fileServer to identify missing media
  const flatDB = await buildFlatDBStructure(fileServer, fieldAvailability);
  
  // Log missing media info
  if (flatDB.missingMovies && flatDB.missingMovies.length > 0) {
    console.log(chalk.cyan(`Found ${flatDB.missingMovies.length} movies that need to be created during sync`));
  }
  if (flatDB.missingTVShows && flatDB.missingTVShows.length > 0) {
    console.log(chalk.cyan(`Found ${flatDB.missingTVShows.length} TV shows that need to be created during sync`));
  }
  
  // Sync in order: TV Shows -> Seasons -> Episodes -> Movies
  // This order ensures that parent entities exist before child entities
  
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
  
  // Finally sync movies (independent of other entities)
  console.log(chalk.blue(`Starting movie sync to flat structure...`));
  const movieStartTime = performance.now();
  const movieResults = await syncMovies(flatDB, fileServer, serverConfig, fieldAvailability);
  const movieEndTime = performance.now();
  console.log(chalk.blue(`Movie sync completed in ${((movieEndTime - movieStartTime) / 1000).toFixed(2)} seconds`));
  
  const results = {
    tvShows: tvShowResults,
    seasons: seasonResults,
    episodes: episodeResults,
    movies: movieResults
  };
  
  // Calculate total time
  const endTime = performance.now();
  const totalTimeSeconds = (endTime - startTime) / 1000;
  
  // Log summary of results
  console.log(chalk.bold.green(`Completed sync to flat structure for server ${serverConfig.id}`));
  console.log(`TV Shows processed: ${tvShowResults.processed.length}, errors: ${tvShowResults.errors.length}`);
  console.log(`Seasons processed: ${seasonResults.processed.length}, errors: ${seasonResults.errors.length}`);
  console.log(`Episodes processed: ${episodeResults.processed.length}, errors: ${episodeResults.errors.length}`);
  console.log(`Movies processed: ${movieResults.processed.length}, errors: ${movieResults.errors.length}`);
  console.log(chalk.bold.green(`Total sync time: ${totalTimeSeconds.toFixed(2)} seconds`));
  
  // NOTE: We don't perform availability checks here anymore.
  // Availability checks should be performed once after all servers have been processed,
  // using the checkAvailabilityAcrossAllServers function.
  // This avoids the issue of content being removed by one server and then re-added by another.
  
  return {
    ...results,
    performance: {
      totalTimeSeconds,
      tvShowTimeSeconds: (tvShowEndTime - tvShowStartTime) / 1000,
      seasonTimeSeconds: (seasonEndTime - seasonStartTime) / 1000,
      episodeTimeSeconds: (episodeEndTime - episodeStartTime) / 1000,
      movieTimeSeconds: (movieEndTime - movieStartTime) / 1000
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
  
  // Build a flat database structure
  const flatDB = await buildFlatDBStructure(null, fieldAvailability);
  
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
  
  return results;
}

export {
  syncMovies,
  syncTVShows,
  syncSeasons,
  syncEpisodes,
  initializeFlatDatabase,
  MediaType,
  
  // Export video availability functions
  checkAndRemoveUnavailableVideosFlat,
};
