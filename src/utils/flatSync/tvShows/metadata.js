/**
 * TV show metadata sync utilities for flat structure
 */

import { filterLockedFields, isCurrentServerHighestPriorityForField, MediaType } from '../../sync/utils';
import { updateTVShowInFlatDB } from './database';
import { fetchMetadataMultiServer } from '@src/utils/admin_utils';
import { isEqual, difference } from 'lodash';

/**
 * Processes TV show metadata updates
 * @param {Object} client - MongoDB client
 * @param {Object} show - TV show object
 * @param {Object} fileServerData - File server data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object|null>} Update result or null
 */
export async function syncTVShowMetadata(client, show, fileServerData, serverConfig, fieldAvailability) {
  if (!fileServerData?.metadata) return null;
  
  const fieldPath = 'metadata';
  // Use the original title for metadata updates
  // fallback to metadata title if original title is not available
  const showTitle = show.title;
  const originalTitle = show.originalTitle;
  
  // Check if the current server has the highest priority for metadata
  const isHighestPriority = isCurrentServerHighestPriorityForField(
    fieldAvailability,
    'tv',
    originalTitle,
    fieldPath,
    serverConfig
  );
  
  if (!isHighestPriority) return null;
  
  // Fetch metadata from the server
  const showMetadata = await fetchMetadataMultiServer(
    serverConfig.id,
    fileServerData.metadata,
    'file',
    'tv',
    showTitle
  );
  
  if (!showMetadata) return null;
  
  // Compare last_updated timestamps
  const existingLastUpdated = new Date(show.metadata?.last_updated || '1970-01-01');
  const newLastUpdated = new Date(showMetadata.last_updated || '1970-01-01');
  
  if (newLastUpdated <= existingLastUpdated && show.metadataSource) return null;
  
  // Check if metadata has actually changed
  if (isEqual(show.metadata, showMetadata) && show.metadataSource === serverConfig.id) return null;

  // IMPORTANT: We need to preserve the seasons array in the TV show metadata
  // because it's the source of truth for season metadata
  
  const updateData = {
    metadata: showMetadata, // Keep the full metadata including seasons
    metadataSource: serverConfig.id
  };
  
  // Extract common metadata fields for easier querying
  if (showMetadata.name) {
    updateData.title = showMetadata.name;
  }
  
  if (showMetadata.first_air_date) {
    updateData.firstAirDate = new Date(showMetadata.first_air_date);
  }
  
  if (showMetadata.last_air_date) {
    updateData.lastAirDate = new Date(showMetadata.last_air_date);
  }
  
  if (showMetadata.status) {
    updateData.status = showMetadata.status;
  }
  
  if (showMetadata.number_of_seasons) {
    updateData.numberOfSeasons = showMetadata.number_of_seasons;
  }
  
  if (showMetadata.vote_average) {
    updateData.rating = showMetadata.vote_average;
  }
  
  if (showMetadata.overview) {
    updateData.overview = showMetadata.overview;
  }
  
  if (showMetadata.genres) {
    updateData.genres = showMetadata.genres;
  }
  
  if (showMetadata.networks) {
    updateData.networks = showMetadata.networks;
  }
  
  // Filter out locked fields
  const filteredUpdateData = filterLockedFields(show, updateData);
  
  if (Object.keys(filteredUpdateData).length === 0) return null;
  
  console.log(`TV Show: Updating metadata for "${showTitle}" from server ${serverConfig.id}`);
  
  // Update the TV show in the flat database
  await updateTVShowInFlatDB(client, originalTitle, { $set: filteredUpdateData });
  
  return {
    field: 'metadata',
    updated: true
  };
}
