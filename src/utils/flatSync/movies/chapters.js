/**
 * Movie chapters sync utilities for flat structure
 */

import { createLogger } from '@src/lib/logger';
import { createFullUrl, filterLockedFields, isSourceMatchingServer, isCurrentServerHighestPriorityForField, MediaType } from '../../sync/utils';
import { updateMovieInFlatDB } from './database';
import { isEqual } from 'lodash';

/**
 * Processes movie chapter updates
 * @param {Object} client - MongoDB client
 * @param {Object} movie - Movie object
 * @param {Object} fileServerData - File server data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object|null>} Update result or null
 */
export async function syncMovieChapters(client, movie, fileServerData, serverConfig, fieldAvailability) {
  const log = createLogger('FlatSync.Movies.Chapters');
  if (!fileServerData?.urls?.chapters) return null;
  
  const fieldPath = 'urls.chapters';
  const movieTitle = movie.originalTitle || movie.title;
  
  // Check if the current server has the highest priority for chapters
  const isHighestPriority = isCurrentServerHighestPriorityForField(
    fieldAvailability,
    'movies',
    movieTitle,
    fieldPath,
    serverConfig
  );
  
  if (!isHighestPriority) return null;
  
  const newChapterURL = createFullUrl(fileServerData.urls.chapters, serverConfig);
  
  // Only update if the chapter URL has changed
  if (isEqual(movie.chapterURL, newChapterURL) && isSourceMatchingServer(movie, 'chapterSource', serverConfig)) {
    return null;
  }
  
  const updateData = {
    chapterURL: newChapterURL,
    chapterSource: serverConfig.id
  };
  
  // Filter out locked fields
  const filteredUpdateData = filterLockedFields(movie, updateData);
  
  if (!filteredUpdateData.chapterURL) return null;
  
  log.info({
    movieTitle,
    serverId: serverConfig.id,
    field: 'chapters'
  }, 'Updating movie chapters');
  
  // Update the movie in the flat database
  await updateMovieInFlatDB(client, movieTitle, { $set: filteredUpdateData });
  
  return {
    field: 'chapters',
    updated: true
  };
}
