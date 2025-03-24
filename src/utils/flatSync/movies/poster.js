/**
 * Movie poster sync utilities for flat structure
 */

import { createFullUrl, filterLockedFields, isSourceMatchingServer, isCurrentServerHighestPriorityForField, MediaType } from '../../sync/utils';
import { updateMovieInFlatDB } from './database';
import { isEqual } from 'lodash';

/**
 * Processes movie poster URL updates
 * @param {Object} client - MongoDB client
 * @param {Object} movie - Movie object
 * @param {Object} fileServerData - File server data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object|null>} Update result or null
 */
export async function syncMoviePoster(client, movie, fileServerData, serverConfig, fieldAvailability) {
  if (!fileServerData?.urls?.poster) return null;
  
  const fieldPath = 'urls.poster';
  const movieTitle = movie.originalTitle || movie.title;
  
  // Check if the current server has the highest priority for posterURL
  const isHighestPriority = isCurrentServerHighestPriorityForField(
    fieldAvailability,
    'movies',
    movieTitle,
    fieldPath,
    serverConfig
  );
  
  if (!isHighestPriority) return null;
  
  const newPosterURL = createFullUrl(fileServerData.urls.poster, serverConfig);
  
  // Only update if the poster URL has changed
  if (isEqual(movie.posterURL, newPosterURL) && isSourceMatchingServer(movie, 'posterSource', serverConfig)) {
    return null;
  }
  
  const updateData = {
    posterURL: newPosterURL,
    posterSource: serverConfig.id
  };
  
  // Filter out locked fields
  const filteredUpdateData = filterLockedFields(movie, updateData);
  
  if (!filteredUpdateData.posterURL) return null;
  
  console.log(`Movie: Updating poster URL for "${movieTitle}" from server ${serverConfig.id}`);
  
  // Update the movie in the flat database
  await updateMovieInFlatDB(client, movieTitle, { $set: filteredUpdateData });
  
  return {
    field: 'posterURL',
    updated: true
  };
}
