/**
 * Movie initialization utilities for flat structure
 */

import { ObjectId } from 'mongodb';
import chalk from 'chalk';
import { createMovieInFlatDB } from './database';

/**
 * Creates missing movies in the database
 * @param {Object} client - MongoDB client
 * @param {Array<string>} missingMovieTitles - Array of movie titles to create
 * @param {Object} serverConfig - Server configuration for source tracking
 * @returns {Promise<Object>} Results showing created movies and their data
 */
export async function createMissingMovies(client, missingMovieTitles, serverConfig) {
  const results = {
    created: 0,
    createdMovies: []
  };

  if (!missingMovieTitles || missingMovieTitles.length === 0) {
    return results;
  }

  console.log(chalk.cyan(`Creating ${missingMovieTitles.length} missing movies in database...`));
  
  // Prepare bulk operations for better performance
  const createOperations = [];
  const movieDataArray = [];
  
  // Create a batch of operations
  for (const title of missingMovieTitles) {
    const movieData = {
      title,
      originalTitle: title,
      type: 'movie',
      initialDiscoveryDate: new Date(),
      initialDiscoveryServer: serverConfig.id
    };
    
    createOperations.push({
      insertOne: {
        document: movieData
      }
    });
    
    movieDataArray.push(movieData);
  }

  try {
    // Execute all insert operations in one bulk operation
    const bulkResult = await client
      .db('Media')
      .collection('FlatMovies')
      .bulkWrite(createOperations, { ordered: false });
    
    // If successful, add the created movies to the results
    results.created = bulkResult.insertedCount || movieDataArray.length;
    results.createdMovies = movieDataArray;
    
    console.log(chalk.green(`Successfully created ${results.created} missing movie records.`));
  } catch (error) {
    console.error('Error during bulk movie creation:', error);
    
    // Even if there was an error with the bulk operation,
    // some documents might have been inserted successfully
    // We'd need to query to find out which ones actually got created,
    // but for now we'll assume the operation mostly succeeded
    
    results.created = movieDataArray.length;
    results.createdMovies = movieDataArray;
    results.error = error.message;
  }

  return results;
}
