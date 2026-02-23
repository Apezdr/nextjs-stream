/**
 * TV season metadata sync utilities for flat structure
 */

import { createLogger, logError } from '@src/lib/logger';
import { filterLockedFields, isCurrentServerHighestPriorityForField, MediaType } from '../../sync/utils';
import { updateSeasonInFlatDB } from './database';
import { isEqual } from 'lodash';
import { fetchMetadataMultiServer } from '@src/utils/admin_utils';
import { createAndPersistSeason } from '.';

/**
 * Processes TV season metadata updates
 * @param {Object} client - MongoDB client
 * @param {Object} show - TV show object
 * @param {Object} season - Season object from current database
 * @param {Object} fileServerSeasonData - File server season data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object|null>} Update result or null
 */
export async function syncSeasonMetadata(client, show, season, fileServerSeasonData, serverConfig, fieldAvailability) {
  const log = createLogger('FlatSync.Seasons.Metadata');
  // Season metadata is always stored within the show metadata, not as separate files
  // Get the season metadata from the show metadata array
  const showTitle = show.title;
  const originalTitle = show.originalTitle;
  
  const showMetadata = show.metadata || {};
  const seasonMetadata = showMetadata.seasons?.find(s => s.season_number === season.seasonNumber);
  
  if (Object.keys(showMetadata).length === 0) {
    logError(log, new Error('season_metadata_missing'), {
      showTitle: show.title,
      context: 'show_metadata_missing'
    });
  }

  if (!seasonMetadata) {
    log.info({
      showTitle: show.title,
      seasonNumber: season.seasonNumber,
      context: 'season_metadata_not_in_show'
    }, 'Season metadata missing in show metadata');
    
    // Check if any season metadata exists at all for this show
    const hasAnySeasons = showMetadata.seasons && showMetadata.seasons.length > 0;
    
    if (!hasAnySeasons) {
      // If this show has no seasons at all, we should check if we're highest priority for metadata
      const fieldPath = `metadata`;
      
      // Check if the current server has the highest priority for metadata
      const isHighestPriority = isCurrentServerHighestPriorityForField(
        fieldAvailability,
        'tv',
        originalTitle,
        fieldPath,
        serverConfig
      );
      
      if (!isHighestPriority) {
        log.info({
          showTitle,
          serverId: serverConfig.id,
          context: 'not_highest_priority_no_season_metadata'
        }, 'Skipping season metadata sync due to priority');
        return null;
      }
    } else {
      // If other seasons exist but this specific one is missing, allow this server to provide it
      // This is the key change - if a server has a season that others don't have, allow it to sync that season
      log.info({
        showTitle: show.title,
        seasonNumber: season.seasonNumber,
        serverId: serverConfig.id,
        context: 'allow_missing_season_metadata'
      }, 'Allowing server to provide missing season metadata');
      
      // Still, we need to make sure we have some kind of season metadata to process
      if (!fileServerSeasonData || !fileServerSeasonData.metadata) {
        log.info({
          showTitle: show.title,
          seasonNumber: season.seasonNumber,
          context: 'no_valid_season_metadata'
        }, 'Skipping season metadata sync due to missing file server metadata');
        return null;
      }
    }
  } else {
    // We have season metadata from the show object, so check if we're highest priority
    const fieldPath = `metadata`;
    
    // Check if the current server has the highest priority for metadata
    const isHighestPriority = isCurrentServerHighestPriorityForField(
      fieldAvailability,
      'tv',
      originalTitle,
      fieldPath,
      serverConfig
    );
    
    if (!isHighestPriority) {
      log.info({
        showTitle,
        seasonNumber: season.seasonNumber,
        serverId: serverConfig.id,
        context: 'not_highest_priority_check'
      }, 'Checking if highest priority server already has metadata');
      
      // Get the highest priority server
      const highestPriorityServer = fieldAvailability?.tv?.[originalTitle]?.[fieldPath]?.[0];
      
      if (highestPriorityServer) {
        // If we have the season but it doesn't have metadata, allow this server to provide it
        if (season && (!season.metadata || Object.keys(season.metadata).length === 0)) {
          log.info({
            showTitle,
            seasonNumber: season.seasonNumber,
            serverId: serverConfig.id,
            context: 'allow_metadata_for_empty_season'
          }, 'Allowing server to provide metadata for existing season with no metadata');
        } else if (!season) {
          // If the season doesn't exist at all, allow this server to provide it
          log.info({
            showTitle,
            seasonNumber: season.seasonNumber,
            serverId: serverConfig.id,
            context: 'allow_metadata_for_missing_season'
          }, 'Allowing server to provide metadata for missing season');
        } else {
          // Otherwise skip since we're not highest priority and the season already has metadata
          return null;
        }
      } else {
        // If there's no highest priority server defined, allow this one
        log.info({
          showTitle,
          serverId: serverConfig.id,
          context: 'no_priority_defined'
        }, 'Allowing server to provide metadata (no priority defined)');
      }
    }
  }
  
  let flatSeason = season;
  
  if (!flatSeason) {
    try {
      // Create a new season properly persisting it to the database
      flatSeason = await createAndPersistSeason(client, show, season);
      log.info({
        showTitle,
        seasonNumber: season.seasonNumber,
        context: 'season_created_during_metadata_sync'
      }, 'Created new season during metadata sync');
    } catch (error) {
      logError(log, error, {
        showTitle,
        seasonNumber: season.seasonNumber,
        context: 'season_creation_failed'
      });
      return null;
    }
  }
  
  // Compare last_updated timestamps if available
  const existingLastUpdated = new Date(flatSeason.metadata?.last_updated || '1970-01-01');
  const newLastUpdated = new Date(seasonMetadata.last_updated || '1970-01-01');
  
  if (newLastUpdated <= existingLastUpdated && flatSeason.metadataSource) return null;
  
  // Check if metadata has actually changed
  if (isEqual(flatSeason.metadata, seasonMetadata) && flatSeason.metadataSource === serverConfig.id) return null;
  
  // Remove episode-specific data from the season metadata
  // This will be stored in the episodes collection
  const cleanedMetadata = { ...seasonMetadata };
  
  // Remove episodes array from metadata as it will be stored separately
  if (cleanedMetadata.episodes) {
    delete cleanedMetadata.episodes;
  }
  
  // Prepare update data with important fields extracted for easy querying
  const updateData = {
    metadata: cleanedMetadata,
    metadataSource: serverConfig.id,
    title: seasonMetadata.name || `Season ${season.seasonNumber}`
  };
  
  // Add additional metadata fields that are useful for queries
  if (seasonMetadata.air_date) {
    updateData.airDate = new Date(seasonMetadata.air_date);
  }
  
  if (seasonMetadata.overview) {
    updateData.overview = seasonMetadata.overview;
  }
  
  if (seasonMetadata.poster_path) {
    updateData.posterPath = seasonMetadata.poster_path;
  }
  
  if (seasonMetadata.season_number !== undefined) {
    // Make sure the season number in metadata matches our record
    updateData.seasonNumber = seasonMetadata.season_number;
  }
  
  if (seasonMetadata.episode_count) {
    updateData.episodeCount = seasonMetadata.episode_count;
  }
  
  if (seasonMetadata.vote_average) {
    updateData.rating = seasonMetadata.vote_average;
  }
  
  // Filter out locked fields
  const filteredUpdateData = filterLockedFields(flatSeason, updateData);
  
  if (Object.keys(filteredUpdateData).length === 0) return null;
  
  log.info({
    showTitle,
    seasonNumber: season.seasonNumber,
    serverId: serverConfig.id,
    field: 'metadata'
  }, 'Updating season metadata');
  
  // Update the season in the flat database
  await updateSeasonInFlatDB(client, showTitle, originalTitle, season.seasonNumber, { $set: filteredUpdateData });
  
  return {
    field: 'metadata',
    updated: true
  };
}
