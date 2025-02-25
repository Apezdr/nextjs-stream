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
  identifyMissingMedia,
  checkVideoAvailabilityAcrossServers,
  removeUnavailableVideos,
} from './sync/index'
import { updateLastSynced } from './sync/database'
import { processMovie, processTVShow } from './sync_utils'

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
      await syncMissingMedia(missingMedia, fileServer, serverConfig, contentAddedToDB)
      await syncMetadata(currentDB, fileServer, serverConfig, fieldAvailability)
      await syncCaptions(currentDB, fileServer, serverConfig, fieldAvailability)
      await syncChapters(currentDB, fileServer, serverConfig, fieldAvailability)
      await syncVideoURL(currentDB, fileServer, serverConfig, fieldAvailability)
      await syncLogos(currentDB, fileServer, serverConfig, fieldAvailability)
      await syncVideoInfo(currentDB, fileServer, serverConfig, fieldAvailability)
      await syncTVThumbnails(currentDB, fileServer, serverConfig, fieldAvailability)
      await syncPosterURLs(currentDB, fileServer, serverConfig, fieldAvailability)
      await syncBackdrop(currentDB, fileServer, serverConfig, fieldAvailability)
      await syncBlurhash(currentDB, fileServer, serverConfig, fieldAvailability)
    } catch (error) {
      console.error(`Error processing server ${serverId}:`, error)
      results.errors.push({
        serverId,
        error: error.message,
        phase: 'sync',
      })
    }
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
