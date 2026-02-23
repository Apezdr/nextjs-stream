/**
 * TV episode metadata sync utilities for flat structure
 * 
 * This module provides functions to sync episode metadata between file servers
 * and the flat database structure. It includes both traditional sync methods
 * and optimized hash-based sync for improved performance.
 */

import { createLogger, logError } from '@src/lib/logger';
import { filterLockedFields, isCurrentServerHighestPriorityForField, MediaType, findEpisodeFileName } from '../../sync/utils';
import { updateEpisodeInFlatDB, getEpisodeFromFlatDB, createEpisodeInFlatDB } from './database';
import { createSeasonInFlatDB } from '../seasons/database';
import { isEqual } from 'lodash';
import { fetchHashData, getStoredHash, storeHash } from '../hashStorage';
import { fetchMetadataMultiServer } from '@src/utils/admin_utils';
import { buildNewSeasonObject } from '../seasons';

/**
 * Legacy implementation of episode metadata sync
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
export async function syncEpisodeMetadataLegacy(client, show, season, episode, flatShow, flatSeason, flatEpisode, fileServerSeasonData, serverConfig, fieldAvailability) {
  const log = createLogger('FlatSync.Episodes.Metadata');
  // Early exit checks to avoid unnecessary processing

  // 1. Check if episode exists in file server data
  const episodeFileName = findEpisodeFileName(
    Object.keys(fileServerSeasonData.episodes || {}),
    season.seasonNumber,
    episode.episodeNumber
  );

  if (!episodeFileName) return null;

  // 2. Get season metadata
  const seasonMetadata = season.metadata || {};

  // 3. Find episode metadata
  // This is important as we need to store the actual metadata object, not just a URL
  let episodeMetadata;

  const fieldPath = `seasons.Season ${season.seasonNumber}.episodes.${episodeFileName}.metadata`;
  const showTitle = show.title;
  const originalTitle = show.originalTitle;

  const isHighestPriority = isCurrentServerHighestPriorityForField(
    fieldAvailability,
    'tv',
    originalTitle,
    fieldPath,
    serverConfig
  );

  if (!isHighestPriority) return null;

  // First try to get episode metadata from the file server data directly
  // This is more reliable since we're syncing to the flat database structure
  if (episodeFileName && fileServerSeasonData.episodes[episodeFileName]?.metadata) {
    // Use the metadata from the file server directly
    const episodeMetadataURL = fileServerSeasonData.episodes[episodeFileName].metadata;

    // Fetch metadata from the server - this is CRUCIAL as we need the actual metadata object
    episodeMetadata = await fetchMetadataMultiServer(
      serverConfig.id,
      episodeMetadataURL,
      'file',
      'tv',
      show.originalTitle
    );

    // Make sure we got valid metadata back
    if (!episodeMetadata || typeof episodeMetadata !== 'object' || episodeMetadata.error) {
      log.warn({
        showTitle: show.title,
        seasonNumber: season.seasonNumber,
        episodeNumber: episode.episodeNumber,
        error: episodeMetadata?.error || 'Unknown error',
        context: 'episode_metadata_fetch_failed'
      }, 'Failed to fetch episode metadata directly');

      // Try to fall back to season metadata
      if (seasonMetadata?.episodes && seasonMetadata.episodes.length > 0) {
        episodeMetadata = seasonMetadata.episodes.find(e => e?.episode_number === episode?.episodeNumber);
        log.info({
          showTitle: show.title,
          seasonNumber: season.seasonNumber,
          episodeNumber: episode.episodeNumber,
          context: 'fallback_season_metadata'
        }, 'Falling back to use season metadata for episode');
      }
    }
  } else if (seasonMetadata?.episodes && seasonMetadata.episodes.length > 0) {
    // If file server doesn't have metadata, try to find it in the season metadata
    episodeMetadata = seasonMetadata.episodes.find(e => e?.episode_number === episode?.episodeNumber);
    log.info({
      showTitle: show.title,
      seasonNumber: season.seasonNumber,
      episodeNumber: episode.episodeNumber,
      context: 'attempt_season_metadata'
    }, 'Attempting to use season sourced metadata for episode');
  }

  if (!episodeMetadata) return null;

  // Skip update if metadata hasn't changed and source is the same
  // Compare last_updated timestamps if available
  const existingLastUpdated = new Date(flatEpisode.metadata?.last_updated || '1970-01-01');
  const newLastUpdated = new Date(episodeMetadata.last_updated || '1970-01-01');

  if (newLastUpdated <= existingLastUpdated && flatEpisode.metadataSource) {
    // Skip if metadata is older and we already have a source
    return null;
  }

  const cleanedFlatEpisodeMetadata = { ...flatEpisode.metadata };
  delete cleanedFlatEpisodeMetadata.last_updated;

  const cleanedEpisodeMetadata = { ...episodeMetadata };
  delete cleanedEpisodeMetadata.last_updated;

  // Skip if metadata is identical and from the same source
  if (isEqual(cleanedFlatEpisodeMetadata, cleanedEpisodeMetadata) &&
    flatEpisode.metadataSource === serverConfig.id) {
    return null;
  }

  // Prepare update data - ensuring we store the actual metadata object, not a path
  const updateData = {
    // Store the full metadata object, not just the path
    metadata: episodeMetadata,
    metadataSource: serverConfig.id,
    title: episodeMetadata?.name ?? `Episode ${episode.episodeNumber}`
  };

  // Add additional metadata fields that are useful for queries
  if (episodeMetadata.air_date) {
    updateData.airDate = new Date(episodeMetadata.air_date);
  }

  if (episodeMetadata.runtime) {
    updateData.runtime = episodeMetadata.runtime;
  }

  if (episodeMetadata.vote_average) {
    updateData.rating = episodeMetadata.vote_average;
  }

  // Add episode description/overview if available
  if (episodeMetadata.overview) {
    updateData.overview = episodeMetadata.overview;
  }

  // Add still image path if available
  if (episodeMetadata.still_path) {
    updateData.stillPath = episodeMetadata.still_path;
  }

  // Add episode number from metadata if available
  if (episodeMetadata.episode_number) {
    updateData.episodeNumber = episodeMetadata.episode_number;
  }

  // Add crew information if available
  if (episodeMetadata.crew && episodeMetadata.crew.length > 0) {
    updateData.crew = episodeMetadata.crew;
  }

  // Add guest stars if available
  if (episodeMetadata.guest_stars && episodeMetadata.guest_stars.length > 0) {
    updateData.guestStars = episodeMetadata.guest_stars;
  }

  // Filter out locked fields
  const filteredUpdateData = filterLockedFields(flatEpisode, updateData);

  if (Object.keys(filteredUpdateData).length === 0) return null;

  log.info({
    showTitle,
    seasonNumber: season.seasonNumber,
    episodeNumber: episode.episodeNumber,
    serverId: serverConfig.id,
    field: 'metadata'
  }, 'Updating episode metadata');

  // Prepare the final update data (make a copy to avoid modifying the original)
  const finalUpdateData = {
    ...filteredUpdateData,
    title: filteredUpdateData.title || updateData.title
  };

  // Return the update data for the database with status information
  // We'll use the status information in the sync process, but remove it before saving to DB
  return {
    ...finalUpdateData,
    field: 'metadata',
    updated: true
  };
}

/**
 * Processes TV episode metadata updates using hash-based approach
 * @param {Object} client - MongoDB client
 * @param {Object} show - TV show object
 * @param {Object} season - Season object from current database
 * @param {Object} episode - Episode object from current database
 * @param {Object} fileServerSeasonData - File server season data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @param {Object} season_hashData - Hash data for the season
 * @returns {Promise<Object|null>} Update result or null
 */
