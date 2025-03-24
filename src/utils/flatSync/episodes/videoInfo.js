/**
 * TV episode video info sync utilities for flat structure
 */

import { filterLockedFields, isCurrentServerHighestPriorityForField, findEpisodeFileName } from '../../sync/utils';
import { isEqual } from 'lodash';

/**
 * Checks if the video info fields in the file server data have the highest priority
 * @param {Object} fieldAvailability - Field availability map
 * @param {string} originalTitle - Original title of the show
 * @param {Object} fileServerEpisodeData - Episode data from file server
 * @param {Object} fileServerSeasonData - Season data from file server
 * @param {string} episodeFileName - Episode file name
 * @param {number} seasonNumber - Season number
 * @param {Object} serverConfig - Server configuration
 * @returns {boolean} Whether any video info field has the highest priority
 */
export function hasHighestPriorityForAnyVideoInfoField(
  fieldAvailability,
  originalTitle,
  fileServerEpisodeData,
  fileServerSeasonData,
  episodeFileName,
  seasonNumber,
  serverConfig
) {
  // Define all the video info fields to check
  const videoInfoFields = [
    `seasons.Season ${seasonNumber}.dimensions.${episodeFileName}`,
    `seasons.Season ${seasonNumber}.lengths.${episodeFileName}`,
    `seasons.Season ${seasonNumber}.episodes.${episodeFileName}.hdr`,
    `seasons.Season ${seasonNumber}.episodes.${episodeFileName}.additionalMetadata.size`,
    `seasons.Season ${seasonNumber}.episodes.${episodeFileName}.mediaQuality.format`,
    `seasons.Season ${seasonNumber}.episodes.${episodeFileName}.mediaQuality.bitDepth`,
    `seasons.Season ${seasonNumber}.episodes.${episodeFileName}.mediaQuality.colorSpace`,
    `seasons.Season ${seasonNumber}.episodes.${episodeFileName}.mediaQuality.transferCharacteristics`,
    `seasons.Season ${seasonNumber}.episodes.${episodeFileName}.mediaQuality.isHDR`,
    `seasons.Season ${seasonNumber}.episodes.${episodeFileName}.mediaQuality.viewingExperience.enhancedColor`,
    `seasons.Season ${seasonNumber}.episodes.${episodeFileName}.mediaQuality.viewingExperience.highDynamicRange`,
    `seasons.Season ${seasonNumber}.episodes.${episodeFileName}.mediaQuality.viewingExperience.dolbyVision`,
    `seasons.Season ${seasonNumber}.episodes.${episodeFileName}.mediaQuality.viewingExperience.hdr10Plus`,
    `seasons.Season ${seasonNumber}.episodes.${episodeFileName}.mediaQuality.viewingExperience.standardHDR`
  ];
  
  // Check if any field has the highest priority
  return videoInfoFields.some(field => 
    isCurrentServerHighestPriorityForField(
      fieldAvailability,
      'tv',
      originalTitle,
      field,
      serverConfig
    )
  );
}

/**
 * Compares existing video info with new video info to determine if an update is needed
 * @param {Object} flatEpisode - Flat episode object from flat database
 * @param {Object} videoInfo - Extracted video info
 * @param {string} serverId - Server ID
 * @returns {boolean} Whether an update is needed
 */
export function needsVideoInfoUpdate(flatEpisode, videoInfo, serverId) {
  // Check if dimensions have changed
  if (videoInfo.dimensions && !isEqual(flatEpisode.dimensions, videoInfo.dimensions)) {
    return true;
  }
  
  // Check if duration/length has changed
  if (videoInfo.duration && (flatEpisode.duration !== videoInfo.duration || flatEpisode.length !== videoInfo.duration)) {
    return true;
  }
  
  // Check if HDR has changed
  if (videoInfo.hdr !== undefined && flatEpisode.hdr !== videoInfo.hdr) {
    return true;
  }
  
  // Check if size has changed
  if (videoInfo.size && flatEpisode.size !== videoInfo.size) {
    return true;
  }
  
  // Check if mediaQuality has changed
  if (videoInfo.mediaQuality && !isEqual(flatEpisode.mediaQuality, videoInfo.mediaQuality)) {
    return true;
  }
  
  // Check if videoInfoSource has changed
  if (flatEpisode.videoInfoSource !== serverId) {
    return true;
  }
  
  return false;
}

/**
 * Processes TV episode video info updates
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
export async function syncEpisodeVideoInfo(
  client,
  show,
  season,
  episode,
  flatShow,
  flatSeason,
  flatEpisode,
  fileServerSeasonData,
  serverConfig,
  fieldAvailability
) {
  const episodeFileName = findEpisodeFileName(
    Object.keys(fileServerSeasonData.episodes || {}),
    season.seasonNumber,
    episode.episodeNumber
  );
  
  if (!episodeFileName) {
    return null;
  }
  
  const fileServerEpisodeData = fileServerSeasonData.episodes[episodeFileName];
  if (!fileServerEpisodeData || !fileServerEpisodeData.mediaQuality) return null;
  
  const showTitle = show.title;
  const originalTitle = show.originalTitle;
  
  // Check if this server has highest priority for any video info field
  const hasHighestPriority = hasHighestPriorityForAnyVideoInfoField(
    fieldAvailability,
    originalTitle,
    fileServerEpisodeData,
    fileServerSeasonData,
    episodeFileName,
    season.seasonNumber,
    serverConfig
  );
  
  if (!hasHighestPriority) return null;
  
  // Extract video info
  const videoInfo = {
    videoInfoSource: serverConfig.id
  };
  
  // Only copy specific video quality fields
  if (fileServerEpisodeData.mediaQuality) {
    videoInfo.mediaQuality = fileServerEpisodeData.mediaQuality;
  }
  
  if (fileServerEpisodeData.hdr !== undefined && fileServerEpisodeData.hdr !== null) {
    videoInfo.hdr = fileServerEpisodeData.hdr;
  }
  
  if (fileServerSeasonData.dimensions?.[episodeFileName]) {
    videoInfo.dimensions = fileServerSeasonData.dimensions[episodeFileName];
  }

  if (fileServerSeasonData.lengths?.[episodeFileName]) {
    videoInfo.duration = fileServerSeasonData.lengths[episodeFileName];
    videoInfo.length = fileServerSeasonData.lengths[episodeFileName];
  }
  
  if (fileServerEpisodeData.size) {
    videoInfo.size = fileServerEpisodeData.size;
  }

  if (fileServerEpisodeData.mediaLastModified) {
    videoInfo.mediaLastModified = new Date(fileServerEpisodeData.mediaLastModified);
  }
  
  // Check if we need to update
  if (!needsVideoInfoUpdate(flatEpisode, videoInfo, serverConfig.id)) {
    return null;
  }
  
  // Filter out locked fields
  const filteredUpdateData = filterLockedFields(flatEpisode, videoInfo);
  
  if (Object.keys(filteredUpdateData).length === 0) return null;
  
  console.log(`Episode: Updating video info for "${showTitle}" S${season.seasonNumber}E${episode.episodeNumber} from server ${serverConfig.id}`);
  
  // Return both the status and the update data
  return {
    ...filteredUpdateData,
    field: 'videoInfo',
    updated: true
  };
}
