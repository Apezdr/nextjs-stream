/**
 * Movie video info sync utilities for flat structure
 */

import { filterLockedFields, isCurrentServerHighestPriorityForField } from '../../sync/utils';
import { updateMovieInFlatDB } from './database';
import { isEqual } from 'lodash';

/**
 * Checks if the video info fields in the file server data have the highest priority
 * @param {Object} fieldAvailability - Field availability map
 * @param {string} movieTitle - Original title of the movie
 * @param {Object} fileServerData - Movie data from file server
 * @param {Object} serverConfig - Server configuration
 * @returns {boolean} Whether any video info field has the highest priority
 */
export function hasHighestPriorityForAnyVideoInfoField(
  fieldAvailability,
  movieTitle,
  fileServerData,
  serverConfig
) {
  // Define all the video info fields to check for movies
  // Note: Paths are relative to the movie entry in fileServerData
  const videoInfoFields = [
    'dimensions', // Assuming dimensions are stored directly or keyed (e.g., by quality)
    'length',     // Assuming length is stored directly or keyed
    'hdr',
    'additionalMetadata.size',
    'mediaQuality.format',
    'mediaQuality.bitDepth',
    'mediaQuality.colorSpace',
    'mediaQuality.transferCharacteristics',
    'mediaQuality.isHDR',
    'mediaQuality.viewingExperience.enhancedColor',
    'mediaQuality.viewingExperience.highDynamicRange',
    'mediaQuality.viewingExperience.dolbyVision',
    'mediaQuality.viewingExperience.hdr10Plus',
    'mediaQuality.viewingExperience.standardHDR',
    'urls.mediaLastModified' // Check priority for the timestamp itself
  ];

  // Check if any field has the highest priority
  return videoInfoFields.some(field => {
    // Need to handle potential nesting in dimensions/length if keyed
    let fieldPathToCheck = field;
    if (field === 'dimensions' && fileServerData.dimensions && typeof fileServerData.dimensions === 'object') {
      const firstKey = Object.keys(fileServerData.dimensions)[0];
      if (firstKey) fieldPathToCheck = `dimensions.${firstKey}`;
    } else if (field === 'length' && fileServerData.length && typeof fileServerData.length === 'object') {
      const firstKey = Object.keys(fileServerData.length)[0];
      if (firstKey) fieldPathToCheck = `length.${firstKey}`;
    }
    
    return isCurrentServerHighestPriorityForField(
      fieldAvailability,
      'movies', // Media type is 'movies'
      movieTitle,
      fieldPathToCheck,
      serverConfig
    );
  });
}

/**
 * Compares existing video info with new video info to determine if an update is needed
 * @param {Object} movie - Movie object from flat database
 * @param {Object} videoInfo - Extracted video info
 * @param {string} serverId - Server ID
 * @returns {boolean} Whether an update is needed
 */
export function needsVideoInfoUpdate(movie, videoInfo, serverId) {
  // Check if dimensions have changed
  if (videoInfo.dimensions && !isEqual(movie.dimensions, videoInfo.dimensions)) {
    return true;
  }
  
  // Check if duration/length has changed
  // Use 'duration' field in the database, 'length' from file server
  if (videoInfo.length && (movie.duration !== videoInfo.length)) {
     return true;
  }
  
  // Check if HDR has changed
  if (videoInfo.hdr !== undefined && movie.hdr !== videoInfo.hdr) {
    return true;
  }
  
  // Check if size has changed
  if (videoInfo.size && movie.size !== videoInfo.size) {
    return true;
  }
  
  // Check if mediaQuality has changed
  if (videoInfo.mediaQuality && !isEqual(movie.mediaQuality, videoInfo.mediaQuality)) {
    return true;
  }

  // Check if mediaLastModified has changed
  const existingLastModified = movie.mediaLastModified ? new Date(movie.mediaLastModified).getTime() : 0;
  const newLastModified = videoInfo.mediaLastModified ? new Date(videoInfo.mediaLastModified).getTime() : 0;
  if (newLastModified > existingLastModified) {
      return true;
  }
  
  // Check if videoInfoSource has changed
  if (movie.videoInfoSource !== serverId) {
    return true;
  }
  
  return false;
}

/**
 * Processes movie video info updates
 * @param {Object} client - MongoDB client
 * @param {Object} movie - Movie object from flat database
 * @param {Object} fileServerData - Movie data from file server
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object|null>} Update result or null
 */
export async function syncMovieVideoInfo(
  client,
  movie,
  fileServerData,
  serverConfig,
  fieldAvailability
) {
  // Basic check if essential data exists
  if (!fileServerData || (!fileServerData.mediaQuality && !fileServerData.dimensions && !fileServerData.length)) {
      return null;
  }

  const movieTitle = movie.originalTitle || movie.title;
  
  // Check if this server has highest priority for any video info field
  const hasHighestPriority = hasHighestPriorityForAnyVideoInfoField(
    fieldAvailability,
    movieTitle,
    fileServerData,
    serverConfig
  );
  
  if (!hasHighestPriority) return null;
  
  // Extract video info
  const videoInfo = {
    videoInfoSource: serverConfig.id
  };
  
  // Copy media quality if available
  if (fileServerData.mediaQuality) {
    videoInfo.mediaQuality = fileServerData.mediaQuality;
  }
  
  // Copy HDR status if available
  if (fileServerData.hdr !== undefined && fileServerData.hdr !== null) {
    videoInfo.hdr = fileServerData.hdr;
  }
  
  // Copy dimensions if available (handle potential keying)
  if (fileServerData.dimensions) {
      if (typeof fileServerData.dimensions === 'object' && Object.keys(fileServerData.dimensions).length > 0) {
          // Take the first available dimension entry if keyed
          videoInfo.dimensions = fileServerData.dimensions[Object.keys(fileServerData.dimensions)[0]];
      } else if (typeof fileServerData.dimensions !== 'object') {
          // Assume direct value if not an object (though less likely based on structure)
          videoInfo.dimensions = fileServerData.dimensions;
      }
  }

  // Copy length/duration if available (handle potential keying)
  if (fileServerData.length) {
      if (typeof fileServerData.length === 'object' && Object.keys(fileServerData.length).length > 0) {
          // Take the first available length entry if keyed
          const lengthValue = fileServerData.length[Object.keys(fileServerData.length)[0]];
          videoInfo.duration = lengthValue; // Update 'duration' in DB
      } else if (typeof fileServerData.length !== 'object') {
          // Assume direct value
          videoInfo.duration = fileServerData.length;
      }
  }
  
  // Copy size if available
  if (fileServerData.additionalMetadata?.size) {
    videoInfo.size = fileServerData.additionalMetadata.size;
  }

  // Copy mediaLastModified if available
  if (fileServerData.urls?.mediaLastModified) {
    videoInfo.mediaLastModified = new Date(fileServerData.urls.mediaLastModified);
  }
  
  // Check if we need to update
  if (!needsVideoInfoUpdate(movie, videoInfo, serverConfig.id)) {
    return null;
  }
  
  // Filter out locked fields (using the extracted videoInfo which contains DB field names like 'duration')
  const updatePayload = { ...videoInfo };
  const filteredUpdateData = filterLockedFields(movie, updatePayload);
  
  if (Object.keys(filteredUpdateData).length === 0) return null;
  
  console.log(`Movie: Updating video info for "${movieTitle}" from server ${serverConfig.id}`);
  
  // Update the movie in the flat database
  await updateMovieInFlatDB(client, movieTitle, { $set: filteredUpdateData });
  
  return {
    field: 'videoInfo',
    updated: true
  };
}