export async function syncEpisodeMetadata(client, show, season, episode, fileServerSeasonData, serverConfig, fieldAvailability, season_hashData) {
  const log = createLogger('FlatSync.Episodes.Metadata.HashSync');
  try {
    const showTitle = show.title;
    const originalTitle = show.originalTitle;
    // Get necessary database objects
    const flatShow = show;
    const flatSeason = season;

    if (!flatShow || !flatSeason) return null;

    // Try hash-based sync first
    const episodeKey = `S${season.seasonNumber.toString().padStart(2, '0')}E${episode.episodeNumber.toString().padStart(2, '0')}`;

    // Check if we have a stored hash for this episode
    if (season_hashData && season_hashData.episodes && season_hashData.episodes[episodeKey]) {
      const currentHash = season_hashData.episodes[episodeKey].hash;
      const storedHash = await getStoredHash(client, 'tv', showTitle, season.seasonNumber, episode.episodeNumber, serverConfig.id);

      // Get the episode from the flat database
      let flatEpisode = await getEpisodeFromFlatDB(client, showTitle, season.seasonNumber, episode.episodeNumber);

      // If hashes match, check if we already have metadata
      // Only skip if we have both matching hash AND existing metadata
      if (storedHash === currentHash && flatEpisode && flatEpisode.metadata) {
        return null;
      }

      // Force update if hash matches but metadata is missing
      if (storedHash === currentHash) {
        log.debug({
          showTitle: show.title,
          seasonNumber: season.seasonNumber,
          episodeNumber: episode.episodeNumber,
          context: 'episode_exists_metadata'
        }, 'Episode exists; proceeding with metadata updates');
      }

      // Create episode if it doesn't exist
      if (!flatEpisode) {
        // Instead of just creating a local object, use our improved createEpisodeInFlatDB
        // function to properly handle potential duplicates
        const newEpisodeData = {
          showId: flatShow._id,
          seasonId: flatSeason._id,
          showTitle: showTitle,
          seasonNumber: season.seasonNumber,
          episodeNumber: episode.episodeNumber,
          type: 'episode',
          createdAt: new Date()
        };

        const createResult = await createEpisodeInFlatDB(client, newEpisodeData);

        // If there was an existing episode found during creation, use that instead
        if (createResult.existing) {
          // Fetch the existing episode to make sure we have the full data
          flatEpisode = await getEpisodeFromFlatDB(client, showTitle, season.seasonNumber, episode.episodeNumber);
          log.debug({
            showTitle: show.title,
            seasonNumber: season.seasonNumber,
            episodeNumber: episode.episodeNumber,
            context: 'episode_exists_metadata'
          }, 'Episode exists; proceeding with metadata updates');
        } else {
          // Otherwise use our new episode data
          flatEpisode = newEpisodeData;
          log.info({
            showTitle,
            seasonNumber: season.seasonNumber,
            episodeNumber: episode.episodeNumber,
            context: 'episode_created_metadata'
          }, 'Created new episode during metadata sync');
        }
      }

      // Proceed with traditional sync
      const result = await syncEpisodeMetadataLegacy(
        client, show, season, episode, flatShow, flatSeason, flatEpisode,
        fileServerSeasonData, serverConfig, fieldAvailability
      );

      // If update was successful, update the episode in database and store the new hash
      if (result) {
        // Check if we're the highest priority server for this field before storing hash
        const episodeFileName = findEpisodeFileName(
          Object.keys(fileServerSeasonData.episodes || {}),
          season.seasonNumber,
          episode.episodeNumber
        );

        const fieldPath = `seasons.Season ${season.seasonNumber}.episodes.${episodeFileName}.metadata`;
        const isHighestPriority = isCurrentServerHighestPriorityForField(
          fieldAvailability,
          'tv',
          originalTitle,
          fieldPath,
          serverConfig
        );

        // Actually update the episode in the database
        // Remove 'field' and 'updated' status fields before saving to database
        const { field, updated, ...cleanResult } = result;
        log.info({
          showTitle: show.title,
          seasonNumber: season.seasonNumber,
          episodeNumber: episode.episodeNumber,
          context: 'saving_metadata_updates'
        }, 'Saving metadata updates to database');
        await updateEpisodeInFlatDB(
          client,
          show.title,
          season.seasonNumber,
          episode.episodeNumber,
          { $set: cleanResult }
        );

        // Only store hash if we're highest priority
        if (isHighestPriority) {
          log.info({
            showTitle,
            seasonNumber: season.seasonNumber,
            episodeNumber: episode.episodeNumber,
            serverId: serverConfig.id,
            context: 'store_episode_hash'
          }, 'Storing episode hash post metadata update');
          await storeHash(client, 'tv', showTitle, season.seasonNumber, episode.episodeNumber, currentHash, serverConfig.id);
        } else {
          log.debug({
            showTitle,
            seasonNumber: season.seasonNumber,
            episodeNumber: episode.episodeNumber,
            serverId: serverConfig.id,
            context: 'skip_episode_hash'
          }, 'Skipping hash storage because server not highest priority');
        }
      }

      return result;
    }

    // Fall back to traditional sync if hash data is not available
    let flatEpisode = await getEpisodeFromFlatDB(client, showTitle, season.seasonNumber, episode.episodeNumber);

    if (!flatEpisode) {
      // Create episode data without manually setting _id - let MongoDB generate it
      const newEpisodeData = {
        showId: flatShow._id,
        seasonId: flatSeason._id,
        showTitle: showTitle,
        seasonNumber: season.seasonNumber,
        episodeNumber: episode.episodeNumber,
        type: 'episode',
        createdAt: new Date()
      };

      // Use our improved function that handles duplicates
      const createResult = await createEpisodeInFlatDB(client, newEpisodeData);

      // If there was an existing episode found during creation, use that instead
      if (createResult.existing) {
        // Fetch the existing episode to make sure we have the full data
        flatEpisode = await getEpisodeFromFlatDB(client, showTitle, season.seasonNumber, episode.episodeNumber);
          log.debug({
            showTitle: show.title,
            seasonNumber: season.seasonNumber,
            episodeNumber: episode.episodeNumber,
            context: 'episode_exists_fallback'
          }, 'Episode exists (fallback); proceeding with updates');
      } else {
        // Otherwise use our new episode data with the generated _id from MongoDB
        flatEpisode = {
          ...newEpisodeData,
          _id: createResult.insertedId
        };
        log.info({
          showTitle,
          seasonNumber: season.seasonNumber,
          episodeNumber: episode.episodeNumber,
          context: 'episode_created_fallback'
        }, 'Created new episode during fallback metadata sync');
      }
    }

    return await syncEpisodeMetadataLegacy(
      client, show, season, episode, flatShow, flatSeason, flatEpisode,
      fileServerSeasonData, serverConfig, fieldAvailability
    );
  } catch (error) {
    logError(log, error, {
      showTitle: show.title,
      seasonNumber: season.seasonNumber,
      episodeNumber: episode.episodeNumber,
      context: 'hash_metadata_sync'
    });
    return null;
  }
}

