/**
 * TV show logos sync utilities for flat structure
 */

import { createFullUrl, filterLockedFields, isSourceMatchingServer, isCurrentServerHighestPriorityForField, MediaType } from '../../sync/utils';
import { updateTVShowInFlatDB } from './database';
import { isEqual } from 'lodash';

/**
 * Processes TV show logo updates
 * @param {Object} client - MongoDB client
 * @param {Object} show - TV show object
 * @param {Object} fileServerData - File server data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object|null>} Update result or null
 */
export async function syncTVShowLogos(client, show, fileServerData, serverConfig, fieldAvailability) {
  if (!fileServerData?.logo) return null;
  
  const fieldPath = 'logo';
  const showTitle = show.title;
  const originalTitle = show.originalTitle;
  
  // Check if the current server has the highest priority for logo
  const isHighestPriority = isCurrentServerHighestPriorityForField(
    fieldAvailability,
    'tv',
    originalTitle,
    fieldPath,
    serverConfig
  );
  
  if (!isHighestPriority) return null;
  
  const newLogoURL = createFullUrl(fileServerData.logo, serverConfig);
  
  // Only update if the logo URL has changed
  if (isEqual(show.logo, newLogoURL) && isSourceMatchingServer(show, 'logoSource', serverConfig)) {
    return null;
  }
  
  const updateData = {
    logo: newLogoURL,
    logoSource: serverConfig.id
  };
  
  // Filter out locked fields
  const filteredUpdateData = filterLockedFields(show, updateData);
  
  if (!filteredUpdateData.logo) return null;
  
  console.log(`TV Show: Updating logo for "${showTitle}" from server ${serverConfig.id}`);
  
  // Update the TV show in the flat database
  await updateTVShowInFlatDB(client, originalTitle, { $set: filteredUpdateData });
  
  return {
    field: 'logo',
    updated: true
  };
}
