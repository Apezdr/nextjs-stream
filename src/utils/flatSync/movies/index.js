/**
 * Movie sync utilities for flat database structure
 */

import { syncMovieMetadata } from './metadata';
import { syncMovieVideoURL } from './videoUrl';
import { syncMoviePoster } from './poster';
import { syncMovieBackdrop } from './backdrop';
import { syncMovieBlurhash, syncMovieBackdropBlurhash } from './blurhash';
import { syncMovieLogos } from './logos';
import { syncMovieChapters } from './chapters';
import { syncMovieCaptions } from './captions';
import { syncMovieVideoInfo } from './videoInfo'; // Import the new video info sync function
import { createMissingMovies } from './initialize'; // Import the new function
import clientPromise from '@src/lib/mongodb';
import chalk from 'chalk';
import { getMovieFromMemory, createMovieInMemory } from '../memoryUtils';

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

    // Check if we have enhanced data with memory lookups
    const hasEnhancedData = flatDB.lookups && flatDB.lookups.movies;
    if (hasEnhancedData) {
      console.log(chalk.green('Using enhanced in-memory lookups for movie sync'));
    } else {
      console.log(chalk.yellow('Enhanced memory lookups not available, falling back to simple map'));
    }
    
    // Create a simple map for lookups if we don't have enhanced data
    const flatMoviesMap = !hasEnhancedData ? flatDB.movies.reduce((map, movie) => {
      map[movie.title] = movie;
      return map;
    }, {}) : {};
    
    // If we have missing movies, create them
    let newlyCreatedMovies = [];
    if (missingMovieTitles.length > 0) {
      console.log(chalk.yellow(`Found ${missingMovieTitles.length} missing movies to create before syncing`));
      const createResults = await createMissingMovies(client, missingMovieTitles, serverConfig);
      results.initialized.created = createResults.created;
      results.initialized.movies = createResults.createdMovies;
      newlyCreatedMovies = createResults.createdMovies;

      // If we have created new movies, add them to the results
      if (newlyCreatedMovies.length > 0) {
        // If we have enhanced data, also update the in-memory structure
        if (hasEnhancedData) {
          console.log(chalk.green(`Updating in-memory structure with ${newlyCreatedMovies.length} newly created movies`));
          for (const newMovie of newlyCreatedMovies) {
            createMovieInMemory(flatDB, newMovie);
          }
        } else {
          // Add to the simple map for non-enhanced lookups
          for (const newMovie of newlyCreatedMovies) {
            flatMoviesMap[newMovie.title] = newMovie;
          }
        }
      }
    }
    
    // Create a map to track newly created movies for notification purposes
    const newlyCreatedMoviesMap = new Map();
    if (newlyCreatedMovies.length > 0) {
      for (const movie of newlyCreatedMovies) {
        newlyCreatedMoviesMap.set(movie.title, movie);
      }
    }

    // Process each movie from the file server directly
    for (const [movieTitle, fileServerMovieData] of Object.entries(fileServer.movies)) {
      try {
        // Get the movie from memory or map, depending on what's available
        let flatMovie;
        
        if (hasEnhancedData) {
          // Try to get from memory first by title, then by original title if needed
          flatMovie = getMovieFromMemory(flatDB, movieTitle);
          
          // If not found, it could be indexed by original title
          if (!flatMovie) {
            flatMovie = getMovieFromMemory(flatDB, movieTitle, true);
            if (!flatMovie) {
            // Use the simple map lookup as a fallback
            flatMovie = flatMoviesMap[movieTitle];
            }
          }
        } else {
          // Use the simple map lookup
          flatMovie = flatMoviesMap[movieTitle];
        }
        
        if (!flatMovie) {
          console.log(chalk.yellow(`Movie "${movieTitle}" not found in flat structure, skipping`));
          continue; // Skip if the movie is not found in the flat structure
        }
        
        // Use the movie for syncing
        const movieToSync = flatMovie;
        
        // Check if this was a newly created movie
        const isNewlyCreated = newlyCreatedMoviesMap.has(movieTitle);
        const newlyCreatedMovie = isNewlyCreated ? newlyCreatedMoviesMap.get(movieTitle) : null;
        
        // Sync different aspects of the movie
        const metadataResult = await syncMovieMetadata(client, movieToSync, fileServerMovieData, serverConfig, fieldAvailability);
        const videoURLResult = await syncMovieVideoURL(client, movieToSync, fileServerMovieData, serverConfig, fieldAvailability);
        const posterResult = await syncMoviePoster(client, movieToSync, fileServerMovieData, serverConfig, fieldAvailability);
        const backdropResult = await syncMovieBackdrop(client, movieToSync, fileServerMovieData, serverConfig, fieldAvailability);
        //const posterBlurhashResult = await syncMovieBlurhash(client, movieToSync, fileServerMovieData, serverConfig, fieldAvailability);
        //const backdropBlurhashResult = await syncMovieBackdropBlurhash(client, movieToSync, fileServerMovieData, serverConfig, fieldAvailability);
        const logosResult = await syncMovieLogos(client, movieToSync, fileServerMovieData, serverConfig, fieldAvailability);
        const chaptersResult = await syncMovieChapters(client, movieToSync, fileServerMovieData, serverConfig, fieldAvailability);
        const captionsResult = await syncMovieCaptions(client, movieToSync, fileServerMovieData, serverConfig, fieldAvailability);
        const videoInfoResult = await syncMovieVideoInfo(client, movieToSync, fileServerMovieData, serverConfig, fieldAvailability); // Call the new function
        
        // Combine results
        const syncResults = [
          metadataResult,
          videoURLResult,
          posterResult,
          backdropResult,
          //posterBlurhashResult,
          backdropBlurhashResult,
          logosResult,
          chaptersResult,
          captionsResult,
          videoInfoResult // Add the result to the array
        ].filter(Boolean);
        
        if (syncResults.length > 0 || isNewlyCreated) {
          const movieResult = {
            title: movieTitle,
            serverId: serverConfig.id,
            updates: syncResults.map(r => r.field),
            _id: movieToSync._id
          };
          
          // Add creation information for newly created movies
          if (isNewlyCreated && newlyCreatedMovie) {
            movieResult.created = true;
            movieResult.createdAt = newlyCreatedMovie.createdAt;
            movieResult.isNew = true;
          }
          
          results.processed.push(movieResult);
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
  syncMovieBackdropBlurhash,
  syncMovieLogos,
  syncMovieChapters,
  syncMovieCaptions,
  syncMovieVideoInfo, // Export the new function
  createMissingMovies
};
