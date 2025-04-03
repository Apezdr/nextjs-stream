/**
 * Movie video URL sync utilities for flat structure
 */

import { createFullUrl, filterLockedFields, isSourceMatchingServer, isCurrentServerHighestPriorityForField, MediaType } from '../../sync/utils';
import { updateMovieInFlatDB } from './database';
import { isEqual } from 'lodash';

/**
 * Processes movie video URL updates
 * @param {Object} client - MongoDB client
 * @param {Object} movie - Movie object
 * @param {Object} fileServerData - File server data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object|null>} Update result or null
 */
export async function syncMovieVideoURL(client, movie, fileServerData, serverConfig, fieldAvailability) {
  if (!fileServerData?.urls?.mp4) return null;
  
  const fieldPath = 'urls.mp4';
  const movieTitle = movie.originalTitle || movie.title;
  
  // Check if the current server has the highest priority for videoURL
  const isHighestPriority = isCurrentServerHighestPriorityForField(
    fieldAvailability,
    'movies',
    movieTitle,
    fieldPath,
    serverConfig
  );
  
  if (!isHighestPriority) return null;
  
  const newVideoURL = createFullUrl(fileServerData.urls.mp4, serverConfig);
  
  // Only update if the video URL has changed
  if (isEqual(movie.videoURL, newVideoURL) && isSourceMatchingServer(movie, 'videoSource', serverConfig)) {
    return null;
  }
  
  const updateData = {
    videoURL: newVideoURL,
    videoSource: serverConfig.id
    // Video info like dimensions, duration, mediaLastModified is handled by videoInfo.js
  };
  
  // Filter out locked fields
  const filteredUpdateData = filterLockedFields(movie, updateData);
  
  if (!filteredUpdateData.videoURL) return null;
  
  console.log(`Movie: Updating video URL for "${movieTitle}" from server ${serverConfig.id}`);
  
  // Update the movie in the flat database
  await updateMovieInFlatDB(client, movieTitle, { $set: filteredUpdateData });
  
  return {
    field: 'videoURL',
    updated: true
  };
}
