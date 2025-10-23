import clientPromise from '@src/lib/mongodb'
import chalk from 'chalk'
import {
  validatePlaybackVideoUrls,
} from './sync/index'
import { updateLastSynced } from './sync/database'
import { processMovie, processTVShow } from './sync_utils'
import { syncToFlatStructure, buildEnhancedFlatDBStructure } from './flatSync'

/**
 * Syncs missing media items that are missing from the database.
 * @param {Object} missingMedia - Missing media items
 * @param {Object} fileServer - File server data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} contentAddedToDB - Content already added to DB
 * @returns {Promise<Object>} Sync results
 */
export async function syncMissingMedia(missingMedia, fileServer, serverConfig, contentAddedToDB) {
  const client = await clientPromise
  const results = {
    processed: { movies: [], tv: [] },
    errors: { movies: [], tv: [] },
  }

  // Filter out contentAddedToDB from missingMedia
  missingMedia.movies = missingMedia.movies.filter((movie) => !contentAddedToDB.movies.includes(movie))
  missingMedia.tv = missingMedia.tv.filter((show) => !contentAddedToDB.tv.includes(show))

  try {
    // Process movies and TV shows concurrently
    const [movieResults, tvResults] = await Promise.all([
      // Process all movies concurrently
      Promise.allSettled(
        missingMedia.movies.map(async (movieTitle) => {
          try {
            await processMovie(client, movieTitle, fileServer, serverConfig)
            results.processed.movies.push({
              title: movieTitle,
              serverId: serverConfig.id,
            })
            contentAddedToDB.movies.push(movieTitle)
          } catch (error) {
            results.errors.movies.push({
              title: movieTitle,
              serverId: serverConfig.id,
              error: error.message,
            })
          }
        })
      ),

      // Process all TV shows concurrently
      Promise.allSettled(
        missingMedia.tv.map(async (show) => {
          try {
            await processTVShow(client, show, fileServer, show.showTitle, serverConfig)
            results.processed.tv.push({
              title: show.showTitle,
              serverId: serverConfig.id,
              seasons: show.seasons.length,
            })
            contentAddedToDB.tv.push(show.showTitle)
          } catch (error) {
            results.errors.tv.push({
              title: show.showTitle,
              serverId: serverConfig.id,
              error: error.message,
            })
          }
        })
      ),
    ])

    // Log results
    if (results.processed.movies.length > 0) {
      console.log(
        `Successfully processed ${results.processed.movies.length} movies from server ${serverConfig.id}`
      )
    }
    if (results.processed.tv.length > 0) {
      console.log(
        `Successfully processed ${results.processed.tv.length} TV shows from server ${serverConfig.id}`
      )
    }
    if (results.errors.movies.length > 0) {
      console.error(
        `Failed to process ${results.errors.movies.length} movies from server ${serverConfig.id}`
      )
    }
    if (results.errors.tv.length > 0) {
      console.error(
        `Failed to process ${results.errors.tv.length} TV shows from server ${serverConfig.id}`
      )
    }

    return results
  } catch (error) {
    console.error(`Error in syncMissingMedia for server ${serverConfig.id}:`, error)
    throw new Error(`Failed to sync missing media from server ${serverConfig.id}: ${error.message}`)
  }
}

/**
 * Performs a multi-server sync operation.
 * @param {Object} fileServers - File server data
 * @param {Object} fieldAvailability - Field availability map
 * @param {Object} options - Additional sync options
 * @param {boolean} options.useNewArchitecture - Force use of new architecture (overrides feature flag)
 * @param {boolean} options.forceOldArchitecture - Force use of old architecture (overrides feature flag)
 * @returns {Promise<Object>} Sync results
 */
