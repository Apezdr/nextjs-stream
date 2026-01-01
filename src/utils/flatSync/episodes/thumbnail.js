/**
 * TV episode thumbnail sync utilities for flat structure
 */

import { createFullUrl, filterLockedFields, isSourceMatchingServer, isCurrentServerHighestPriorityForField, MediaType, findEpisodeFileName } from '../../sync/utils';
import { isEqual } from 'lodash';
import { fetchMetadataMultiServer } from '@src/utils/admin_utils';

/**
 * Processes TV episode thumbnail updates
 * @param {Object} client - MongoDB client
 * @param {Object} show - TV show object
 * @param {Object} season - Season object from current database
 * @param {Object} episode - Episode object from current database
 * @param {Object} flatShow - Flat show object from flat database
 * @param {Object} flatSeason - Flat season object from flat database
 * @param {Object} flatEpisode - Flat episode object from flat database
 * @param {Object} fileServerSeasonData - File server season data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object|null>} Update result or null
 */
export async function syncEpisodeThumbnail(client, show, season, episode, flatShow, flatSeason, flatEpisode, fileServerSeasonData, serverConfig, fieldAvailability) {
  const episodeFileName = findEpisodeFileName(
    Object.keys(fileServerSeasonData.episodes || {}),
    season.seasonNumber,
    episode.episodeNumber
  );
  
  if (!episodeFileName) return null;
  
  const fileServerEpisodeData = fileServerSeasonData.episodes[episodeFileName];
  if (!fileServerEpisodeData?.thumbnail) return null;
  
  const fieldPath = `seasons.Season ${season.seasonNumber}.episodes.${episodeFileName}.thumbnail`;
  const showTitle = show.title;
  const originalTitle = show.originalTitle;
  
  // Check if the current server has the highest priority for thumbnail
  const isHighestPriority = isCurrentServerHighestPriorityForField(
    fieldAvailability,
    'tv',
    originalTitle,
    fieldPath,
    serverConfig
  );
  
  if (!isHighestPriority) return null;
  
  const newThumbnailURL = createFullUrl(fileServerEpisodeData.thumbnail, serverConfig);
  
  // Only update if the thumbnail URL has changed
  if (isEqual(flatEpisode.thumbnail, newThumbnailURL) && isSourceMatchingServer(flatEpisode, 'thumbnailSource', serverConfig)) {
    return null;
  }
  
  const updateData = {
    thumbnail: newThumbnailURL,
    thumbnailSource: serverConfig.id
  };
  
  // Filter out locked fields
  const filteredUpdateData = filterLockedFields(flatEpisode, updateData);
  
  if (!filteredUpdateData.thumbnail) return null;
  
  console.log(`Episode: Updating thumbnail for "${showTitle}" S${season.seasonNumber}E${episode.episodeNumber} from server ${serverConfig.id}`);
  
  // Return both the status and the update data
  return {
    ...filteredUpdateData,
    field: 'thumbnail',
    updated: true
  };
}

/**
 * Processes TV episode thumbnail blurhash updates
 * @param {Object} client - MongoDB client
 * @param {Object} show - TV show object
 * @param {Object} season - Season object from current database
 * @param {Object} episode - Episode object from current database
 * @param {Object} flatShow - Flat show object from flat database
 * @param {Object} flatSeason - Flat season object from flat database
 * @param {Object} flatEpisode - Flat episode object from flat database
 * @param {Object} fileServerSeasonData - File server season data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object|null>} Update result or null
 */
export async function syncEpisodeThumbnailBlurhash(client, show, season, episode, flatShow, flatSeason, flatEpisode, fileServerSeasonData, serverConfig, fieldAvailability) {
  const episodeFileName = findEpisodeFileName(
    Object.keys(fileServerSeasonData.episodes || {}),
    season.seasonNumber,
    episode.episodeNumber
  );
  
  if (!episodeFileName) return null;
  
  const fileServerEpisodeData = fileServerSeasonData.episodes[episodeFileName];
  if (!fileServerEpisodeData?.thumbnailBlurhash) return null;
  
  const fieldPath = `seasons.Season ${season.seasonNumber}.episodes.${episodeFileName}.thumbnailBlurhash`;
  const showTitle = show.title;
  const originalTitle = show.originalTitle;
  
  // Check if the current server has the highest priority for thumbnailBlurhash
  const isHighestPriority = isCurrentServerHighestPriorityForField(
    fieldAvailability,
    'tv',
    originalTitle,
    fieldPath,
    serverConfig
  );
  
  if (!isHighestPriority) return null;
  
  const thumbnailBlurhashURL = createFullUrl(fileServerEpisodeData.thumbnailBlurhash, serverConfig);
  
  // Fetch the actual blurhash data using the URL
  const thumbnailBlurhash = await fetchMetadataMultiServer(
    serverConfig.id,
    thumbnailBlurhashURL,
    'blurhash',
    'tv',
    originalTitle
  );
  
  // Only update if we got a valid blurhash and it's different from the current one
  if (!thumbnailBlurhash || (flatEpisode.thumbnailBlurhash === thumbnailBlurhash && 
      isSourceMatchingServer(flatEpisode, 'thumbnailBlurhashSource', serverConfig))) {
    return null;
  }
  
  const updateData = {
    thumbnailBlurhash: thumbnailBlurhash,
    thumbnailBlurhashSource: serverConfig.id,
    // Store additional metadata in blurhash subobject for consistency with other entities
    'blurhash.thumbnailFileHash': fileServerEpisodeData.thumbnailBlurhash,
    'blurhash.thumbnailBlurhashSource': serverConfig.id,
    'blurhash.updatedAt': new Date()
  };
  
  // Filter out locked fields
  const filteredUpdateData = filterLockedFields(flatEpisode, updateData);
  
  if (!filteredUpdateData.thumbnailBlurhash) return null;
  
  console.log(`Episode: Updating thumbnail blurhash for "${showTitle}" S${season.seasonNumber}E${episode.episodeNumber} from server ${serverConfig.id}`);
  
  // Return both the status and the update data
  return {
    ...filteredUpdateData,
    field: 'thumbnailBlurhash',
    updated: true
  };
}
