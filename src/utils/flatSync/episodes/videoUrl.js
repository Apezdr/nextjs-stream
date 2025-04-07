/**
 * TV episode video URL sync utilities for flat structure
 */

import { createFullUrl, filterLockedFields, isSourceMatchingServer, isCurrentServerHighestPriorityForField, MediaType, findEpisodeFileName } from '../../sync/utils';
import { isEqual } from 'lodash';
import { generateNormalizedVideoId } from '../../flatDatabaseUtils';

/**
 * Processes TV episode video URL updates
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
export async function syncEpisodeVideoURL(client, show, season, episode, flatShow, flatSeason, flatEpisode, fileServerSeasonData, serverConfig, fieldAvailability) {
  const episodeFileName = findEpisodeFileName(
    Object.keys(fileServerSeasonData.episodes || {}),
    season.seasonNumber,
    episode.episodeNumber
  );
  
  if (!episodeFileName) {
    console.warn(`Episode: Episode file name not found for "${show.title}" S${season.seasonNumber}E${episode.episodeNumber}`);
    return null;
  }
  
  const fileServerEpisodeData = fileServerSeasonData.episodes[episodeFileName];
  if (!fileServerEpisodeData?.videoURL) return null;
  
  const fieldPath = `seasons.Season ${season.seasonNumber}.episodes.${episodeFileName}.videoURL`;
  const showTitle = show.title;
  const originalTitle = show.originalTitle;
  
  // Check if the current server has the highest priority for videoURL
  const isHighestPriority = isCurrentServerHighestPriorityForField(
    fieldAvailability,
    'tv',
    originalTitle,
    fieldPath,
    serverConfig
  );
  
  if (!isHighestPriority) return null;
  
  const newVideoURL = createFullUrl(fileServerEpisodeData.videoURL, serverConfig);
  
  // Primary logic: Check if the videoURL and source match
  // If they match, we don't need to update the URL itself
  const skipUrlUpdate = isEqual(flatEpisode.videoURL, newVideoURL) &&
                       isSourceMatchingServer(flatEpisode, 'videoSource', serverConfig);
  
  if (skipUrlUpdate) {
    // Note: Even if URL doesn't need to update, videoInfo.js will separately handle
    // any needed metadata updates through its own sync function
    return null;
  }
  
  // Generate normalized video ID for consistent lookups across URL variations
  const normalizedVideoId = generateNormalizedVideoId(newVideoURL);
  
  const updateData = {
    videoURL: newVideoURL,
    videoSource: serverConfig.id,
    normalizedVideoId // Add normalized ID for reliable lookups regardless of URL encoding
  };
  
  // Filter out locked fields
  const filteredUpdateData = filterLockedFields(flatEpisode, updateData);
  
  if (!filteredUpdateData.videoURL) return null;
  
  console.log(`Episode: Updating video URL for "${showTitle}" S${season.seasonNumber}E${episode.episodeNumber} from server ${serverConfig.id}`);
  // Note: Related metadata fields are included here for convenience, but the primary
  // purpose of this function is to update the video URL itself
  
  // Return both the status and the update data
  return {
    ...filteredUpdateData,
    field: 'videoURL',
    updated: true
  };
}
