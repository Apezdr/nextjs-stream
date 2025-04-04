/**
 * TV season poster sync utilities for flat structure
 */

import { createFullUrl, filterLockedFields, isSourceMatchingServer, isCurrentServerHighestPriorityForField, MediaType } from '../../sync/utils';
import { updateSeasonInFlatDB, getSeasonFromFlatDB } from './database';
import { getTVShowFromFlatDB } from '../tvShows/database';
import { isEqual } from 'lodash';
import { createAndPersistSeason } from '.';

/**
 * Processes TV season poster URL updates
 * @param {Object} client - MongoDB client
 * @param {Object} show - TV show object
 * @param {Object} season - Season object from current database
 * @param {Object} fileServerSeasonData - File server season data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object|null>} Update result or null
 */
export async function syncSeasonPoster(client, show, season, fileServerSeasonData, serverConfig, fieldAvailability) {
  if (!fileServerSeasonData?.season_poster) return null;
  
  const fieldPath = `seasons.Season ${season.seasonNumber}.season_poster`;
  const showTitle = show.title;
  const originalTitle = show.originalTitle;
  
  // Check if the current server has the highest priority for season_poster
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
    try {
      // Create a new season properly persisting it to the database
      flatSeason = await createAndPersistSeason(client, flatShow, season);
      console.log(`Created new season ${season.seasonNumber} for "${showTitle}" during poster sync`);
    } catch (error) {
      console.error(`Failed to create season during poster sync: ${error.message}`);
      return null;
    }
  }
  
  const newPosterURL = createFullUrl(fileServerSeasonData.season_poster, serverConfig);
  
  // Only update if the poster URL has changed
  if (isEqual(flatSeason.posterURL, newPosterURL) && isSourceMatchingServer(flatSeason, 'posterSource', serverConfig)) {
    return null;
  }
  
  const updateData = {
    posterURL: newPosterURL,
    posterSource: serverConfig.id
  };
  
  // Filter out locked fields
  const filteredUpdateData = filterLockedFields(flatSeason, updateData);
  
  if (!filteredUpdateData.posterURL) return null;
  
  console.log(`Season: Updating poster URL for "${showTitle}" Season ${season.seasonNumber} from server ${serverConfig.id}`);
  
  // Update the season in the flat database
  await updateSeasonInFlatDB(client, showTitle, originalTitle, season.seasonNumber, { $set: filteredUpdateData });
  
  return {
    field: 'posterURL',
    updated: true
  };
}
