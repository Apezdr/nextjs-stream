/**
 * TV episode video info sync utilities for flat structure
 */

import { createLogger } from '@src/lib/logger'
import {
  filterLockedFields,
  isCurrentServerHighestPriorityForReportedField,
  isCurrentServerHighestPriorityForReportedFieldGroup,
  findEpisodeFileName,
} from '../../sync/utils';
import { EPISODE_SIZE_FIELD_SUFFIXES, resolveEpisodeSize } from '../../sync/episodeSize';
import { isEqual } from 'lodash';

const log = createLogger('FlatSync.Episodes.VideoInfo');

function collectLeafPaths(value, path) {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => {
      if (!item || typeof item !== 'object') return [];
      const identifier = item.codec || item.name || item.id || index;
      return collectLeafPaths(item, `${path}.${identifier}`);
    });
  }

  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) =>
      collectLeafPaths(child, `${path}.${key}`)
    );
  }

  return value === undefined || value === null ? [] : [path];
}

function canUpdateReportedField(fieldAvailability, originalTitle, fieldPath, serverConfig) {
  return isCurrentServerHighestPriorityForReportedField(
    fieldAvailability,
    'tv',
    originalTitle,
    fieldPath,
    serverConfig
  );
}

function canUpdateReportedFieldGroup(
  fieldAvailability,
  originalTitle,
  fieldPaths,
  serverConfig
) {
  return isCurrentServerHighestPriorityForReportedFieldGroup(
    fieldAvailability,
    'tv',
    originalTitle,
    fieldPaths,
    serverConfig
  );
}

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
  const seasonPrefix = `seasons.Season ${seasonNumber}`;
  const episodePrefix = `${seasonPrefix}.episodes.${episodeFileName}`;
  const videoInfoFields = [];

  if (fileServerSeasonData.dimensions?.[episodeFileName] != null) {
    videoInfoFields.push(`${seasonPrefix}.dimensions.${episodeFileName}`);
  }
  if (fileServerSeasonData.lengths?.[episodeFileName] != null) {
    videoInfoFields.push(`${seasonPrefix}.lengths.${episodeFileName}`);
  }
  if (fileServerEpisodeData.hdr !== undefined && fileServerEpisodeData.hdr !== null) {
    videoInfoFields.push(`${episodePrefix}.hdr`);
  }

  const size = resolveEpisodeSize(fileServerEpisodeData);
  if (size) {
    const reportedSizePath = `${episodePrefix}.${size.fieldSuffix}`;
    const sizePaths = EPISODE_SIZE_FIELD_SUFFIXES.map(
      suffix => `${episodePrefix}.${suffix}`
    );
    if (
      canUpdateReportedField(
        fieldAvailability,
        originalTitle,
        reportedSizePath,
        serverConfig
      ) && canUpdateReportedFieldGroup(
      fieldAvailability,
      originalTitle,
      sizePaths,
      serverConfig
      )
    ) return true;
  }

  if (fileServerEpisodeData.mediaQuality) {
    videoInfoFields.push(...collectLeafPaths(
      fileServerEpisodeData.mediaQuality,
      `${episodePrefix}.mediaQuality`
    ));
  }
  if (fileServerEpisodeData.videoCodec && !fileServerEpisodeData.mediaQuality?.codec) {
    videoInfoFields.push(`${episodePrefix}.videoCodec`);
  }
  if (fileServerEpisodeData.mediaLastModified) {
    videoInfoFields.push(`${episodePrefix}.mediaLastModified`);
  }

  return videoInfoFields.some(field =>
    canUpdateReportedField(fieldAvailability, originalTitle, field, serverConfig)
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
  // Track any detected changes for logging
  const changes = [];
  
  // Helper function to check specific field differences with detailed logging
  const checkField = (fieldName, existingValue, newValue, useDeepCompare = false) => {
    // Skip if new value isn't provided by the source
    if (newValue === undefined || newValue === null) {
      return false;
    }

    let valueChanged;

    // Handle Date type comparison
    if (existingValue instanceof Date || newValue instanceof Date) {
      const existingTime = existingValue instanceof Date ? existingValue.getTime() : existingValue;
      const newTime = newValue instanceof Date ? newValue.getTime() : newValue;
      valueChanged = existingTime !== newTime;
    } else {
      valueChanged = useDeepCompare 
        ? !isEqual(existingValue, newValue)
        : existingValue !== newValue;
    }
    
    // If value has changed or existing value is missing, we should update
    const needsUpdate = valueChanged || existingValue === undefined || existingValue === null;
    
    if (needsUpdate) {
      changes.push(fieldName);
    }
    
    return needsUpdate;
  };

  // Check all fields that could need updating
  const dimensionsChanged = checkField('dimensions', flatEpisode.dimensions, videoInfo.dimensions, true);
  const durationChanged = checkField('duration', flatEpisode.duration, videoInfo.duration);
  const hdrChanged = checkField('hdr', flatEpisode.hdr, videoInfo.hdr);
  const sizeChanged = checkField('size', flatEpisode.size, videoInfo.size);
  const videoCodecChanged = checkField('videoCodec', flatEpisode.videoCodec, videoInfo.videoCodec);
  const mediaQualityChanged = checkField('mediaQuality', flatEpisode.mediaQuality, videoInfo.mediaQuality, true);
  const mediaLastModifiedChanged = checkField('mediaLastModified', flatEpisode.mediaLastModified, videoInfo.mediaLastModified);
  
  // If any field has changed or is newly provided, we need to update
  const needsUpdate = dimensionsChanged || durationChanged || hdrChanged || 
                      sizeChanged || videoCodecChanged || mediaQualityChanged || mediaLastModifiedChanged;
  
  // Log which fields triggered the update (uncomment for debugging)
  if (needsUpdate && changes.length > 0) {
    log.debug({
      serverId,
      changes
    }, 'Episode video info requires update due to changed fields');
  }
  
  return needsUpdate;
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
  // ex. `S01E01`
  const episodeFileName = findEpisodeFileName(
    Object.keys(fileServerSeasonData.episodes || {}),
    season.seasonNumber,
    episode.episodeNumber
  );
  
  if (!episodeFileName) {
    log.warn({
      showTitle: show.title,
      seasonNumber: season.seasonNumber,
      episodeNumber: episode.episodeNumber,
      context: 'episode_filename_missing'
    }, 'Episode file name not found for video info sync');
    return null;
  }
  
  const fileServerEpisodeData = fileServerSeasonData.episodes[episodeFileName];
  const hasEpisodeVideoInfo = Boolean(
    fileServerEpisodeData?.mediaQuality ||
    fileServerEpisodeData?.mediaLastModified ||
    fileServerEpisodeData?.additionalMetadata ||
    fileServerEpisodeData?.size != null ||
    fileServerEpisodeData?.hdr != null ||
    fileServerEpisodeData?.videoCodec ||
    fileServerSeasonData.dimensions?.[episodeFileName] != null ||
    fileServerSeasonData.lengths?.[episodeFileName] != null
  );
  if (!fileServerEpisodeData || !hasEpisodeVideoInfo) return null;
  
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
  const videoInfo = {};
  const seasonPrefix = `seasons.Season ${season.seasonNumber}`;
  const episodePrefix = `${seasonPrefix}.episodes.${episodeFileName}`;
  const canUpdate = (fieldPath) =>
    canUpdateReportedField(fieldAvailability, originalTitle, fieldPath, serverConfig);
  
  // `mediaQuality` is stored as one object. Only replace it when this server
  // owns every leaf it reported, preventing a lower-priority leaf from being
  // smuggled in by an otherwise-authoritative sibling field.
  if (fileServerEpisodeData.mediaQuality) {
    const mediaQualityPaths = collectLeafPaths(
      fileServerEpisodeData.mediaQuality,
      `${episodePrefix}.mediaQuality`
    );
    if (mediaQualityPaths.length > 0 && mediaQualityPaths.every(canUpdate)) {
      videoInfo.mediaQuality = fileServerEpisodeData.mediaQuality;
    }
  }
  
  if (
    fileServerEpisodeData.hdr !== undefined &&
    fileServerEpisodeData.hdr !== null &&
    canUpdate(`${episodePrefix}.hdr`)
  ) {
    videoInfo.hdr = fileServerEpisodeData.hdr;
  }
  
  if (
    fileServerSeasonData.dimensions?.[episodeFileName] &&
    canUpdate(`${seasonPrefix}.dimensions.${episodeFileName}`)
  ) {
    videoInfo.dimensions = fileServerSeasonData.dimensions[episodeFileName];
  }

  if (
    fileServerSeasonData.lengths?.[episodeFileName] != null &&
    canUpdate(`${seasonPrefix}.lengths.${episodeFileName}`)
  ) {
    videoInfo.duration = fileServerSeasonData.lengths[episodeFileName];
  }
  
  const size = resolveEpisodeSize(fileServerEpisodeData);
  const sizePaths = EPISODE_SIZE_FIELD_SUFFIXES.map(
    suffix => `${episodePrefix}.${suffix}`
  );
  if (
    size &&
    canUpdate(`${episodePrefix}.${size.fieldSuffix}`) &&
    canUpdateReportedFieldGroup(
      fieldAvailability,
      originalTitle,
      sizePaths,
      serverConfig
    )
  ) {
    videoInfo.size = size.bytes;
  }

  // Codec is optional and only present once the file server scanner reports it.
  const episodeCodec = fileServerEpisodeData.mediaQuality?.codec || fileServerEpisodeData.videoCodec;
  const codecPath = fileServerEpisodeData.mediaQuality?.codec
    ? `${episodePrefix}.mediaQuality.codec`
    : `${episodePrefix}.videoCodec`;
  if (episodeCodec && canUpdate(codecPath)) {
    videoInfo.videoCodec = episodeCodec;
  }

  if (
    fileServerEpisodeData.mediaLastModified &&
    canUpdate(`${episodePrefix}.mediaLastModified`)
  ) {
    videoInfo.mediaLastModified = new Date(fileServerEpisodeData.mediaLastModified);
  }

  if (Object.keys(videoInfo).length === 0) return null;
  const containsVideoInfo = Object.keys(videoInfo).some((field) => field !== 'size');
  if (containsVideoInfo) videoInfo.videoInfoSource = serverConfig.id;
  
  // Check if we need to update
  if (!needsVideoInfoUpdate(flatEpisode, videoInfo, serverConfig.id)) {
    return null;
  }
  
  // Filter out locked fields
  const filteredUpdateData = filterLockedFields(flatEpisode, videoInfo);
  
  if (Object.keys(filteredUpdateData).length === 0) return null;
  
  log.info({
    showTitle,
    seasonNumber: season.seasonNumber,
    episodeNumber: episode.episodeNumber,
    serverId: serverConfig.id,
    field: 'videoInfo'
  }, 'Updating episode video info');
  
  // Return both the status and the update data
  return {
    ...filteredUpdateData,
    field: 'videoInfo',
    updated: true
  };
}
