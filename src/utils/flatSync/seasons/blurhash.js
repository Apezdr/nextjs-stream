/**
 * TV season blurhash sync utilities for flat structure
 */

import { createFullUrl, filterLockedFields, isSourceMatchingServer, isCurrentServerHighestPriorityForField, MediaType } from '../../sync/utils';
import { updateSeasonInFlatDB, getSeasonFromFlatDB } from './database';
import { getTVShowFromFlatDB } from '../tvShows/database';
import { isEqual } from 'lodash';

/**
 * Processes TV season poster blurhash updates
 * @param {Object} client - MongoDB client
 * @param {Object} show - TV show object
 * @param {Object} season - Season object from current database
 * @param {Object} fileServerSeasonData - File server season data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object|null>} Update result or null
 */
export async function syncSeasonPosterBlurhash(client, show, season, fileServerSeasonData, serverConfig, fieldAvailability) {
  if (!fileServerSeasonData?.seasonPosterBlurhash) return null;
  
  const fieldPath = `seasons.Season ${season.seasonNumber}.seasonPosterBlurhash`;
  const showTitle = show.title;
  const originalTitle = show.originalTitle;
  
  // Check if the current server has the highest priority for seasonPosterBlurhash
  const isHighestPriority = isCurrentServerHighestPriorityForField(
    fieldAvailability,
    'tv',
    originalTitle,
    fieldPath,
    serverConfig
  );
  
  if (!isHighestPriority) return null;
  
  // Get the season from the flat database or create it if it doesn't exist
  const flatShow = show;
  if (!flatShow) return null;
  
  let flatSeason = season;
  
  if (!flatSeason) {
    // Create a new season with basic information
    flatSeason = {
      showId: flatShow._id,
      showTitle: showTitle,
      seasonNumber: season.seasonNumber,
      type: 'season',
      createdAt: new Date()
    };
  }
  
  const newPosterBlurhashURL = createFullUrl(fileServerSeasonData.seasonPosterBlurhash, serverConfig);
  
  // Only update if the posterBlurhash URL has changed
  if (isEqual(flatSeason.posterBlurhash, newPosterBlurhashURL) && isSourceMatchingServer(flatSeason, 'posterBlurhashSource', serverConfig)) {
    return null;
  }
  
  const updateData = {
    posterBlurhash: newPosterBlurhashURL,
    posterBlurhashSource: serverConfig.id
  };
  
  // Filter out locked fields
  const filteredUpdateData = filterLockedFields(flatSeason, updateData);
  
  if (!filteredUpdateData.posterBlurhash) return null;
  
  console.log(`Season: Updating poster blurhash for "${showTitle}" Season ${season.seasonNumber} from server ${serverConfig.id}`);
  
  // Update the season in the flat database
  await updateSeasonInFlatDB(client, showTitle, originalTitle, season.seasonNumber, { $set: filteredUpdateData });
  
  return {
    field: 'posterBlurhash',
    updated: true
  };
}
