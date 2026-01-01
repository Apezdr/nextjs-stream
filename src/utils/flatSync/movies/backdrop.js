/**
 * Movie backdrop sync utilities for flat structure
 */

import { createFullUrl, filterLockedFields, isSourceMatchingServer, isCurrentServerHighestPriorityForField, MediaType } from '../../sync/utils';
import { updateMovieInFlatDB } from './database';
import { isEqual } from 'lodash';

/**
 * Processes movie backdrop updates
 * @param {Object} client - MongoDB client
 * @param {Object} movie - Movie object
 * @param {Object} fileServerData - File server data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object|null>} Update result or null
 */
export async function syncMovieBackdrop(client, movie, fileServerData, serverConfig, fieldAvailability) {
  if (!fileServerData?.urls?.backdrop) return null;
  
  const fieldPath = 'urls.backdrop';
  const movieTitle = movie.originalTitle || movie.title;
  
  // Check if the current server has the highest priority for backdrop
  const isHighestPriority = isCurrentServerHighestPriorityForField(
    fieldAvailability,
    'movies',
    movieTitle,
    fieldPath,
    serverConfig
  );
  
  if (!isHighestPriority) return null;
  
  const newBackdropURL = createFullUrl(fileServerData.urls.backdrop, serverConfig);
  
  // Only update if the backdrop URL has changed
  if (isEqual(movie.backdrop, newBackdropURL) && isSourceMatchingServer(movie, 'backdropSource', serverConfig)) {
    return null;
  }
  
  const updateData = {
    backdrop: newBackdropURL,
    backdropSource: serverConfig.id
  };
  
  // Filter out locked fields
  const filteredUpdateData = filterLockedFields(movie, updateData);
  
  if (!filteredUpdateData.backdrop) return null;
  
  console.log(`Movie: Updating backdrop for "${movieTitle}" from server ${serverConfig.id}`);
  
  // Update the movie in the flat database
  await updateMovieInFlatDB(client, movieTitle, { $set: filteredUpdateData });
  
  return {
    field: 'backdrop',
    updated: true
  };
}
