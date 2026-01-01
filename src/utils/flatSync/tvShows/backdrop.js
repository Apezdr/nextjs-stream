/**
 * TV show backdrop sync utilities for flat structure
 */

import { createFullUrl, filterLockedFields, isSourceMatchingServer, isCurrentServerHighestPriorityForField, MediaType } from '../../sync/utils';
import { updateTVShowInFlatDB } from './database';
import { isEqual } from 'lodash';

/**
 * Processes TV show backdrop updates
 * @param {Object} client - MongoDB client
 * @param {Object} show - TV show object
 * @param {Object} fileServerData - File server data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object|null>} Update result or null
 */
export async function syncTVShowBackdrop(client, show, fileServerData, serverConfig, fieldAvailability) {
  if (!fileServerData?.backdrop) return null;
  
  const fieldPath = 'backdrop';
  // Use the original title for backdrop updates
  // fallback to metadata title if original title is not available
  const showTitle = show.title;
  const originalTitle = show.originalTitle;
  
  // Check if the current server has the highest priority for backdrop
  const isHighestPriority = isCurrentServerHighestPriorityForField(
    fieldAvailability,
    'tv',
    originalTitle,
    fieldPath,
    serverConfig
  );
  
  if (!isHighestPriority) return null;
  
  const newBackdropURL = createFullUrl(fileServerData.backdrop, serverConfig);
  
  // Only update if the backdrop URL has changed
  if (isEqual(show.backdrop, newBackdropURL) && isSourceMatchingServer(show, 'backdropSource', serverConfig)) {
    return null;
  }
  
  const updateData = {
    backdrop: newBackdropURL,
    backdropSource: serverConfig.id
  };
  
  // Filter out locked fields
  const filteredUpdateData = filterLockedFields(show, updateData);
  
  if (!filteredUpdateData.backdrop) return null;
  
  console.log(`TV Show: Updating backdrop for "${showTitle}" from server ${serverConfig.id}`);
  
  // Update the TV show in the flat database
  await updateTVShowInFlatDB(client, originalTitle, { $set: filteredUpdateData });
  
  return {
    field: 'backdrop',
    updated: true
  };
}
