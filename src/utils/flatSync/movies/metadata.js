/**
 * Movie metadata sync utilities for flat structure
 */

import { filterLockedFields, isCurrentServerHighestPriorityForField, MediaType } from '../../sync/utils';
import { updateMovieInFlatDB } from './database';
import { fetchMetadataMultiServer } from '@src/utils/admin_utils';
import { isEqual } from 'lodash';

/**
 * Processes movie metadata updates
 * @param {Object} client - MongoDB client
 * @param {Object} movie - Movie object
 * @param {Object} fileServerData - File server data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object|null>} Update result or null
 */
export async function syncMovieMetadata(client, movie, fileServerData, serverConfig, fieldAvailability) {
  if (!fileServerData?.urls?.metadata) return null;
  
  const fieldPath = 'urls.metadata';
  const movieTitle = movie.originalTitle || movie.title;
  
  // Check if the current server has the highest priority for metadata
  const isHighestPriority = isCurrentServerHighestPriorityForField(
    fieldAvailability,
    'movies',
    movieTitle,
    fieldPath,
    serverConfig
  );
  
  if (!isHighestPriority) return null;
  
  // Fetch metadata from the server
  const movieMetadata = await fetchMetadataMultiServer(
    serverConfig.id,
    fileServerData.urls.metadata,
    'file',
    'movie',
    movieTitle
  );
  
  if (!movieMetadata) return null;
  
  // Ensure release_date is a Date object
  if (typeof movieMetadata.release_date === 'string') {
    movieMetadata.release_date = new Date(movieMetadata.release_date);
  }
  
  // Compare last_updated timestamps
  const existingLastUpdated = new Date(movie.metadata?.last_updated || '1970-01-01');
  const newLastUpdated = new Date(movieMetadata.last_updated || '1970-01-01');
  
  if (newLastUpdated <= existingLastUpdated && movie.metadataSource) return null;
  
  // Check if metadata has actually changed
  if (isEqual(movie.metadata, movieMetadata) && movie.metadataSource === serverConfig.id) return null;
  
  const updateData = {
    metadata: movieMetadata,
    metadataSource: serverConfig.id
  };
  
  // Filter out locked fields
  const filteredUpdateData = filterLockedFields(movie, updateData);
  
  if (Object.keys(filteredUpdateData).length === 0) return null;
  
  console.log(`Movie: Updating metadata for "${movieTitle}" from server ${serverConfig.id}`);
  
  // Update the movie in the flat database
  await updateMovieInFlatDB(client, movieTitle, { $set: filteredUpdateData });
  
  return {
    field: 'metadata',
    updated: true
  };
}
