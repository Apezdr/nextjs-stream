/**
 * Movie database operations for flat structure
 */

import { ObjectId } from 'mongodb';
import { createLogger, logError } from '@src/lib/logger';

/**
 * Updates a movie in the flat database structure
 * @param {Object} client - MongoDB client
 * @param {string} title - Movie title from the file server
 * @param {Object} updates - Update operations
 * @returns {Promise<Object>} Update result
 */
export async function updateMovieInFlatDB(client, title, updates) {
  const log = createLogger('FlatSync.Movies.Database');
  try {
    const result = await client
      .db('Media')
      .collection('FlatMovies')
      .updateOne({ originalTitle: title }, updates, { upsert: true });
    
    return result;
  } catch (error) {
    logError(log, error, {
      title,
      context: 'update_movie_failed'
    });
    return { error };
  }
}

/**
 * Gets a movie from the flat database structure
 * @param {Object} client - MongoDB client
 * @param {string} title - Movie title from the file server
 * @returns {Promise<Object|null>} Movie document or null
 */
export async function getMovieFromFlatDB(client, title) {
  const log = createLogger('FlatSync.Movies.Database');
  try {
    return await client
      .db('Media')
      .collection('FlatMovies')
      .findOne({ originalTitle: title });
  } catch (error) {
    logError(log, error, {
      title,
      context: 'get_movie_failed'
    });
    return null;
  }
}

/**
 * Creates a new movie in the flat database structure
 * @param {Object} client - MongoDB client
 * @param {Object} movieData - Movie data
 * @returns {Promise<Object>} Insert result
 */
export async function createMovieInFlatDB(client, movieData) {
  const log = createLogger('FlatSync.Movies.Database');
  try {
    // Ensure the movie has an _id
    if (!movieData._id) {
      movieData._id = new ObjectId();
    }
    
    // Ensure the movie has a type
    if (!movieData.type) {
      movieData.type = 'movie';
    }
    
    // Set originalTitle to the initial title if not already set
    if (!movieData.originalTitle && movieData.title) {
      movieData.originalTitle = movieData.title;
    }
    
    const result = await client
      .db('Media')
      .collection('FlatMovies')
      .insertOne(movieData);
    
    return result;
  } catch (error) {
    logError(log, error, {
      title: movieData.title,
      context: 'create_movie_failed'
    });
    return { error };
  }
}