export async function syncAllServers(fileServers, fieldAvailability, options = {}) {
  const client = await clientPromise
  const startTime = Date.now()
  console.info(
    chalk.bold.dim(`⋄⋄ Starting Multi-Server Sync ⋄⋄ [${new Date(startTime).toISOString()}]`)
  )

  const results = {
    missingMedia: {},
    missingMp4: {},
    errors: [],
  }

  // let contentAddedToDB = {
  //   movies: [],
  //   tv: [],
  // }

  // To check for unavailable videos and get records to remove
  //const recordsToRemove = await checkVideoAvailabilityAcrossServers(currentDB, fileServers);

  // The result will be an object with this structure:
  // {
  //   movies: ['Movie Title 1', 'Movie Title 2', ...],
  //   tvEpisodes: [
  //     { showTitle: 'Show Title', seasonNumber: 1, episodeNumber: 2 },
  //     ...
  //   ]
  // }

  // Optionally, to actually remove the unavailable videos from the database:
  //const removalResults = await removeUnavailableVideos(recordsToRemove);

  // Process each server sequentially to avoid overwhelming the system
  for (const [serverId, fileServer] of Object.entries(fileServers)) {
    console.info(chalk.bold.cyan(`\nProcessing server: ${serverId}`))

    try {
      const serverConfig = {
        id: serverId,
        ...fileServer.config,
      }

      // Initialize missing media tracking for this server
      results.missingMedia[serverId] = { movies: [], tv: [] };
      results.missingMp4[serverId] = { movies: [], tv: [] };

      try {
        // Get client for database access
        const client = await clientPromise;
        
        // First build the enhanced flat DB structure to identify missing media
        const flatDB = await buildEnhancedFlatDBStructure(client, fileServer, fieldAvailability);
        
        // Process missing movies
        if (flatDB.missingMovies && flatDB.missingMovies.length > 0) {
          results.missingMedia[serverId].movies = flatDB.missingMovies;
        }
        
        // Process missing TV shows
        if (flatDB.missingTVShows && flatDB.missingTVShows.length > 0) {
          // Format missing TV shows for the frontend
          const missingTV = flatDB.missingTVShows.map(show => ({
            showTitle: show.title,
            seasons: []
          }));
          
          results.missingMedia[serverId].tv = missingTV;
        }
        
        // Identify missing MP4 files from fileServer data
        // Simple implementation - check for missing video URLs
        if (fileServer.movies) {
          Object.keys(fileServer.movies).forEach(movieTitle => {
            if (!fileServer.movies[movieTitle].urls?.mp4) {
              results.missingMp4[serverId].movies.push(movieTitle);
            }
          });
        }
        
        if (fileServer.tv) {
          Object.keys(fileServer.tv).forEach(showTitle => {
            let hasValidEpisodes = false;
            
            const showData = fileServer.tv[showTitle];
            if (!showData.seasons || Object.keys(showData.seasons).length === 0) {
              results.missingMp4[serverId].tv.push(showTitle);
              return;
            }
            
            for (const seasonKey of Object.keys(showData.seasons)) {
              const seasonData = showData.seasons[seasonKey];
              
              if (!seasonData.episodes || Object.keys(seasonData.episodes).length === 0) {
                results.missingMp4[serverId].tv.push(`${showTitle} - ${seasonKey}`);
                continue;
              }
              
              let validEpisodesFound = false;
              for (const episodeKey of Object.keys(seasonData.episodes)) {
                if (seasonData.episodes[episodeKey].videoURL) {
                  validEpisodesFound = true;
                  hasValidEpisodes = true;
                  break;
                }
              }
              
              if (!validEpisodesFound) {
                results.missingMp4[serverId].tv.push(`${showTitle} - ${seasonKey}`);
              }
            }
            
            if (!hasValidEpisodes && !results.missingMp4[serverId].tv.includes(showTitle)) {
              results.missingMp4[serverId].tv.push(showTitle);
            }
          });
        }

        // Use forceSync=true to override aggressive hash skipping
        const syncResult = await syncToFlatStructure(fileServer, serverConfig, fieldAvailability, false, true, {
          useNewArchitecture: options.useNewArchitecture,
          forceOldArchitecture: options.forceOldArchitecture
        });
        
        // Store the sync results for reference
        results.flatSyncResults = results.flatSyncResults || {};
        results.flatSyncResults[serverId] = syncResult;
      } catch (error) {
        console.error(`Error identifying missing media for server ${serverId}:`, error);
        results.errors.push({
          serverId,
          error: error.message,
          phase: 'missingMediaIdentification',
          stack: error.stack
        });
      }
      
      // Perform sync operations with server-specific configuration
      const syncOperations = [
        { name: 'Playback Status Validation', fn: () => validatePlaybackVideoUrls(fileServers) }
      ];

      // Execute each sync operation and catch any errors
      for (const operation of syncOperations) {
        try {
          await operation.fn();
        } catch (error) {
          console.error(`Error in ${operation.name} sync for server ${serverId}:`, error);
          results.errors.push({
            serverId,
            error: error.message,
            phase: operation.name,
            stack: error.stack
          });
          // Continue with the next operation despite the error
        }
      }
    } catch (error) {
      console.error(`Error processing server ${serverId}:`, error)
      results.errors.push({
        serverId,
        error: error.message,
        phase: 'sync',
      })
    }
  }

  // Now that all servers have been processed, run a final availability check
  try {
    console.log(chalk.bold.yellow('Performing final availability check across all servers...'));
    
    // Import the checkAvailabilityAcrossAllServers function from flatSync
    const { checkAvailabilityAcrossAllServers } = require('./flatSync');
    
    // Run availability check with all servers' data
    const finalAvailabilityResults = await checkAvailabilityAcrossAllServers(fileServers, fieldAvailability);
    results.finalAvailabilityResults = finalAvailabilityResults;
    
    console.log(chalk.bold.yellow('Final availability check complete'));
  } catch (error) {
    console.error('Error during final availability check:', error);
    results.errors.push({
      phase: 'final-availability-check',
      error: error.message,
      stack: error.stack
    });
  }

  await updateLastSynced(client)

  const endTime = Date.now()
  const duration = (endTime - startTime) / 1000
  console.info(
    chalk.bold.dim(
      `⋄⋄ Finished Multi-Server Sync ⋄⋄ [${new Date(endTime).toISOString()}] (Total Runtime: ${duration.toFixed(2)}s)`
    )
  )

  results.duration = duration
  return results
}
