/**
 * Movie logos sync utilities for flat structure
 */

import { createLogger } from '@src/lib/logger';
import { createFullUrl, filterLockedFields, isSourceMatchingServer, isCurrentServerHighestPriorityForField, MediaType } from '../../sync/utils';
import { updateMovieInFlatDB } from './database';
import { isEqual } from 'lodash';

/**
 * Processes movie logo updates
 * @param {Object} client - MongoDB client
 * @param {Object} movie - Movie object
 * @param {Object} fileServerData - File server data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object|null>} Update result or null
 */
export async function syncMovieLogos(client, movie, fileServerData, serverConfig, fieldAvailability) {
  const log = createLogger('FlatSync.Movies.Logos');
  if (!fileServerData?.urls?.logo) return null;
  
  const fieldPath = 'urls.logo';
  const movieTitle = movie.originalTitle || movie.title;
  
  // Check if the current server has the highest priority for logo
  const isHighestPriority = isCurrentServerHighestPriorityForField(
    fieldAvailability,
    'movies',
    movieTitle,
    fieldPath,
    serverConfig
  );
  
  if (!isHighestPriority) return null;
  
  const newLogoURL = createFullUrl(fileServerData.urls.logo, serverConfig);
  
  // Only update if the logo URL has changed
  if (isEqual(movie.logo, newLogoURL) && isSourceMatchingServer(movie, 'logoSource', serverConfig)) {
    return null;
  }
  
  const updateData = {
    logo: newLogoURL,
    logoSource: serverConfig.id
  };
  
  // Filter out locked fields
  const filteredUpdateData = filterLockedFields(movie, updateData);
  
  if (!filteredUpdateData.logo) return null;
  
  log.info({
    movieTitle,
    serverId: serverConfig.id,
    field: 'logo'
  }, 'Updating movie logo');
  
  // Update the movie in the flat database
  await updateMovieInFlatDB(client, movieTitle, { $set: filteredUpdateData });
  
  return {
    field: 'logo',
    updated: true
  };
}
