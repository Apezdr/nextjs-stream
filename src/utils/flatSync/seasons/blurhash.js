/**
 * TV season blurhash sync utilities for flat structure
 */

import { createLogger, logError } from '@src/lib/logger';
import { createFullUrl, filterLockedFields, isSourceMatchingServer, isCurrentServerHighestPriorityForField, MediaType } from '../../sync/utils';
import { updateSeasonInFlatDB } from './database';
import { isEqual } from 'lodash';
import { fetchMetadataMultiServer } from '@src/utils/admin_utils';
import { createAndPersistSeason } from '.';

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
  const log = createLogger('FlatSync.Seasons.Blurhash');
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
    try {
      // Create a new season properly persisting it to the database
      flatSeason = await createAndPersistSeason(client, flatShow, season);
      log.info({
        showTitle,
        seasonNumber: season.seasonNumber,
        context: 'create_season_blurhash'
      }, 'Created new season during blurhash sync');
    } catch (error) {
      logError(log, error, {
        showTitle,
        seasonNumber: season.seasonNumber,
        context: 'create_season_blurhash_failed'
      });
      return null;
    }
  }

  const posterBlurhash = await fetchMetadataMultiServer(
    serverConfig.id,
    fileServerSeasonData.seasonPosterBlurhash,
    'blurhash',
    MediaType.TV,
    flatShow.originalTitle,
  );
  
  // Only update if the posterBlurhash URL has changed
  if (isEqual(flatSeason.posterBlurhash, posterBlurhash) && isSourceMatchingServer(flatSeason, 'posterBlurhashSource', serverConfig)) {
    return null;
  }
  
  const updateData = {
    posterBlurhash: posterBlurhash,
    posterBlurhashSource: serverConfig.id
  };
  
  // Filter out locked fields
  const filteredUpdateData = filterLockedFields(flatSeason, updateData);
  
  if (!filteredUpdateData.posterBlurhash) return null;
  
  log.info({
    showTitle,
    seasonNumber: season.seasonNumber,
    serverId: serverConfig.id,
    field: 'posterBlurhash'
  }, 'Updating season poster blurhash');
  
  // Update the season in the flat database
  await updateSeasonInFlatDB(client, showTitle, originalTitle, season.seasonNumber, { $set: filteredUpdateData });
  
  return {
    field: 'posterBlurhash',
    updated: true
  };
}
