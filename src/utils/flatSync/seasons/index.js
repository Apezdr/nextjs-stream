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
import { getShowFromMemory, getSeasonFromMemory, createSeasonInMemory } from '../memoryUtils';

/**
 * Builds a new season object with proper defaults
 * @param {Object} show - Show object with _id and title 
 * @param {Object} season - Basic season info with seasonNumber
 * @returns {Object} New season object ready for database insertion
 */
export function buildNewSeasonObject(show, season) {
  return {
    _id: new ObjectId(),
    showId: show._id,
    showTitle: show.title,
    seasonNumber: season.seasonNumber,
    type: 'season',
    createdAt: new Date()
  };
}

/**
 * Syncs a single TV season from file server to flat database structure
 * @param {Object} client - MongoDB client
 * @param {Object} show - TV show object from current database
 * @param {Object} season - Season object from current database
 * @param {Object} fileServerShowData - File server data for this show
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @param {Object} enhancedData - Enhanced data structure with lookup maps
 * @returns {Promise<Object>} Sync results for this season
 */
async function syncSingleSeason(client, show, season, fileServerShowData, serverConfig, fieldAvailability, enhancedData) {
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
    if (!fileServerSeasonData) {
      console.error(`No file server data found for "${show.title}" Season ${season.seasonNumber}`);
      results.errors.push({ field: 'fileServer', error: `No file server data found for "${show.title}" Season ${season.seasonNumber}` });
      return results;
    }
    
    // Try to get the TV show from memory first if we have enhanced data
    let flatShow = null;
    const hasEnhancedData = enhancedData && enhancedData.lookups && 
                          enhancedData.lookups.tvShows && enhancedData.lookups.seasons;
    
    if (hasEnhancedData) {
      // Try to find the show in memory by original title first
      flatShow = getShowFromMemory(enhancedData, show.originalTitle, true);
      
      // If not found, try by title
      if (!flatShow) {
        flatShow = getShowFromMemory(enhancedData, show.title);
      }
      
      if (flatShow) {
        console.log(chalk.green(`Found TV show "${show.title}" in memory lookups for season processing`));
      }
    }
    
    // Fall back to database lookup if not found in memory
    if (!flatShow) {
      flatShow = await getTVShowFromFlatDB(client, show.originalTitle);
    }
    
    if (!flatShow) {
      results.errors.push({ field: 'general', error: 'TV show not found in flat structure' });
      return results;
    }
    
    // Try to get the season from memory first if we have enhanced data
    let flatSeason = null;
    if (hasEnhancedData) {
      flatSeason = getSeasonFromMemory(enhancedData, flatShow.title, season.seasonNumber);
      
      if (flatSeason) {
        console.log(chalk.green(`Found Season ${season.seasonNumber} for "${show.title}" in memory lookups`));
      }
    }
    
    // Fall back to database lookup if not found in memory
    if (!flatSeason) {
      flatSeason = await getSeasonFromFlatDB(client, show.title, season.seasonNumber);
    }
    
    if (!flatSeason) {
      // Create a new season in the flat database
      const newSeason = buildNewSeasonObject(flatShow, season);
      
      // Create in database
      await createSeasonInFlatDB(client, newSeason);
      
      // If we have enhanced data, also add to memory for future lookups
      if (hasEnhancedData) {
        flatSeason = createSeasonInMemory(enhancedData, newSeason);
      } else {
        flatSeason = newSeason;
      }
      
      results.created = true;
    }
    
    // Sync metadata
    try {
      const metadataResult = await syncSeasonMetadata(client, show, flatSeason, fileServerSeasonData, serverConfig, fieldAvailability);
      if (metadataResult) {
        results.updated = true;
        results.fields.push(metadataResult.field);
      }
    } catch (error) {
      results.errors.push({ field: 'metadata', error: error.message });
    }
    
    // Sync poster
    try {
      const posterResult = await syncSeasonPoster(client, show, flatSeason, fileServerSeasonData, serverConfig, fieldAvailability);
      if (posterResult) {
        results.updated = true;
        results.fields.push(posterResult.field);
      }
    } catch (error) {
      results.errors.push({ field: 'poster', error: error.message });
    }
    
    // Sync blurhash
    try {
      const blurhashResult = await syncSeasonPosterBlurhash(client, show, flatSeason, fileServerSeasonData, serverConfig, fieldAvailability);
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

    // Check if we have enhanced data with lookup maps
    const hasEnhancedData = flatDB.lookups && flatDB.lookups.tvShows && flatDB.lookups.seasons;
    if (hasEnhancedData) {
      console.log(chalk.green('Using enhanced in-memory lookups for TV season sync'));
    } else {
      console.log(chalk.yellow('Enhanced memory lookups not available, using database queries'));
      
      // Create a mapping of titles to TV shows in the database for easy lookup when not using memory
      const dbShowMap = flatDB.tv.reduce((map, show) => {
        // Also create a mapping of season numbers to seasons for each show
        const seasonMap = show?.seasons?.reduce((sMap, season) => {
          sMap[season.seasonNumber] = season;
          return sMap;
        }, {});

        map[show.originalTitle] = {
          show,
          seasons: seasonMap
        };
        return map;
      }, {});
      
      // Assign to flatDB for use in the loop below
      flatDB.dbShowMap = dbShowMap;
    }

    // First, collect all unique seasons across all shows from the database
    const allKnownSeasons = new Map(); // Map of showTitle -> Set of season numbers
    
    // Initialize map with seasons from the flatDB
    for (const show of flatDB.tv) {
      if (!show.seasons || show.seasons.length === 0 || !show.title) continue;
      
      if (!allKnownSeasons.has(show.title)) {
        allKnownSeasons.set(show.title, new Set());
      }
      
      for (const season of show.seasons) {
        if (season.seasonNumber !== undefined) {
          allKnownSeasons.get(show.title).add(season.seasonNumber);
        }
      }
    }
    
    // Add seasons from the current file server
    for (const [showTitle, fileServerShowData] of Object.entries(fileServer.tv)) {
      if (!fileServerShowData.seasons) continue;
      
      if (!allKnownSeasons.has(showTitle)) {
        allKnownSeasons.set(showTitle, new Set());
      }
      
      for (const seasonKey of Object.keys(fileServerShowData.seasons)) {
        const seasonNumberMatch = seasonKey.match(/Season (\d+)/);
        if (!seasonNumberMatch) continue;
        const seasonNumber = parseInt(seasonNumberMatch[1], 10);
        allKnownSeasons.get(showTitle).add(seasonNumber);
      }
    }
    
    console.log(chalk.cyan(`Found ${Array.from(allKnownSeasons.keys()).length} shows with seasons to process`));

    // Process each TV show
    for (const [showTitle, seasonNumbers] of allKnownSeasons.entries()) {
      const fileServerShowData = fileServer.tv[showTitle];
      
      // Skip if no file server data for this show
      if (!fileServerShowData) {
        console.log(chalk.yellow(`No file server data for "${showTitle}" - skipping seasons`));
        continue;
      }
      
      // Get the show from enhanced data or database
      let show;
      if (hasEnhancedData) {
        // Try to find the show in memory 
        show = getShowFromMemory(flatDB, showTitle, true);
        
        // If not found by original title, try by title
        if (!show) {
          show = getShowFromMemory(flatDB, showTitle);
        }
      } else {
        // Get from the database map
        const dbShowEntry = flatDB.dbShowMap[showTitle];
        show = dbShowEntry?.show;
      }
      
      // If show not found in enhanced data or db map, fetch directly from database
      if (!show) {
        console.warn(chalk.yellow(`Show "${showTitle}" not found in memory, fetching from database...`));
        show = await getTVShowFromFlatDB(client, showTitle);
      }
      
      // Last resort - barebones object (should rarely happen)
      if (!show) {
        console.error(chalk.red(`Show "${showTitle}" not found in any data source, using minimal placeholder`));
        show = { title: showTitle, originalTitle: showTitle };
      }

      // For hash-based sync, get the show hash data if available
      let showHashData = null;
      if (syncStrategy === 'hash-based' && mediaHashResponse?.titles?.[showTitle]) {
        showHashData = mediaHashResponse.titles[showTitle];
      }

      // Process each known season for this show
      for (const seasonNumber of seasonNumbers) {
        try {
          const seasonKey = `Season ${seasonNumber}`;
          const fileServerSeasonData = fileServerShowData?.seasons?.[seasonKey];
          
          // Get the season from database or create a simple object with basic properties
          const dbShowEntry = flatDB.dbShowMap?.[showTitle];
          const season = dbShowEntry?.seasons?.[seasonNumber] || { 
            seasonNumber,
            showTitle
          };

          const seasonInDB = !!dbShowEntry?.seasons?.[seasonNumber];

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
            if (storedSeasonHash === currentSeasonHash && seasonInDB) {
              // Only skip if the season is actually in the DB
              console.log(chalk.green(`Season hash unchanged for "${showTitle}" Season ${seasonNumber} - skipping processing`));
              results.skippedSeasons++;
              continue; // Skip to the next season
            } else {
              console.log(chalk.yellow(`Season hash changed or not stored for "${showTitle}" Season ${seasonNumber} - processing`));
            }
          }
          // --- End revised season hash logic ---

          // If the season doesn't exist on this server, log it but still try to process
          // This allows seasons that only exist on other servers to be created
          if (!fileServerSeasonData) {
            console.log(chalk.yellow(`Season ${seasonNumber} of "${showTitle}" doesn't exist on server ${serverConfig.id} but may exist elsewhere`));
          }

          // Process the season with enhanced data if available
          const seasonResults = await syncSingleSeason(
            client,
            show,
            season,
            fileServerShowData || { seasons: {} }, // Provide empty seasons object if missing
            serverConfig,
            fieldAvailability,
            hasEnhancedData ? flatDB : null
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
