/**
 * Movie blurhash sync utilities for flat structure
 */

import { createFullUrl, filterLockedFields, isSourceMatchingServer, isCurrentServerHighestPriorityForField, MediaType } from '../../sync/utils';
import { updateMovieInFlatDB } from './database';
import { isEqual } from 'lodash';

/**
 * Processes movie poster blurhash updates
 * @param {Object} client - MongoDB client
 * @param {Object} movie - Movie object
 * @param {Object} fileServerData - File server data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object|null>} Update result or null
 */
export async function syncMovieBlurhash(client, movie, fileServerData, serverConfig, fieldAvailability) {
  // Process poster blurhash
  if (!fileServerData?.urls?.posterBlurhash) return null;
  
  const fieldPath = 'urls.posterBlurhash';
  const movieTitle = movie.originalTitle || movie.title;
  
  // Check if the current server has the highest priority for posterBlurhash
  const isHighestPriority = isCurrentServerHighestPriorityForField(
    fieldAvailability,
    'movies',
    movieTitle,
    fieldPath,
    serverConfig
  );
  
  if (!isHighestPriority) return null;
  
  const newPosterBlurhashURL = createFullUrl(fileServerData.urls.posterBlurhash, serverConfig);
  
  // Only update if the posterBlurhash URL has changed
  if (isEqual(movie.posterBlurhash, newPosterBlurhashURL) && isSourceMatchingServer(movie, 'posterBlurhashSource', serverConfig)) {
    return null;
  }
  
  const updateData = {
    posterBlurhash: newPosterBlurhashURL,
    posterBlurhashSource: serverConfig.id
  };
  
  // Filter out locked fields
  const filteredUpdateData = filterLockedFields(movie, updateData);
  
  if (!filteredUpdateData.posterBlurhash) return null;
  
  console.log(`Movie: Updating poster blurhash for "${movieTitle}" from server ${serverConfig.id}`);
  
  // Update the movie in the flat database
  await updateMovieInFlatDB(client, movieTitle, { $set: filteredUpdateData });
  
  return {
    field: 'posterBlurhash',
    updated: true
  };
}

/**
 * Processes movie backdrop blurhash updates
 * @param {Object} client - MongoDB client
 * @param {Object} movie - Movie object
 * @param {Object} fileServerData - File server data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object|null>} Update result or null
 */
export async function syncMovieBackdropBlurhash(client, movie, fileServerData, serverConfig, fieldAvailability) {
  // Process backdrop blurhash
  if (!fileServerData?.urls?.backdropBlurhash) return null;
  
  const fieldPath = 'urls.backdropBlurhash';
  const movieTitle = movie.originalTitle || movie.title;
  
  // Check if the current server has the highest priority for backdropBlurhash
  const isHighestPriority = isCurrentServerHighestPriorityForField(
    fieldAvailability,
    'movies',
    movieTitle,
    fieldPath,
    serverConfig
  );
  
  if (!isHighestPriority) return null;
  
  const newBackdropBlurhashURL = createFullUrl(fileServerData.urls.backdropBlurhash, serverConfig);
  
  // Only update if the backdropBlurhash URL has changed
  if (isEqual(movie.backdropBlurhash, newBackdropBlurhashURL) && isSourceMatchingServer(movie, 'backdropBlurhashSource', serverConfig)) {
    return null;
  }
  
  const updateData = {
    backdropBlurhash: newBackdropBlurhashURL,
    backdropBlurhashSource: serverConfig.id
  };
  
  // Filter out locked fields
  const filteredUpdateData = filterLockedFields(movie, updateData);
  
  if (!filteredUpdateData.backdropBlurhash) return null;
  
  console.log(`Movie: Updating backdrop blurhash for "${movieTitle}" from server ${serverConfig.id}`);
  
  // Update the movie in the flat database
  await updateMovieInFlatDB(client, movieTitle, { $set: filteredUpdateData });
  
  return {
    field: 'backdropBlurhash',
    updated: true
  };
}