/**
 * Batch syncs TV episode metadata for a show using hash-based approach
 * @param {Object} client - MongoDB client
 * @param {Object} show - TV show object
 * @param {Array<Object>} seasons - Season objects from current database
 * @param {Object} fileServerShowData - File server data for this show
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @param {string} storedShowHash - Stored hash for the show
 * @returns {Promise<Object>} Sync results
 */
export async function syncShowEpisodesMetadataWithHashes(client, show, seasons, fileServerShowData, serverConfig, fieldAvailability, storedShowHash) {
  const log = createLogger('FlatSync.Episodes.Metadata.ShowHashSync');
  log.info({ showTitle: show.title, serverId: serverConfig.id }, 'Starting hash-based metadata sync');

  const results = {
    updated: 0,
    unchanged: 0,
    errors: 0
  };

  try {
    const showHashData = await fetchHashData(serverConfig, 'tv', show.originalTitle);
    // If show hash matches, check if we really have complete data before skipping
    if (storedShowHash === showHashData.hash) {
      // Count all episodes in the show
      const allEpisodesCount = await client
        .db('Media')
        .collection('FlatEpisodes')
        .countDocuments({
          showTitle: show.title
        });

      // Check if episodes have metadata
      const flatEpisodes = await client
        .db('Media')
        .collection('FlatEpisodes')
        .find({ showTitle: show.title })
        .toArray();

      const missingMetadataCount = flatEpisodes.filter(ep => !ep.metadata).length;

      // IMPORTANT: Also check if seasons have proper metadata
      const flatSeasons = await client
        .db('Media')
        .collection('FlatSeasons')
        .find({ showTitle: show.title })
        .toArray();

      const missingSeasonsMetadataCount = flatSeasons.filter(season => !season.metadata).length;

      // Log the current state for debugging
      log.info({
        showTitle: show.title,
        episodesFound: flatEpisodes.length,
        episodesMissingMetadata: missingMetadataCount,
        seasonsFound: flatSeasons.length,
        seasonsMissingMetadata: missingSeasonsMetadataCount
      }, 'Show metadata completeness check');

      // Create a map to store season hash data to avoid redundant API calls
      const seasonHashDataMap = new Map();

      // Calculate total expected episodes across all seasons
      let expectedEpisodeCount = 0;
      for (const seasonKey in showHashData.seasons) {
        const seasonNumber = parseInt(seasonKey);
        // Fetch season hash data once and store it for later use
        const seasonHash = await fetchHashData(serverConfig, 'tv', show.originalTitle, seasonNumber);
        if (seasonHash && seasonHash.episodes) {
          expectedEpisodeCount += Object.keys(seasonHash.episodes).length;
          // Store the season hash data for later use
          seasonHashDataMap.set(seasonNumber, seasonHash);
        }
      }

      // Count expected seasons
      const expectedSeasonCount = Object.keys(showHashData.seasons).length;

      // ONLY skip if we have ALL expected episodes AND seasons WITH metadata
      const hasAllEpisodes = (allEpisodesCount >= expectedEpisodeCount && missingMetadataCount === 0);
      const hasAllSeasons = (flatSeasons.length >= expectedSeasonCount && missingSeasonsMetadataCount === 0);

      if (hasAllEpisodes && hasAllSeasons) {
        log.info({
          showTitle: show.title,
          episodeCount: allEpisodesCount,
          seasonCount: flatSeasons.length
        }, 'Show hash unchanged and data complete; skipping');
        results.unchanged += allEpisodesCount;
        return results;
      } else {
        // Log why we're not skipping
        if (!hasAllEpisodes) {
          log.info({
            showTitle: show.title,
            haveEpisodes: allEpisodesCount,
            expectedEpisodes: expectedEpisodeCount,
            missingEpisodeMetadata: missingMetadataCount
          }, 'Episode data incomplete despite matching hash');
        }

        if (!hasAllSeasons) {
          log.info({
            showTitle: show.title,
            haveSeasons: flatSeasons.length,
            expectedSeasons: expectedSeasonCount,
            missingSeasonsMetadata: missingSeasonsMetadataCount
          }, 'Season data incomplete despite matching hash');
        }
      }
    }

    // Step 2: Process each season
    for (const season of seasons) {
      const seasonNumber = season.seasonNumber;
      const seasonKey = seasonNumber.toString();

      // Skip seasons not present in hash data
      if (!showHashData.seasons[seasonKey]) continue;

      // Check if we have a stored hash for this season
      const storedSeasonHash = await getStoredHash(client, 'tv', show.originalTitle, seasonNumber, null, serverConfig.id);
      const currentSeasonHash = showHashData.seasons[seasonKey].hash;

      // Get the file server data for this season
      const seasonKey2 = `Season ${seasonNumber}`;
      const fileServerSeasonData = fileServerShowData?.seasons?.[seasonKey2];
      if (!fileServerSeasonData) continue;

      // First, check if there are any episodes in the database for this season
      const hasEpisodesInDatabase = season.episodes && season.episodes.length > 0;

      // Count episodes in file server for this season
      const fileServerEpisodeCount = Object.keys(fileServerSeasonData.episodes || {}).length;

      // Count episodes in database for this season
      const databaseEpisodeCount = hasEpisodesInDatabase ? season.episodes.length : 0;

      // Also verify episodes exist in the actual database
      const actualEpisodeCount = await client
        .db('Media')
        .collection('FlatEpisodes')
        .countDocuments({
          showTitle: show.title,
          seasonNumber: seasonNumber
        });

      // Check if episodes have metadata
      let episodesWithoutMetadata = 0;
      if (hasEpisodesInDatabase) {
        for (const episode of season.episodes) {
          const flatEpisode = await getEpisodeFromFlatDB(client, show.originalTitle, seasonNumber, episode.episodeNumber, true);
          if (!flatEpisode || !flatEpisode.metadata) {
            episodesWithoutMetadata++;
          }
        }
      }

      // If hash matches and we have all episodes with metadata, skip this season
      if (storedSeasonHash === currentSeasonHash) {
        // Only skip if we have all episodes in the actual database AND they all have metadata
        if (actualEpisodeCount >= fileServerEpisodeCount && episodesWithoutMetadata === 0) {
          results.unchanged += fileServerEpisodeCount;
          continue;
        } else if (episodesWithoutMetadata > 0) {
          log.info({
            showTitle: show.title,
            seasonNumber,
            episodesMissingMetadata: episodesWithoutMetadata
          }, 'Season hash unchanged but episodes missing metadata; processing');
        } else {
          log.info({
            showTitle: show.title,
            seasonNumber,
            actualEpisodeCount,
            fileServerEpisodeCount
          }, 'Season hash unchanged but episodes missing from DB; processing');
        }
      }

      // Hash differs or no stored hash - fetch episode-level hashes
      const seasonHashData = await fetchHashData(serverConfig, 'tv', show.originalTitle, seasonNumber);

      if (!seasonHashData || !seasonHashData.episodes) {
        log.warn({
          showTitle: show.title,
          seasonNumber,
          context: 'season_hash_missing'
        }, 'Could not fetch season hash data');
        results.errors++;
        continue;
      }

      // Step 3: Process each episode
      const updatePromises = [];

      // Process episodes that are in the database
      if (hasEpisodesInDatabase) {
        for (const episode of season.episodes) {
          const episodeKey = `S${seasonNumber.toString().padStart(2, '0')}E${episode.episodeNumber.toString().padStart(2, '0')}`;

          // Skip episodes not present in hash data
          if (!seasonHashData.episodes[episodeKey]) continue;

          // Check if we have a stored hash for this episode
          const storedEpisodeHash = await getStoredHash(client, 'tv', show.originalTitle, seasonNumber, episode.episodeNumber, serverConfig.id);
          const currentEpisodeHash = seasonHashData.episodes[episodeKey].hash;

          // If hashes match, skip this episode only if it has metadata
          const flatEpisode = await getEpisodeFromFlatDB(client, show.title, seasonNumber, episode.episodeNumber);
          if (storedEpisodeHash === currentEpisodeHash && flatEpisode && flatEpisode.metadata) {
            results.unchanged++;
            continue;
          }

          // Hash differs or no stored hash or missing metadata - synchronize this episode
          updatePromises.push(
            (async () => {
              try {
                // Get necessary database objects
                const flatShow = show;
                let flatSeason = seasons.find(s => s.seasonNumber === seasonNumber);

                // No-op scenario - show not found
                if (!flatShow) {
                  log.error({
                    showTitle: show.title,
                    context: 'show_not_found'
                  }, 'Show not found in database');
                  results.errors++;
                  return false;
                }

                // If season not found, try to create it
                if (!flatSeason) {
                  log.warn({
                    showTitle: show.title,
                    seasonNumber,
                    context: 'season_missing_create_placeholder'
                  }, 'Season not found; creating placeholder');
                  try {
                    // Create a placeholder season
                    const newSeason = buildNewSeasonObject(flatShow, { seasonNumber });

                    const result = await createSeasonInFlatDB(client, newSeason);
                    if (result.insertedId) {
                      flatSeason = {
                        ...newSeason,
                        _id: result.insertedId
                      };
                      log.info({
                        showTitle: show.title,
                        seasonNumber,
                        context: 'created_season_placeholder'
                      }, 'Created placeholder season during metadata sync');
                    } else if (result.upsertedId) {
                      flatSeason = {
                        ...newSeason,
                        _id: result.upsertedId
                      };
                      log.info({
                        showTitle: show.title,
                        seasonNumber,
                        context: 'created_season_placeholder'
                      }, 'Created placeholder season during metadata sync');
                    } else {
                      // Try to retrieve it in case it was created concurrently
                      flatSeason = seasons.find(s => s.seasonNumber === seasonNumber);

                      if (!flatSeason) {
                        log.error({
                          showTitle: show.title,
                          seasonNumber,
                          context: 'season_create_retrieve_failed'
                        }, 'Failed to create or retrieve season');
                        results.errors++;
                        return false;
                      }
                    }
                  } catch (error) {
                    logError(log, error, {
                      showTitle: show.title,
                      seasonNumber,
                      context: 'season_create_error'
                    });
                    results.errors++;
                    return false;
                  }
                }

                // Get or create the episode
                let flatEpisode = await getEpisodeFromFlatDB(client, show.title, seasonNumber, episode.episodeNumber);

                if (!flatEpisode) {
                  flatEpisode = {
                    showId: flatShow._id,
                    seasonId: flatSeason._id,
                    showTitle: show.title,
                    seasonNumber: seasonNumber,
                    episodeNumber: episode.episodeNumber,
                    type: 'episode',
                    createdAt: new Date()
                  };
                }

                // Sync the episode metadata
                const result = await syncEpisodeMetadataLegacy(
                  client, show, season, episode, flatShow, flatSeason, flatEpisode,
                  fileServerSeasonData, serverConfig, fieldAvailability
                );

                if (result) {
                  // Actually update the episode in the database
                  // Remove 'field' and 'updated' status fields before saving to database
                  const { field, updated, ...cleanResult } = result;
                  log.info({
                    showTitle: show.title,
                    seasonNumber,
                    episodeNumber: episode.episodeNumber,
                    context: 'saving_metadata_updates_batch'
                  }, 'Saving metadata updates to database');
                  await updateEpisodeInFlatDB(
                    client,
                    show.title,
                    seasonNumber,
                    episode.episodeNumber,
                    { $set: cleanResult }
                  );

                  // Check if we're highest priority before storing hash
                  const episodeFileName = findEpisodeFileName(
                    Object.keys(fileServerSeasonData.episodes || {}),
                    seasonNumber,
                    episode.episodeNumber
                  );

                  const fieldPath = `seasons.Season ${seasonNumber}.episodes.${episodeFileName}.metadata`;
                  const isHighestPriority = isCurrentServerHighestPriorityForField(
                    fieldAvailability,
                    'tv',
                    show.originalTitle,
                    fieldPath,
                    serverConfig
                  );

                  // Only store hash if we're highest priority
                  if (isHighestPriority) {
                    log.info({
                      showTitle: show.title,
                      seasonNumber,
                      episodeNumber: episode.episodeNumber,
                      serverId: serverConfig.id,
                      context: 'store_episode_hash_batch'
                    }, 'Storing episode hash after batch update');
                    await storeHash(client, 'tv', show.title, seasonNumber, episode.episodeNumber, currentEpisodeHash, serverConfig.id);
                  } else {
                    log.debug({
                      showTitle: show.title,
                      seasonNumber,
                      episodeNumber: episode.episodeNumber,
                      serverId: serverConfig.id,
                      context: 'skip_episode_hash_batch'
                    }, 'Skipping hash storage (not highest priority)');
                  }

                  results.updated++;
                  return true;
                }

                return false;
              } catch (error) {
                logError(log, error, {
                  showTitle: show.title,
                  seasonNumber,
                  episodeNumber: episode.episodeNumber,
                  context: 'sync_episode_error_batch'
                });
                results.errors++;
                return false;
              }
            })()
          );
        }
       } else {
        log.info({
          showTitle: show.title,
          seasonNumber,
          context: 'no_episodes_in_db'
        }, 'No episodes in database; checking file server');
        // No episodes in database - check for episodes in file server
        log.info({
          showTitle: show.title,
          seasonNumber,
          context: 'no_episodes_in_db_file_server_check'
        },
        `No episodes found in database for season ${seasonNumber} of "${show.title}" - checking file server`);
      }

      // Also check for episodes in the file server that aren't in the database
      // Get all episodes in the file server for this season
      const episodeFileNames = Object.keys(fileServerSeasonData.episodes || {});

      for (const episodeFileName of episodeFileNames) {
        // Extract episode number from filename
        const match = episodeFileName.match(/S\d+E(\d+)/i) || episodeFileName.match(/E(\d+)/i);
        if (!match) continue;

        const episodeNumber = parseInt(match[1], 10);

        // Check if this episode exists in the current database
        const episodeExists = hasEpisodesInDatabase &&
          season.episodes.some(e => e.episodeNumber === episodeNumber);

        // If episode doesn't exist in database, process it
        if (!episodeExists) {
          log.info({
            showTitle: show.title,
            seasonNumber,
            episodeNumber,
            context: 'missing_episode_found'
          }, 'Found missing episode to sync');

          // Create a temporary episode object
          const tempEpisode = { episodeNumber };

          // Process this episode
          updatePromises.push(
            (async () => {
              try {
                // Get necessary database objects
                const flatShow = show;
                const flatSeason = seasons.find(s => s.seasonNumber === seasonNumber);

                // No-op scenario - show or season not found
                if (!flatShow || !flatSeason) {
                  log.error({
                    showTitle: show.title,
                    seasonNumber,
                    episodeNumber: episode.episodeNumber,
                    context: 'episode_or_season_missing'
                  }, 'Show or season not found when processing episode');
                  results.errors++;
                  return false;
                }

                // Create the episode
                const flatEpisode = {
                  showId: flatShow._id,
                  seasonId: flatSeason._id,
                  showTitle: show.title,
                  seasonNumber: seasonNumber,
                  episodeNumber: episodeNumber,
                  type: 'episode',
                  createdAt: new Date()
                };

                // Create a temporary season object with the episode
                const tempSeason = { ...season, seasonNumber };

                // Sync the episode metadata
                const result = await syncEpisodeMetadataLegacy(
                  client, show, tempSeason, tempEpisode, flatShow, flatSeason, flatEpisode,
                  fileServerSeasonData, serverConfig, fieldAvailability
                );

                if (result) {
                  // Create the episode in the database with all metadata fields
                  let episodeToCreate = { ...flatEpisode };

                  // If we have metadata, extract useful fields
                  if (fileServerSeasonData.episodes[episodeFileName]?.metadata) {
                    const episodeMetadataURL = fileServerSeasonData.episodes[episodeFileName].metadata;
                    // Fetch the actual metadata from the server
                    const epMeta = await fetchMetadataMultiServer(
                      serverConfig.id,
                      episodeMetadataURL,
                      'file',
                      'tv',
                      show.title
                    );

                    // Add title from metadata if available
                    if (epMeta.name) {
                      episodeToCreate.title = epMeta.name;
                    }

                    // Add overview/description if available
                    if (epMeta.overview) {
                      episodeToCreate.overview = epMeta.overview;
                    }

                    // Add air date if available
                    if (epMeta.air_date) {
                      episodeToCreate.airDate = new Date(epMeta.air_date);
                    }

                    // Add runtime if available
                    if (epMeta.runtime) {
                      episodeToCreate.runtime = epMeta.runtime;
                    }

                    // Add rating if available
                    if (epMeta.vote_average) {
                      episodeToCreate.rating = epMeta.vote_average;
                    }

                    // Add still image path if available
                    if (epMeta.still_path) {
                      episodeToCreate.stillPath = epMeta.still_path;
                    }

                    // Add crew information if available
                    if (epMeta.crew && epMeta.crew.length > 0) {
                      episodeToCreate.crew = epMeta.crew;
                    }

                    // Add guest stars if available
                    if (epMeta.guest_stars && epMeta.guest_stars.length > 0) {
                      episodeToCreate.guestStars = epMeta.guest_stars;
                    }
                  }

                  // Remove status fields before saving to database
                  const { field, updated, ...cleanResult } = result;

                  // Use createEpisodeInFlatDB which handles duplicate episodes properly
                  // rather than updateEpisodeInFlatDB which can cause duplicate key errors
                  const episodeData = {
                    ...episodeToCreate,
                    ...cleanResult
                  };

                  log.info({
                    showTitle: show.title,
                    seasonNumber,
                    episodeNumber,
                    context: 'create_or_update_episode'
                  }, 'Creating/updating episode with duplicate checking');
                  await createEpisodeInFlatDB(client, episodeData);

                  // Check if we're highest priority before storing hash for new episodes
                  const fieldPath = `seasons.Season ${seasonNumber}.episodes.${episodeFileName}.metadata`;
                  const isHighestPriority = isCurrentServerHighestPriorityForField(
                    fieldAvailability,
                    'tv',
                    show.originalTitle,
                    fieldPath,
                    serverConfig
                  );

                  // Only store hash if we're highest priority
                  const episodeKey = `S${seasonNumber.toString().padStart(2, '0')}E${episodeNumber.toString().padStart(2, '0')}`;
                  if (seasonHashData.episodes[episodeKey] && isHighestPriority) {
                    log.info({
                      showTitle: show.title,
                      seasonNumber,
                      episodeNumber,
                      serverId: serverConfig.id,
                      context: 'store_episode_hash_batch'
                    }, 'Storing episode hash after batch metadata update');
                    await storeHash(
                      client,
                      'tv',
                      show.title,
                      seasonNumber,
                      episodeNumber,
                      seasonHashData.episodes[episodeKey].hash,
                      serverConfig.id
                    );
                  } else if (seasonHashData.episodes[episodeKey]) {
                    log.debug({
                      showTitle: show.title,
                      seasonNumber,
                      episodeNumber: episode.episodeNumber,
                      serverId: serverConfig.id,
                      context: 'skip_episode_hash_batch'
                    }, 'Skipping episode hash storage (not highest priority)');
                  }

                  results.updated++;
                  return true;
                }

                return false;
              } catch (error) {
                logError(log, error, {
                  showTitle: show.title,
                  seasonNumber,
                  episodeNumber: episode.episodeNumber,
                  context: 'sync_episode_error'
                });
                results.errors++;
                return false;
              }
            })()
          );
        }
      }

      // Wait for all episode updates to complete
      const updateResults = await Promise.all(updatePromises);

      // Only store the season hash if we actually made updates from this server
      // This prevents lower priority servers from storing hashes that would invalidate higher priority data
      const didUpdateAnyEpisode = updateResults.some(result => result === true);
      if (didUpdateAnyEpisode) {
        log.info({
          showTitle: show.title,
          seasonNumber,
          serverId: serverConfig.id
        }, 'Storing season hash after episode updates');
        await storeHash(client, 'tv', show.title, seasonNumber, null, currentSeasonHash, serverConfig.id);
      }
    }

    // Store the show-level hash if updates were made or we completed processing 
    // This will help future runs skip hash fetching entirely
    if (results.updated > 0) {
      log.info({
        showTitle: show.title,
        serverId: serverConfig.id
      }, 'Storing show-level hash after successful update');
      await storeHash(client, 'tv', show.title, null, null, showHashData.hash, serverConfig.id);
    } else if (showHashData.hash !== showHashData.hash && results.unchanged > 0) {
      // Also store hash if it's different but we processed all episodes successfully
      log.info({
        showTitle: show.title,
        serverId: serverConfig.id
      }, 'Updating show-level hash (all episodes verified)');
      await storeHash(client, 'tv', show.title, null, null, showHashData.hash, serverConfig.id);
    }

    log.info({
      showTitle: show.title,
      updated: results.updated,
      unchanged: results.unchanged,
      errors: results.errors
    }, 'Hash-based sync complete');
    return results;
  } catch (error) {
    logError(log, error, {
      showTitle: show.title,
      context: 'hash_based_metadata_sync'
    });
    return results;
  }
}
