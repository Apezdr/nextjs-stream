import clientPromise from '@src/lib/mongodb'
import chalk from 'chalk'
import { updateLastSynced } from './sync/database'
import { processMovie, processTVShow } from './sync_utils'
import {
  syncToFlatStructure,
  buildEnhancedFlatDBStructure,
  checkAvailabilityAcrossAllServers,
} from './flatSync'
import { syncEventBus } from './sync/core/events'
import { MediaType, SyncOperation } from './sync/core'

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
  missingMedia.movies = missingMedia.movies.filter(
    (movie) => !contentAddedToDB.movies.includes(movie)
  )
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

  // Signal to SSE subscribers that sync is starting (warming up)
  syncEventBus.emitStarted('__sync_warmup__', MediaType.Movie, 'server-all')

  // Process each server sequentially to avoid overwhelming the system
  for (const [serverId, fileServer] of Object.entries(fileServers)) {
    console.info(chalk.bold.cyan(`\nProcessing server: ${serverId}`))

    try {
      const serverConfig = {
        id: serverId,
        ...fileServer.config,
      }

      // Initialize missing media tracking for this server
      results.missingMedia[serverId] = { movies: [], tv: [] }
      results.missingMp4[serverId] = { movies: [], tv: [] }

      // Signal that this server is beginning sync
      syncEventBus.emitStarted('__server_start__', MediaType.Movie, serverId)

      try {
        // Get client for database access
        const client = await clientPromise

        // Run missing-media detection and the actual sync in parallel.
        // Previously the flatDB scan ran serially before syncToFlatStructure started,
        // causing a visible startup delay (items wouldn't appear until the scan finished).
        // The flatDB is only needed for the missing-media summary report — not for the sync.
        const [flatDB, syncResult] = await Promise.all([
          buildEnhancedFlatDBStructure(client, fileServer, fieldAvailability),
          syncToFlatStructure(
            fileServer,
            serverConfig,
            fieldAvailability,
            false,
            true,
            {
              useNewArchitecture: options.useNewArchitecture,
              forceOldArchitecture: options.forceOldArchitecture,
            }
          )
        ])

        // Process missing movies
        if (flatDB.missingMovies && flatDB.missingMovies.length > 0) {
          results.missingMedia[serverId].movies = flatDB.missingMovies
        }

        // Process missing TV shows
        if (flatDB.missingTVShows && flatDB.missingTVShows.length > 0) {
          const missingTV = flatDB.missingTVShows.map((show) => ({
            showTitle: show.title,
            seasons: [],
          }))
          results.missingMedia[serverId].tv = missingTV
        }

        // Identify missing MP4 files from fileServer data
        if (fileServer.movies) {
          Object.keys(fileServer.movies).forEach((movieTitle) => {
            if (!fileServer.movies[movieTitle].urls?.mp4) {
              results.missingMp4[serverId].movies.push(movieTitle)
            }
          })
        }

        if (fileServer.tv) {
          Object.keys(fileServer.tv).forEach((showTitle) => {
            let hasValidEpisodes = false
            const showData = fileServer.tv[showTitle]
            if (!showData.seasons || Object.keys(showData.seasons).length === 0) {
              results.missingMp4[serverId].tv.push(showTitle)
              return
            }
            for (const seasonKey of Object.keys(showData.seasons)) {
              const seasonData = showData.seasons[seasonKey]
              if (!seasonData.episodes || Object.keys(seasonData.episodes).length === 0) {
                results.missingMp4[serverId].tv.push(`${showTitle} - ${seasonKey}`)
                continue
              }
              let validEpisodesFound = false
              for (const episodeKey of Object.keys(seasonData.episodes)) {
                if (seasonData.episodes[episodeKey].videoURL) {
                  validEpisodesFound = true
                  hasValidEpisodes = true
                  break
                }
              }
              if (!validEpisodesFound) {
                results.missingMp4[serverId].tv.push(`${showTitle} - ${seasonKey}`)
              }
            }
            if (!hasValidEpisodes && !results.missingMp4[serverId].tv.includes(showTitle)) {
              results.missingMp4[serverId].tv.push(showTitle)
            }
          })
        }

        // Store the sync results for reference
        results.flatSyncResults = results.flatSyncResults || {}
        results.flatSyncResults[serverId] = syncResult

        // Signal that this server finished successfully
        syncEventBus.emitComplete('__server_complete__', MediaType.Movie, serverId)
      } catch (error) {
        // Signal server completion even on failure so the UI updates
        syncEventBus.emitComplete('__server_complete__', MediaType.Movie, serverId)

        console.error(chalk.red(`❌ Error identifying missing media for server ${serverId}:`))
        console.error(chalk.red(`   Error Type: ${error.constructor.name}`))
        console.error(chalk.red(`   Message: ${error.message}`))
        if (error.stack) {
          console.error(chalk.dim(`   Stack: ${error.stack}`))
        }

        results.errors.push({
          serverId,
          errorType: error.constructor.name,
          error: error.message,
          phase: 'missingMediaIdentification',
          stack: error.stack,
          context: {
            hasFileServerData: !!fileServer,
            hasFieldAvailability: !!fieldAvailability,
          },
        })
      }
    } catch (error) {
      // Catch errors from outer try block (server processing)
      console.error(chalk.red(`❌ Error processing server ${serverId}:`))
      console.error(chalk.red(`   Error: ${error.message}`))
      results.errors.push({
        serverId,
        error: error.message,
        phase: 'server_processing',
        stack: error.stack,
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

  // Signal SSE subscribers that the sync is fully complete — fires immediately so
  // the popup closes. The availability check / migration / validation below runs
  // as a background task and does not block the user-facing sync completion.
  syncEventBus.emitComplete(
    '__sync_complete__',
    MediaType.Movie,
    'server-all',
    SyncOperation.Metadata,
    { summary: results }
  )

  // Run post-sync cleanup in the background — does not block __sync_complete__ above.
  // Includes: stale video detection/removal, WatchHistory migration, WatchHistory validation.
  Promise.resolve().then(async () => {
    try {
      console.log(chalk.bold.yellow('Performing post-sync availability check (background)...'))
      const finalAvailabilityResults = await checkAvailabilityAcrossAllServers(
        fileServers,
        fieldAvailability
      )
      results.finalAvailabilityResults = finalAvailabilityResults
      console.log(chalk.bold.yellow('Post-sync availability check complete'))
    } catch (error) {
      console.error(chalk.red(`❌ Post-sync availability check failed: ${error.message}`))
    }
  })

  return results
}
