/**
 * TV show poster sync utilities for flat structure
 */

import { createFullUrl, filterLockedFields, isSourceMatchingServer, isCurrentServerHighestPriorityForField, MediaType } from '../../sync/utils';
import { updateTVShowInFlatDB } from './database';
import { isEqual } from 'lodash';

/**
 * Processes TV show poster URL updates
 * @param {Object} client - MongoDB client
 * @param {Object} show - TV show object
 * @param {Object} fileServerData - File server data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object|null>} Update result or null
 */
export async function syncTVShowPoster(client, show, fileServerData, serverConfig, fieldAvailability) {
  if (!fileServerData?.poster) return null;
  
  const fieldPath = 'poster';
  // Use the original title for poster updates
  // fallback to metadata title if original title is not available
  const showTitle = show.title;
  const originalTitle = show.originalTitle;
  
  // Check if the current server has the highest priority for posterURL
  const isHighestPriority = isCurrentServerHighestPriorityForField(
    fieldAvailability,
    'tv',
    originalTitle,
    fieldPath,
    serverConfig
  );
  
  if (!isHighestPriority) return null;
  
  const newPosterURL = createFullUrl(fileServerData.poster, serverConfig);
  
  // Only update if the poster URL has changed
  if (isEqual(show.posterURL, newPosterURL) && isSourceMatchingServer(show, 'posterSource', serverConfig)) {
    return null;
  }
  
  const updateData = {
    posterURL: newPosterURL,
    posterSource: serverConfig.id
  };
  
  // Filter out locked fields
  const filteredUpdateData = filterLockedFields(show, updateData);
  
  if (!filteredUpdateData.posterURL) return null;
  
  console.log(`TV Show: Updating poster URL for "${showTitle}" from server ${serverConfig.id}`);
  
  // Update the TV show in the flat database
  await updateTVShowInFlatDB(client, originalTitle, { $set: filteredUpdateData });
  
  return {
    field: 'posterURL',
    updated: true
  };
}
