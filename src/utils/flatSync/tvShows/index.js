/**
 * TV show sync utilities for flat database structure
 */

import clientPromise from '@src/lib/mongodb';
import { createLogger, logError } from '@src/lib/logger';
import { ObjectId } from 'mongodb';
import { createTVShowInFlatDB, getTVShowFromFlatDB } from './database';
import { syncTVShowMetadata } from './metadata';
import { syncTVShowPoster } from './poster';
import { syncTVShowBackdrop } from './backdrop';
import { syncTVShowBlurhash } from './blurhash';
import { syncTVShowLogos } from './logos';
import { getShowFromMemory, createShowInMemory, hasTVShowValidVideoURLs } from '../memoryUtils';

/**
 * Syncs a single TV show from file server to flat database structure
 * @param {Object} client - MongoDB client
 * @param {string} showTitle - Title of the show from the file server
 * @param {Object} fileServerData - File server data for this show
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @param {Object} enhancedData - Enhanced data structure with lookup maps
 * @returns {Promise<Object>} Sync results for this show
 */
async function syncSingleTVShow(client, showTitle, fileServerData, serverConfig, fieldAvailability, enhancedData) {
  const log = createLogger('FlatSync.TVShows');
  
  const results = {
    title: showTitle,
    updated: false,
    fields: [],
    errors: []
  };
  
  try {
    // Check if this show has any valid videoURLs
    const hasValidVideoURLs = hasTVShowValidVideoURLs(fileServerData);
    
    if (!hasValidVideoURLs) {
      log.debug({ 
        serverId: serverConfig.id,
        showTitle,
        reason: 'no_valid_video_urls' 
      }, 'Skipping TV show - no episodes with valid videoURLs');
      results.skipped = true;
      results.skippedReason = 'no_valid_video_urls';
      return results;
    }
    
    // Try to get the show from memory first, if we have enhanced data
    let flatShow = null;
    const hasEnhancedData = enhancedData && enhancedData.lookups && enhancedData.lookups.tvShows;
    
    if (hasEnhancedData) {
      // Try to find the show by original title first (most file server titles are original titles)
      flatShow = getShowFromMemory(enhancedData, showTitle, true);
      
      // If not found by original title, try by title
      if (!flatShow) {
        flatShow = getShowFromMemory(enhancedData, showTitle);
      }
      
      if (flatShow) {
        log.debug({ 
          serverId: serverConfig.id,
          showTitle,
          lookupMethod: 'memory'
        }, 'Found TV show in memory lookups');
      }
    }
    
    // Fall back to database lookup if not found in memory
    if (!flatShow) {
      flatShow = await getTVShowFromFlatDB(client, showTitle);
    }
    
    if (!flatShow) {
      // Create a new TV show in the flat database
      const newShow = {
        _id: new ObjectId(),
        title: showTitle,
        type: 'tvShow',
        createdAt: new Date()
      };
      
      // Create in database
      await createTVShowInFlatDB(client, newShow);
      
      // If we have enhanced data, also create in memory for future lookups
      if (hasEnhancedData) {
        flatShow = createShowInMemory(enhancedData, newShow);
      } else {
        flatShow = newShow;
      }
      
      results.created = true;
    }
    
    // Sync metadata
    try {
      const metadataResult = await syncTVShowMetadata(client, flatShow, fileServerData, serverConfig, fieldAvailability);
      if (metadataResult) {
        results.updated = true;
        results.fields.push(metadataResult.field);
      }
    } catch (error) {
      results.errors.push({ field: 'metadata', error: error.message });
    }
    
    // Sync poster
    try {
      const posterResult = await syncTVShowPoster(client, flatShow, fileServerData, serverConfig, fieldAvailability);
      if (posterResult) {
        results.updated = true;
        results.fields.push(posterResult.field);
      }
    } catch (error) {
      results.errors.push({ field: 'poster', error: error.message });
    }
    
    // Sync backdrop
    try {
      const backdropResult = await syncTVShowBackdrop(client, flatShow, fileServerData, serverConfig, fieldAvailability);
      if (backdropResult) {
        results.updated = true;
        results.fields.push(backdropResult.field);
      }
    } catch (error) {
      results.errors.push({ field: 'backdrop', error: error.message });
    }
    
    // Sync blurhash
    // try {
    //   const blurhashResult = await syncTVShowBlurhash(client, flatShow, fileServerData, serverConfig, fieldAvailability);
    //   if (blurhashResult) {
    //     results.updated = true;
    //     results.fields.push(blurhashResult.field);
    //   }
    // } catch (error) {
    //   results.errors.push({ field: 'blurhash', error: error.message });
    // }
    
    // Sync logos
    try {
      const logosResult = await syncTVShowLogos(client, flatShow, fileServerData, serverConfig, fieldAvailability);
      if (logosResult) {
        results.updated = true;
        results.fields.push(logosResult.field);
      }
    } catch (error) {
      results.errors.push({ field: 'logos', error: error.message });
    }
    
    return results;
  } catch (error) {
    results.errors.push({ field: 'general', error: error.message });
    return results;
  }
}

/**
 * Syncs TV shows from file server to flat database structure
 * @param {Object} flatDB - Flat database structure
 * @param {Object} fileServer - File server data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object>} Sync results
 */
export async function syncTVShows(flatDB, fileServer, serverConfig, fieldAvailability) {
  const client = await clientPromise;
  const log = createLogger('FlatSync.TVShows');
  
  log.info({ serverId: serverConfig.id }, 'Starting TV show sync to flat structure');
  
  const results = {
    processed: [],
    errors: []
  };
  
  try {
    // No file server TV data, nothing to do
    if (!fileServer?.tv) {
      log.info({ serverId: serverConfig.id }, 'No TV shows found in file server');
      return results;
    }
    
    // Check if we have enhanced data with lookup maps
    const hasEnhancedData = flatDB.lookups && flatDB.lookups.tvShows;
    const lookupMethod = hasEnhancedData ? 'enhanced_memory' : 'database_queries';
    log.info({ 
      serverId: serverConfig.id,
      lookupMethod,
      hasEnhancedData 
    }, 'TV show sync lookup method selected');
    
    // Process each TV show from the file server
    for (const [showTitle, fileServerShowData] of Object.entries(fileServer.tv)) {
      try {
        const showResults = await syncSingleTVShow(
          client,
          showTitle,
          fileServerShowData,
          serverConfig,
          fieldAvailability,
          hasEnhancedData ? flatDB : null // Pass enhanced data if available
        );
        
        results.processed.push(showResults);
      } catch (error) {
        results.errors.push({
          title: showTitle,
          error: error.message
        });
      }
    }
    
    log.info({ 
      serverId: serverConfig.id,
      processedCount: results.processed.length,
      errorCount: results.errors.length
    }, 'TV show sync to flat structure complete');
    return results;
  } catch (error) {
    logError(log, error, {
      serverId: serverConfig.id,
      context: 'tvshow_sync_general'
    });
    results.errors.push({
      general: true,
      error: error.message
    });
    return results;
  }
}
