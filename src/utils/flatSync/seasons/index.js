/**
 * TV season sync utilities for flat database structure
 */

import clientPromise from '@src/lib/mongodb';
import chalk from 'chalk';
import { ObjectId } from 'mongodb';
import { createSeasonInFlatDB, getSeasonFromFlatDB } from './database';
import { getTVShowFromFlatDB } from '../tvShows/database';
import { syncSeasonMetadata } from './metadata';
import { syncSeasonPoster } from './poster';
import { syncSeasonPosterBlurhash } from './blurhash';
import { fetchHashData, getStoredHash, storeHash } from '../hashStorage';
import { isCurrentServerHighestPriorityForField } from '../../sync/utils';

/**
 * Syncs a single TV season from file server to flat database structure
 * @param {Object} client - MongoDB client
 * @param {Object} show - TV show object from current database
 * @param {Object} season - Season object from current database
 * @param {Object} fileServerShowData - File server data for this show
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object>} Sync results for this season
 */
async function syncSingleSeason(client, show, season, fileServerShowData, serverConfig, fieldAvailability) {
  const results = {
    showTitle: show.title,
    seasonNumber: season.seasonNumber,
    updated: false,
    fields: [],
    errors: []
  };
  
  try {
    // Get the file server data for this season
    const seasonKey = `Season ${season.seasonNumber}`;
    const fileServerSeasonData = fileServerShowData?.seasons?.[seasonKey];
    if (!fileServerSeasonData) return results;
    
    // Get the TV show from the flat database
    const flatShow = await getTVShowFromFlatDB(client, show.originalTitle);
    if (!flatShow) {
      results.errors.push({ field: 'general', error: 'TV show not found in flat structure' });
      return results;
    }
    
    // Get the season from the flat database or create it if it doesn't exist
    let flatSeason = await getSeasonFromFlatDB(client, show.title, season.seasonNumber);
    
    if (!flatSeason) {
      // Create a new season in the flat database
      const newSeason = {
        _id: new ObjectId(),
        showId: flatShow._id,
        showTitle: show.title,
        seasonNumber: season.seasonNumber,
        type: 'season',
        createdAt: new Date()
      };
      
      await createSeasonInFlatDB(client, newSeason);
      flatSeason = newSeason;
      results.created = true;
    }
    
    // Sync metadata
    try {
      const metadataResult = await syncSeasonMetadata(client, show, season, fileServerSeasonData, serverConfig, fieldAvailability);
      if (metadataResult) {
        results.updated = true;
        results.fields.push(metadataResult.field);
      }
    } catch (error) {
      results.errors.push({ field: 'metadata', error: error.message });
    }
    
    // Sync poster
    try {
      const posterResult = await syncSeasonPoster(client, show, season, fileServerSeasonData, serverConfig, fieldAvailability);
      if (posterResult) {
        results.updated = true;
        results.fields.push(posterResult.field);
      }
    } catch (error) {
      results.errors.push({ field: 'poster', error: error.message });
    }
    
    // Sync blurhash
    try {
      const blurhashResult = await syncSeasonPosterBlurhash(client, show, season, fileServerSeasonData, serverConfig, fieldAvailability);
      if (blurhashResult) {
        results.updated = true;
        results.fields.push(blurhashResult.field);
      }
    } catch (error) {
      results.errors.push({ field: 'blurhash', error: error.message });
    }
    
    return results;
  } catch (error) {
    results.errors.push({ field: 'general', error: error.message });
    return results;
  }
}

/**
 * Syncs TV seasons from file server to flat database structure
 * @param {Object} flatDB - Flat database structure
 * @param {Object} fileServer - File server data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object>} Sync results
 */
