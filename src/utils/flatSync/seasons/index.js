/**
 * TV season sync utilities for flat database structure
 */

import clientPromise from '@src/lib/mongodb';
import { createLogger, logError } from '@src/lib/logger';
import { ObjectId } from 'mongodb';
import { createSeasonInFlatDB, getSeasonFromFlatDB, updateSeasonInFlatDB, updateSeasonShowId } from './database';
import { getTVShowFromFlatDB } from '../tvShows/database';
import { syncSeasonMetadata } from './metadata';
import { syncSeasonPoster } from './poster';
import { syncSeasonPosterBlurhash } from './blurhash';
import { fetchHashData, getStoredHash, storeHash, getHashFromAllServers, getHashFromCache } from '../hashStorage';
import { isCurrentServerHighestPriorityForField } from '../../sync/utils';
import { getShowFromMemory, getSeasonFromMemory, createSeasonInMemory } from '../memoryUtils';
import { isEqual } from 'lodash';

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
 * Creates a season in both database and memory (if enhancedData is provided)
 * @param {Object} client - MongoDB client
 * @param {Object} show - TV show object 
 * @param {Object} seasonInfo - Basic season info with seasonNumber
 * @param {Object} enhancedData - Optional enhanced data structure with lookup maps
 * @returns {Promise<Object>} Created season object
 */
