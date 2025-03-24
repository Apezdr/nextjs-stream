/**
 * Movie sync utilities for flat database structure
 */

import { syncMovieMetadata } from './metadata';
import { syncMovieVideoURL } from './videoUrl';
import { syncMoviePoster } from './poster';
import { syncMovieBackdrop } from './backdrop';
import { syncMovieBlurhash } from './blurhash';
import { syncMovieLogos } from './logos';
import { syncMovieChapters } from './chapters';
import { syncMovieCaptions } from './captions';
import { createMissingMovies } from './initialize'; // Import the new function
import clientPromise from '@src/lib/mongodb';
import chalk from 'chalk';

/**
 * Syncs movies from file server to flat database structure
 * @param {Object} flatDB - Flat database structure
 * @param {Object} fileServer - File server data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object>} Sync results
 */
export async function syncMovies(flatDB, fileServer, serverConfig, fieldAvailability) {
  const client = await clientPromise;
  console.log(chalk.bold.blue(`Starting movie sync to flat structure for server ${serverConfig.id}...`));
  
  const results = {
    processed: [],
    errors: [],
    initialized: { created: 0, movies: [] } // Track initialization results
  };
  
  try {
    // No file server movie data, nothing to do
    if (!fileServer?.movies) {
      console.log(chalk.yellow(`No movies found in file server ${serverConfig.id}`));
      return results;
    }
    
    // Check if we have missing movies that need to be created
    let missingMovieTitles = [];
    if (flatDB.missingMovies) {
      missingMovieTitles = flatDB.missingMovies;
    }
    
    // If we have missing movies, create them
    let newlyCreatedMovies = [];
    if (missingMovieTitles.length > 0) {
      console.log(chalk.yellow(`Found ${missingMovieTitles.length} missing movies to create before syncing`));
      const createResults = await createMissingMovies(client, missingMovieTitles, serverConfig);
      results.initialized.created = createResults.created;
      results.initialized.movies = createResults.createdMovies;
      newlyCreatedMovies = createResults.createdMovies;
    }
    
    // Create a map for faster lookups
    const flatMoviesMap = flatDB.movies.reduce((map, movie) => {
      map[movie.title] = movie;
      return map;
    }, {});
    
    // Add newly created movies to the map
    for (const newMovie of newlyCreatedMovies) {
      flatMoviesMap[newMovie.title] = newMovie;
    }
    
    // Process each movie from the file server directly
    for (const [movieTitle, fileServerMovieData] of Object.entries(fileServer.movies)) {
      try {
        // Get the movie from flat structure - it should exist now due to our initialization step
        const flatMovie = flatMoviesMap[movieTitle];
        
        if (!flatMovie) {
          continue; // Skip if the movie is not found in the flat structure
          // This should happen to movies that aren't valid in the file server
        }
        
        // Use the movie from the map or a minimal placeholder as fallback
        const movieToSync = flatMovie;
        
        // Sync different aspects of the movie
        const metadataResult = await syncMovieMetadata(client, movieToSync, fileServerMovieData, serverConfig, fieldAvailability);
        const videoURLResult = await syncMovieVideoURL(client, movieToSync, fileServerMovieData, serverConfig, fieldAvailability);
        const posterResult = await syncMoviePoster(client, movieToSync, fileServerMovieData, serverConfig, fieldAvailability);
        const backdropResult = await syncMovieBackdrop(client, movieToSync, fileServerMovieData, serverConfig, fieldAvailability);
        const blurhashResult = await syncMovieBlurhash(client, movieToSync, fileServerMovieData, serverConfig, fieldAvailability);
        const logosResult = await syncMovieLogos(client, movieToSync, fileServerMovieData, serverConfig, fieldAvailability);
        const chaptersResult = await syncMovieChapters(client, movieToSync, fileServerMovieData, serverConfig, fieldAvailability);
        const captionsResult = await syncMovieCaptions(client, movieToSync, fileServerMovieData, serverConfig, fieldAvailability);
        
        // Combine results
        const syncResults = [
          metadataResult,
          videoURLResult,
          posterResult,
          backdropResult,
          blurhashResult,
          logosResult,
          chaptersResult,
          captionsResult
        ].filter(Boolean);
        
        if (syncResults.length > 0) {
          results.processed.push({
            title: movieTitle,
            serverId: serverConfig.id,
            updates: syncResults.map(r => r.field)
          });
        }
      } catch (error) {
        results.errors.push({
          title: movieTitle,
          serverId: serverConfig.id,
          error: error.message
        });
      }
    }
    
    console.log(chalk.bold.blue(`Movie sync to flat structure complete for server ${serverConfig.id}`));
    return results;
  } catch (error) {
    console.error(`Error during movie sync to flat structure for server ${serverConfig.id}:`, error);
    results.errors.push({
      general: true,
      error: error.message,
      stack: error.stack
    });
    return results;
  }
}

export {
  syncMovieMetadata,
  syncMovieVideoURL,
  syncMoviePoster,
  syncMovieBackdrop,
  syncMovieBlurhash,
  syncMovieLogos,
  syncMovieChapters,
  syncMovieCaptions,
  createMissingMovies // Export the new function
};
