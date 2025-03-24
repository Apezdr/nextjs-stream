import clientPromise from '@src/lib/mongodb'
import chalk from 'chalk'
import { getAllServers } from './config'
import {
  syncBackdrop,
  syncBlurhash,
  syncCaptions,
  syncChapters,
  syncLogos,
  syncMetadata,
  syncPosterURLs,
  syncTVThumbnails,
  syncVideoInfo,
  syncVideoURL,
  validatePlaybackVideoUrls,
  identifyMissingMedia,
  checkVideoAvailabilityAcrossServers,
  removeUnavailableVideos,
} from './sync/index'
import { updateLastSynced } from './sync/database'
import { processMovie, processTVShow } from './sync_utils'
import { syncToFlatStructure } from './flatSync'

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
 * @param {Object} currentDB - Current database state
 * @param {Object} fileServers - File server data
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object>} Sync results
 */
export async function syncAllServers(currentDB, fileServers, fieldAvailability) {
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

  let contentAddedToDB = {
    movies: [],
    tv: [],
  }

  // To check for unavailable videos and get records to remove
  const recordsToRemove = await checkVideoAvailabilityAcrossServers(currentDB, fileServers);

  // The result will be an object with this structure:
  // {
  //   movies: ['Movie Title 1', 'Movie Title 2', ...],
  //   tvEpisodes: [
  //     { showTitle: 'Show Title', seasonNumber: 1, episodeNumber: 2 },
  //     ...
  //   ]
  // }

  // Optionally, to actually remove the unavailable videos from the database:
  const removalResults = await removeUnavailableVideos(recordsToRemove);

  // Process each server sequentially to avoid overwhelming the system
  for (const [serverId, fileServer] of Object.entries(fileServers)) {
    console.info(chalk.bold.cyan(`\nProcessing server: ${serverId}`))

    try {
      const serverConfig = {
        id: serverId,
        ...fileServer.config,
      }

      // Identify missing media for this server
      const { missingMedia, missingMp4 } = await identifyMissingMedia(fileServer, currentDB)
      results.missingMedia[serverId] = missingMedia
      results.missingMp4[serverId] = missingMp4

      // Perform sync operations with server-specific configuration
      // Use a wrapper function to catch errors for each sync operation
      const syncOperations = [
        { name: 'Missing Media', fn: () => syncMissingMedia(missingMedia, fileServer, serverConfig, contentAddedToDB) },
        // { name: 'Metadata', fn: () => syncMetadata(currentDB, fileServer, serverConfig, fieldAvailability) },
        // { name: 'Captions', fn: () => syncCaptions(currentDB, fileServer, serverConfig, fieldAvailability) },
        // { name: 'Chapters', fn: () => syncChapters(currentDB, fileServer, serverConfig, fieldAvailability) },
        // { name: 'Video URLs', fn: () => syncVideoURL(currentDB, fileServer, serverConfig, fieldAvailability) },
        // { name: 'Logos', fn: () => syncLogos(currentDB, fileServer, serverConfig, fieldAvailability) },
        // { name: 'Video Info', fn: () => syncVideoInfo(currentDB, fileServer, serverConfig, fieldAvailability) },
        // { name: 'TV Thumbnails', fn: () => syncTVThumbnails(currentDB, fileServer, serverConfig, fieldAvailability) },
        // { name: 'Poster URLs', fn: () => syncPosterURLs(currentDB, fileServer, serverConfig, fieldAvailability) },
        // { name: 'Backdrop', fn: () => syncBackdrop(currentDB, fileServer, serverConfig, fieldAvailability) },
        // { name: 'Blurhash', fn: () => syncBlurhash(currentDB, fileServer, serverConfig, fieldAvailability) },
        { name: 'Playback Status Validation', fn: () => validatePlaybackVideoUrls(currentDB, fileServers) }
      ];

      // Use forceSync=true to override aggressive hash skipping
      await syncToFlatStructure(fileServer, serverConfig, fieldAvailability, false, true)

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
