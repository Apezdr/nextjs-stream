/**
 * TV season metadata sync utilities for flat structure
 */

import { filterLockedFields, isCurrentServerHighestPriorityForField, MediaType } from '../../sync/utils';
import { updateSeasonInFlatDB, getSeasonFromFlatDB } from './database';
import { getTVShowFromFlatDB } from '../tvShows/database';
import { isEqual } from 'lodash';
import { fetchMetadataMultiServer } from '@src/utils/admin_utils';

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
  // Season metadata is always stored within the show metadata, not as separate files
  // Get the season metadata from the show metadata array
  const showMetadata = show.metadata || {};
  const seasonMetadata = showMetadata.seasons?.find(s => s.season_number === season.seasonNumber);
  
  if (!seasonMetadata) {
    console.log(`No season metadata found for "${show.title}" Season ${season.seasonNumber} in show metadata`);
    return null;
  }
  
  // We're using the metadata from the show object because it's the source of truth for season metadata
  const fieldPath = `metadata`;
  const showTitle = show.title;
  const originalTitle = show.originalTitle;
  
  // Check if the current server has the highest priority for metadata
  const isHighestPriority = isCurrentServerHighestPriorityForField(
    fieldAvailability,
    'tv',
    originalTitle,
    fieldPath,
    serverConfig
  );
  
  if (!isHighestPriority) return null;
  
  // Get the season from the flat database or create it if it doesn't exist
  const flatShow = await getTVShowFromFlatDB(client, originalTitle);
  if (!flatShow) return null;
  
  let flatSeason = await getSeasonFromFlatDB(client, showTitle, season.seasonNumber);
  
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
  
  console.log(`Season: Updating metadata for "${showTitle}" Season ${season.seasonNumber} from server ${serverConfig.id}`);
  
  // Update the season in the flat database
  await updateSeasonInFlatDB(client, showTitle, originalTitle, season.seasonNumber, { $set: filteredUpdateData });
  
  return {
    field: 'metadata',
    updated: true
  };
}