export async function createAndPersistSeason(client, show, seasonInfo, enhancedData = null) {
  const log = createLogger('FlatSync.Seasons');
  
  // Create the season object
  const newSeason = buildNewSeasonObject(show, seasonInfo);
  
  // Persist to database
  const result = await createSeasonInFlatDB(client, newSeason);
  
  if (result.error) {
    logError(log, result.error, {
      showTitle: show.title,
      seasonNumber: seasonInfo.seasonNumber,
      context: 'create_season_persist'
    });
    throw new Error(`Failed to create season: ${result.error.message || 'Unknown error'}`);
  }
  
  // Add to memory if enhancedData is provided
  if (enhancedData) {
    return createSeasonInMemory(enhancedData, newSeason);
  }
  
  return newSeason;
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
      const log = createLogger('FlatSync.Seasons.Single');
      logError(log, new Error('No file server data found'), {
        showTitle: show.title,
        seasonNumber: season.seasonNumber,
        context: 'file_server_data_missing'
      });
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
        const log = createLogger('FlatSync.Seasons.Single');
        log.debug({ 
          showTitle: show.title,
          lookupMethod: 'memory'
        }, 'Found TV show in memory lookups for season processing');
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
        const log = createLogger('FlatSync.Seasons.Single');
        log.debug({ 
          showTitle: show.title,
          seasonNumber: season.seasonNumber,
          lookupMethod: 'memory'
        }, 'Found season in memory lookups');
      }
    }
    
    // Fall back to database lookup if not found in memory
    if (!flatSeason) {
      flatSeason = await getSeasonFromFlatDB(client, show.originalTitle, season.seasonNumber, true);
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
 * @param {Object[]} [allServerConfigs] - All server configs (used for pre-warming hash cache)
 * @returns {Promise<Object>} Sync results
 */
export async function syncSeasons(flatDB, fileServer, serverConfig, fieldAvailability, allServerConfigs = null) {
  const client = await clientPromise;
  const log = createLogger('FlatSync.Seasons');
  
  log.info({ serverId: serverConfig.id }, 'Starting TV season sync to flat structure');

  const results = {
    processed: [],
    errors: [],
    skippedSeasons: 0
  };

  try {
    // No file server TV data, nothing to do
    if (!fileServer?.tv) {
      log.info({ serverId: serverConfig.id }, 'No TV shows found in file server');
      return results;
    }

    // Determine sync strategy - hash-based or traditional
    let syncStrategy = 'traditional';
    let mediaHashResponse = null;

    try {
      // Pre-warm the in-memory hash cache from ALL servers upfront.
      // This avoids per-season HTTP round-trips (and the expensive 4-retry loop
      // when a show belongs to a different server than the one currently syncing).
      const configsToFetch = allServerConfigs && allServerConfigs.length > 0
        ? allServerConfigs
        : [serverConfig];

      await getHashFromAllServers(configsToFetch, 'tv');

      // Try to get hash data from the current server (for the show-level hash map)
      mediaHashResponse = await fetchHashData(serverConfig, 'tv');
      if (mediaHashResponse) {
        syncStrategy = 'hash-based';
        log.info({ 
          serverId: serverConfig.id,
          syncStrategy: 'hash-based'
        }, 'Using hash-based sync for TV seasons');
      }
    } catch (hashError) {
      log.warn({ 
        serverId: serverConfig.id,
        error: hashError.message
      }, 'Hash-based sync failed, falling back to traditional sync');
    }

    // Check if we have enhanced data with lookup maps
    const hasEnhancedData = flatDB.lookups && flatDB.lookups.tvShows && flatDB.lookups.seasons;
    const lookupMethod = hasEnhancedData ? 'enhanced_memory' : 'database_queries';
    log.info({ 
      serverId: serverConfig.id,
      lookupMethod,
      hasEnhancedData 
    }, 'TV season sync lookup method selected');

    // First, collect all unique seasons across all shows from the database
    const allKnownSeasons = new Map(); // Map of showTitle -> Set of season numbers
    
    // Initialize map with seasons from the flatDB
    for (const show of flatDB.tv) {
      if (!show.seasons || show.seasons.length === 0 || !show.originalTitle) continue;
      
      if (!allKnownSeasons.has(show.originalTitle)) {
        allKnownSeasons.set(show.originalTitle, new Set());
      }
      
      for (const season of show.seasons) {
        if (season.seasonNumber !== undefined) {
          allKnownSeasons.get(show.originalTitle).add(season.seasonNumber);
        }
      }
    }
    
    // Add seasons from the current file server
    for (const [showTitle, fileServerShowData] of Object.entries(fileServer.tv)) {
      if (!fileServerShowData.seasons || JSON.stringify(fileServerShowData.seasons) === "{}") continue;
      
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
    
    log.info({ 
      serverId: serverConfig.id,
      showsWithSeasonsCount: Array.from(allKnownSeasons.keys()).length
    }, 'Found shows with seasons to process');

    // Process each TV show
    for (const [showTitle, seasonNumbers] of allKnownSeasons.entries()) {
      const fileServerShowData = fileServer.tv[showTitle];
      
      // Skip if no file server data for this show
      if (!fileServerShowData) {
        log.debug({ 
          serverId: serverConfig.id,
          showTitle
        }, 'No file server data for show - skipping seasons');
        continue;
      }
      
      // Get the show from enhanced data or database
      let show;
      if (hasEnhancedData) {
        // Try to find the show in memory 
        show = getShowFromMemory(flatDB, showTitle, true);
        
        // If not found by original title, try by title
        if (!show) {
          show = getShowFromMemory(flatDB, flatDB.tv.find(e => e.originalTitle === showTitle)?.title);
        }
      } else {
        // Use direct array filtering instead of map lookup
        show = Array.isArray(flatDB.tv) 
        ? flatDB.tv.find(e => e.originalTitle === showTitle)
        : undefined;
      }
      
      // If show not found in enhanced data or db map, fetch directly from database
      if (!show) {
        log.warn({ 
          serverId: serverConfig.id,
          showTitle
        }, 'Show not found in memory, fetching from database');
        show = await getTVShowFromFlatDB(client, showTitle);
      }
      
      // Last resort - barebones object (should rarely happen)
      if (!show) {
        log.error({ 
          serverId: serverConfig.id,
          showTitle
        }, 'Show not found in any data source, using minimal placeholder');
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
          const dbShowEntry = flatDB.tv.find(e => e.originalTitle === showTitle);
          let season = dbShowEntry?.seasons?.find(e => e.seasonNumber === seasonNumber);

          if (!season) {
            // This shouldn't happen
            // but if it does, create a minimal season object
            log.warn({ 
              serverId: serverConfig.id,
              showTitle,
              seasonNumber
            }, 'Season not found in database, creating placeholder');
            season = flatDB.lookups.seasons.byNaturalKey.get(`${showTitle}-${seasonNumber}`);
            if (!season) {
              season = { seasonNumber, showId: dbShowEntry?._id, showTitle };
            }
          }

          const seasonInDB_withMetadata = !!dbShowEntry?.seasons?.find(e => e.seasonNumber === seasonNumber)?.metadata;

          // --- Revised season hash logic ---
          let currentSeasonHash = null;
          if (syncStrategy === 'hash-based') {
            // First, try to get the season hash from the overall show hash data
            if (showHashData && showHashData.seasons && showHashData.seasons[seasonNumber]) {
              currentSeasonHash = showHashData.seasons[seasonNumber].hash;
            } else {
              // Check the pre-warmed in-memory cache first (avoids per-season HTTP calls
              // and the 4-retry loop when the show lives on a different server).
              const cachedHash = getHashFromCache('tv', serverConfig.id, show.originalTitle, seasonNumber);
              if (cachedHash) {
                currentSeasonHash = cachedHash;
              } else {
                // Cache miss – fall back to a direct HTTP fetch (should be rare after warm-up)
                const seasonHashData = await fetchHashData(serverConfig, 'tv', show.originalTitle, seasonNumber);
                if (seasonHashData && seasonHashData.hash) {
                  currentSeasonHash = seasonHashData.hash;
                }
              }
            }
          }

          if (syncStrategy === 'hash-based' && currentSeasonHash) {
            const storedSeasonHash = await getStoredHash(client, 'tv', showTitle, seasonNumber, null, serverConfig.id);
            if (storedSeasonHash === currentSeasonHash && seasonInDB_withMetadata) {
              // Only skip if the season is actually in the DB
              log.debug({ 
                serverId: serverConfig.id,
                showTitle,
                seasonNumber,
                hashMatch: true,
                skippedReason: 'hash_unchanged'
              }, 'Season hash unchanged - skipping processing');
              results.skippedSeasons++;
              continue; // Skip to the next season
            } else {
              log.info({ 
                serverId: serverConfig.id,
                showTitle,
                seasonNumber,
                hashMatch: false,
                reason: 'hash_changed_or_missing_metadata'
              }, 'Season hash changed or metadata missing - processing');
            }
          }
          // --- End revised season hash logic ---

          // If the season doesn't exist on this server, log it but still try to process
          // This allows seasons that only exist on other servers to be created
          if (!fileServerSeasonData) {
            log.debug({ 
              serverId: serverConfig.id,
              showTitle,
              seasonNumber
            }, 'Season does not exist on server but may exist elsewhere');
            continue;
          }

          if (!isEqual(dbShowEntry._id, season.showId)) {
            await updateSeasonShowId(client, showTitle, seasonNumber, dbShowEntry._id);
            log.info({ 
              serverId: serverConfig.id,
              showTitle,
              seasonNumber
            }, 'Updated showId for season');
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
            log.info({ 
              serverId: serverConfig.id,
              showTitle,
              seasonNumber,
              hashStored: true
            }, 'Storing season hash');
            await storeHash(client, 'tv', showTitle, seasonNumber, null, currentSeasonHash, serverConfig.id);
          }
        } catch (error) {
          logError(log, error, {
            serverId: serverConfig.id,
            showTitle,
            seasonNumber,
            context: 'season_processing_error'
          });
          results.errors.push({
            showTitle,
            error: error.message
          });
        }
      }
    }

    // Log results in a consistent format
    log.info({
      serverId: serverConfig.id,
      syncStrategy,
      processedCount: results.processed.length,
      skippedCount: results.skippedSeasons,
      errorCount: results.errors.length
    }, 'TV season sync to flat structure complete');

    return results;
  } catch (error) {
    logError(log, error, {
      serverId: serverConfig.id,
      context: 'season_sync_general'
    });
    results.errors.push({
      general: true,
      error: error.message
    });
    return results;  
  }
}