export async function syncSeasons(flatDB, fileServer, serverConfig, fieldAvailability) {
  const client = await clientPromise;
  console.log(chalk.bold.magenta(`Starting TV season sync to flat structure for server ${serverConfig.id}...`));

  const results = {
    processed: [],
    errors: [],
    skippedSeasons: 0
  };

  try {
    // No file server TV data, nothing to do
    if (!fileServer?.tv) {
      console.log(chalk.yellow(`No TV shows found in file server ${serverConfig.id}`));
      return results;
    }

    // Determine sync strategy - hash-based or traditional
    let syncStrategy = 'traditional';
    let mediaHashResponse = null;

    try {
      // Try to get hash data from server
      mediaHashResponse = await fetchHashData(serverConfig, 'tv');
      if (mediaHashResponse) {
        console.log(chalk.cyan('Using hash-based sync for TV seasons'));
        syncStrategy = 'hash-based';
      }
    } catch (hashError) {
      console.warn(chalk.yellow('Hash-based sync failed, falling back to traditional sync:'), hashError.message);
    }

    // Create a mapping of titles to TV shows in the database for easy lookup
    const dbShowMap = flatDB.tv.reduce((map, show) => {
      // Also create a mapping of season numbers to seasons for each show
      const seasonMap = show.seasons.reduce((sMap, season) => {
        sMap[season.seasonNumber] = season;
        return sMap;
      }, {});

      map[show.originalTitle] = {
        show,
        seasons: seasonMap
      };
      return map;
    }, {});

    // Process each TV show from the file server
    for (const [showTitle, fileServerShowData] of Object.entries(fileServer.tv)) {
      // Skip if no seasons data
      if (!fileServerShowData.seasons) continue;

      // Get the show from database or create a simple object with just the title
      const dbShowEntry = dbShowMap[showTitle];
      const show = dbShowEntry?.show || { title: showTitle, originalTitle: showTitle };

      // For hash-based sync, get the show hash data if available
      let showHashData = null;
      if (syncStrategy === 'hash-based' && mediaHashResponse?.titles?.[showTitle]) {
        showHashData = mediaHashResponse.titles[showTitle];
      }

      // Process each season from the file server
      for (const [seasonKey, fileServerSeasonData] of Object.entries(fileServerShowData.seasons)) {
        try {
          // Extract season number from the key (e.g., "Season 1" -> 1)
          const seasonNumberMatch = seasonKey.match(/Season (\d+)/);
          if (!seasonNumberMatch) continue;
          const seasonNumber = parseInt(seasonNumberMatch[1], 10);

          // Get the season from database or create a simple object with basic properties
          const season = dbShowEntry?.seasons?.[seasonNumber] || { 
            seasonNumber,
            showTitle
          };

          // --- Revised season hash logic ---
          let currentSeasonHash = null;
          if (syncStrategy === 'hash-based') {
            // First, try to get the season hash from the overall show hash data
            if (showHashData && showHashData.seasons && showHashData.seasons[seasonNumber]) {
              currentSeasonHash = showHashData.seasons[seasonNumber].hash;
            } else {
              // If not available, try fetching hash data directly for this season
              const seasonHashData = await fetchHashData(serverConfig, 'tv', show.originalTitle, seasonNumber);
              if (seasonHashData && seasonHashData.hash) {
                currentSeasonHash = seasonHashData.hash;
              }
            }
          }

          if (syncStrategy === 'hash-based' && currentSeasonHash) {
            const storedSeasonHash = await getStoredHash(client, 'tv', showTitle, seasonNumber, null, serverConfig.id);
            if (storedSeasonHash === currentSeasonHash) {
              console.log(chalk.green(`Season hash unchanged for "${showTitle}" Season ${seasonNumber} - skipping processing`));
              results.skippedSeasons++;
              continue; // Skip to the next season
            } else {
              console.log(chalk.yellow(`Season hash changed or not stored for "${showTitle}" Season ${seasonNumber} - processing`));
            }
          }
          // --- End revised season hash logic ---

          // Process the season
          const seasonResults = await syncSingleSeason(
            client,
            show,
            season,
            fileServerShowData,
            serverConfig,
            fieldAvailability
          );

          if (seasonResults.updated || seasonResults.created) {
            results.processed.push(seasonResults);
          }

          const fieldPath = `metadata`;
          
          const isHighestPriority = isCurrentServerHighestPriorityForField(
            fieldAvailability,
            'tv',
            show.originalTitle,
            fieldPath,
            serverConfig
          );

          // For hash-based sync, unconditionally store the season hash (if available) after processing
          if (syncStrategy === 'hash-based' && currentSeasonHash && isHighestPriority) {
            console.log(chalk.magenta(`Storing season hash for "${showTitle}" Season ${seasonNumber} from server ${serverConfig.id}`));
            await storeHash(client, 'tv', showTitle, seasonNumber, null, currentSeasonHash, serverConfig.id);
          }
        } catch (error) {
          results.errors.push({
            showTitle,
            seasonKey,
            error: error.message
          });
        }
      }
    }

    // Log results in a consistent format
    console.log(chalk.bold.magenta(`TV season sync to flat structure complete for server ${serverConfig.id}`));
    if (syncStrategy === 'hash-based') {
      console.log(chalk.green(`Successfully processed ${results.processed.length} seasons`));
      console.log(chalk.cyan(`Skipped ${results.skippedSeasons} seasons due to hash matches`));
    } else {
      console.log(chalk.green(`Successfully processed ${results.processed.length} seasons`));
    }
    if (results.errors.length > 0) {
      console.log(chalk.red(`Encountered ${results.errors.length} errors during season sync`));
    }

    return results;
  } catch (error) {
    console.error(`Error during TV season sync to flat structure for server ${serverConfig.id}:`, error);
    results.errors.push({
      general: true,
      error: error.message
    });
    return results;
  }
}
