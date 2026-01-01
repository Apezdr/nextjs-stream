/**
 * TV show blurhash sync utilities for flat structure
 */

import { createFullUrl, filterLockedFields, isSourceMatchingServer, isCurrentServerHighestPriorityForField, MediaType } from '../../sync/utils';
import { updateTVShowInFlatDB } from './database';
import { isEqual } from 'lodash';

/**
 * Processes TV show poster blurhash updates
 * @param {Object} client - MongoDB client
 * @param {Object} show - TV show object
 * @param {Object} fileServerData - File server data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object|null>} Update result or null
 */
export async function syncTVShowPosterBlurhash(client, show, fileServerData, serverConfig, fieldAvailability) {
  if (!fileServerData?.posterBlurhash) return null;
  
  const fieldPath = 'posterBlurhash';
  const showTitle = show.title;
  const originalTitle = show.originalTitle;
  
  // Check if the current server has the highest priority for posterBlurhash
  const isHighestPriority = isCurrentServerHighestPriorityForField(
    fieldAvailability,
    'tv',
    originalTitle,
    fieldPath,
    serverConfig
  );
  
  if (!isHighestPriority) return null;
  
  const newPosterBlurhashURL = createFullUrl(fileServerData.posterBlurhash, serverConfig);
  
  // Only update if the posterBlurhash URL has changed
  if (isEqual(show.posterBlurhash, newPosterBlurhashURL) && isSourceMatchingServer(show, 'posterBlurhashSource', serverConfig)) {
    return null;
  }
  
  const updateData = {
    posterBlurhash: newPosterBlurhashURL,
    posterBlurhashSource: serverConfig.id
  };
  
  // Filter out locked fields
  const filteredUpdateData = filterLockedFields(show, updateData);
  
  if (!filteredUpdateData.posterBlurhash) return null;
  
  console.log(`TV Show: Updating poster blurhash for "${showTitle}" from server ${serverConfig.id}`);
  
  // Update the TV show in the flat database
  await updateTVShowInFlatDB(client, originalTitle, { $set: filteredUpdateData });
  
  return {
    field: 'posterBlurhash',
    updated: true
  };
}

/**
 * Processes TV show backdrop blurhash updates
 * @param {Object} client - MongoDB client
 * @param {Object} show - TV show object
 * @param {Object} fileServerData - File server data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object|null>} Update result or null
 */
export async function syncTVShowBackdropBlurhash(client, show, fileServerData, serverConfig, fieldAvailability) {
  if (!fileServerData?.backdropBlurhash) return null;
  
  const fieldPath = 'backdropBlurhash';
  const showTitle = show.title;
  const originalTitle = show.originalTitle;
  
  // Check if the current server has the highest priority for backdropBlurhash
  const isHighestPriority = isCurrentServerHighestPriorityForField(
    fieldAvailability,
    'tv',
    originalTitle,
    fieldPath,
    serverConfig
  );
  
  if (!isHighestPriority) return null;
  
  const newBackdropBlurhashURL = createFullUrl(fileServerData.backdropBlurhash, serverConfig);
  
  // Only update if the backdropBlurhash URL has changed
  if (isEqual(show.backdropBlurhash, newBackdropBlurhashURL) && isSourceMatchingServer(show, 'backdropBlurhashSource', serverConfig)) {
    return null;
  }
  
  const updateData = {
    backdropBlurhash: newBackdropBlurhashURL,
    backdropBlurhashSource: serverConfig.id
  };
  
  // Filter out locked fields
  const filteredUpdateData = filterLockedFields(show, updateData);
  
  if (!filteredUpdateData.backdropBlurhash) return null;
  
  console.log(`TV Show: Updating backdrop blurhash for "${showTitle}" from server ${serverConfig.id}`);
  
  // Update the TV show in the flat database
  await updateTVShowInFlatDB(client, originalTitle, { $set: filteredUpdateData });
  
  return {
    field: 'backdropBlurhash',
    updated: true
  };
}

/**
 * Syncs TV show blurhash data
 * @param {Object} client - MongoDB client
 * @param {Object} show - TV show object
 * @param {Object} fileServerData - File server data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object|null>} Combined update result or null
 */
export async function syncTVShowBlurhash(client, show, fileServerData, serverConfig, fieldAvailability) {
  const posterResult = await syncTVShowPosterBlurhash(client, show, fileServerData, serverConfig, fieldAvailability);
  const backdropResult = await syncTVShowBackdropBlurhash(client, show, fileServerData, serverConfig, fieldAvailability);
  
  if (posterResult || backdropResult) {
    return {
      field: 'blurhash',
      updated: true
    };
  }
  
  return null;
}
