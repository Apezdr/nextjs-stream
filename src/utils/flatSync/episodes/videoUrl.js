/**
 * TV episode video URL sync utilities for flat structure
 */

import { createFullUrl, filterLockedFields, isSourceMatchingServer, isCurrentServerHighestPriorityForField, MediaType, findEpisodeFileName } from '../../sync/utils';
import { updateEpisodeInFlatDB, getEpisodeFromFlatDB } from './database';
import { getTVShowFromFlatDB } from '../tvShows/database';
import { getSeasonFromFlatDB } from '../seasons/database';
import { isEqual } from 'lodash';

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
  
  // Only update if the video URL has changed
  if (isEqual(flatEpisode.videoURL, newVideoURL) && isSourceMatchingServer(flatEpisode, 'videoSource', serverConfig)) {
    return null;
  }
  
  const updateData = {
    videoURL: newVideoURL,
    videoSource: serverConfig.id
  };
  
  // Add additional video information if available
  if (fileServerEpisodeData.mediaLastModified) {
    updateData.mediaLastModified = new Date(fileServerEpisodeData.mediaLastModified);
  }
  
  if (fileServerSeasonData.dimensions?.[episodeFileName]) {
    updateData.dimensions = fileServerSeasonData.dimensions[episodeFileName];
  }
  
  if (fileServerSeasonData.lengths?.[episodeFileName]) {
    updateData.duration = fileServerSeasonData.lengths[episodeFileName];
    updateData.length = fileServerSeasonData.lengths[episodeFileName];
  }
  
  if (fileServerEpisodeData.size) {
    updateData.size = fileServerEpisodeData.size;
  }
  
  if (fileServerEpisodeData.mediaQuality) {
    updateData.mediaQuality = fileServerEpisodeData.mediaQuality;
  }
  
  if (fileServerEpisodeData.hdr !== undefined && fileServerEpisodeData.hdr !== null) {
    updateData.hdr = fileServerEpisodeData.hdr;
  }
  
  // Filter out locked fields
  const filteredUpdateData = filterLockedFields(flatEpisode, updateData);
  
  if (!filteredUpdateData.videoURL) return null;
  
  console.log(`Episode: Updating video URL for "${showTitle}" S${season.seasonNumber}E${episode.episodeNumber} from server ${serverConfig.id}`);
  
  // Return both the status and the update data
  return {
    ...filteredUpdateData,
    field: 'videoURL',
    updated: true
  };
}
