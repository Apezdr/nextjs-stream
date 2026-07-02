import { ObjectId } from 'mongodb'
import clientPromise from '@src/lib/mongodb'
import chalk from 'chalk'
import { updateLastSynced } from './sync/database'
import { processMovie, processTVShow } from './sync_utils'
import {
  syncToFlatStructure,
} from './flatSync'
import { runPostSyncCleanup } from './flatSync/postSyncCleanup'
import {
  setCurrentSyncRunId,
  clearCurrentSyncRunId,
  tryAcquireSyncLock,
  releaseSyncLock,
  getSyncLockHolder,
} from './flatSync/syncContext'
import { preTagSyncRunId } from './flatSync/preTagSyncRunId'
import { computeMissingMedia } from './flatSync/computeMissingMedia'
import { syncEventBus } from './sync/core/events'
import { MediaType, SyncOperation } from './sync/core'

// Hard ceiling on how long the orchestration single-flight lock may be held. A
// hung post-sync cleanup must never freeze every future sync — if the lock is
// not released within this window the watchdog force-releases it (the per-
// collection coverage gate keeps cleanup correct even if a later run overlaps).
const SYNC_LOCK_WATCHDOG_MS = (() => {
  const p = Number(process.env.SYNC_LOCK_WATCHDOG_MS)
  return Number.isFinite(p) && p > 0 ? p : 10 * 60 * 1000
})()

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

  // One id per orchestration. Every Flat* write that flows through the sync
  // helpers stamps records with this id; post-sync cleanup uses it to
  // identify orphans (records whose syncRunId is not the current one).
  const syncRunId = new ObjectId().toString()

  // Single-flight: at most one orchestration — through its background post-sync
  // cleanup — runs at a time. An invocation that arrives while a previous run's
  // writes or cleanup are still in flight is SKIPPED (not queued); the next
  // cadence tick re-probes the servers and runs cleanly. This prevents a new
  // run's pre-tag from racing the previous run's cleanup find→delete. The lock
  // is released in the background cleanup's finally below (watchdog backstop).
  if (!tryAcquireSyncLock(syncRunId)) {
    const holder = getSyncLockHolder()
    console.warn(chalk.yellow(
      `⚠ Sync already in progress (run ${holder?.syncRunId ?? 'unknown'}); skipping this invocation`
    ))
    return {
      syncRunId,
      skipped: true,
      reason: 'orchestration_in_progress',
      errors: [],
      changedMedia: { movies: [], shows: [], seasons: [], episodes: [] },
    }
  }
  setCurrentSyncRunId(syncRunId)

  // Bound the lock-hold time from the moment we acquire it: a watchdog
  // force-releases the lock after a hard ceiling so a hung or over-long run can
  // never freeze every future sync. Armed here (not after the write phase) so it
  // also backstops an unexpected throw before the background cleanup is
  // scheduled. The cleanup's finally clears it on the normal path; a stale run
  // whose lock is force-released is prevented from deleting by the ownership
  // re-check in runPostSyncCleanup.
  const lockWatchdog = setTimeout(() => {
    if (releaseSyncLock(syncRunId)) {
      console.error(chalk.red(
        `❌ Sync lock watchdog fired after ${SYNC_LOCK_WATCHDOG_MS}ms — force-released run ${syncRunId}`
      ))
    }
  }, SYNC_LOCK_WATCHDOG_MS)
  if (typeof lockWatchdog.unref === 'function') lockWatchdog.unref()

  const results = {
    syncRunId,
    missingMedia: {},
    missingMp4: {},
    errors: [],
    // Union (across servers) of entities re-synced this run, keyed by display
    // title. Drives the post-sync cache-invalidation POST in the route handler.
    // Populated from each server's syncResult.changedMedia (new architecture).
    changedMedia: { movies: [], shows: [], seasons: [], episodes: [] },
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
  try {
    syncEventBus.emitStarted('__sync_warmup__', MediaType.Movie, 'server-all')
  } catch (error) {
    console.error(chalk.red(`emitStarted(warmup) failed: ${error.message}`))
  }

  // Captured from pre-tag and handed to post-sync cleanup as a coverage
  // contract: cleanup deletes a collection ONLY if pre-tag proved it fully
  // stamped that collection this run (fail-closed). Declared out here so it is
  // in scope at the background cleanup call below.
  let preTagResult = null

 try {
  // Pre-tag every record currently present on a file server with the current
  // syncRunId. The per-write marker injection in the sync helpers only fires
  // for records that change; this catches the steady-state case where most
  // records are unchanged. By the time post-sync cleanup runs, anything
  // without the current marker is provably orphan.
  try {
    preTagResult = await preTagSyncRunId(fileServers, syncRunId)
  } catch (preTagError) {
    // preTagSyncRunId is fail-closed (returns a coverage report, does not throw),
    // so this only catches truly unexpected failures. Leaving preTagResult = null
    // makes cleanup treat the missing coverage contract as fail-closed (no deletes).
    console.error(chalk.red(`❌ Pre-tag step failed: ${preTagError.message}`))
    results.errors.push({
      error: preTagError.message,
      phase: 'pre_tag',
      stack: preTagError.stack,
    })
  }

  // Process each server sequentially to avoid overwhelming the system
  for (const [serverId, fileServer] of Object.entries(fileServers || {})) {
    console.info(chalk.bold.cyan(`\nProcessing server: ${serverId}`))

    try {
      const serverConfig = {
        id: serverId,
        ...fileServer.config,
      }

      // Initialize missing media tracking for this server
      results.missingMedia[serverId] = { movies: [], tv: [] }
      results.missingMp4[serverId] = { movies: [], tv: [] }

      // Compute how many entities this server will process so the UI can render
      // a real progress bar (movies + shows + seasons + episodes).
      let serverEntityTotal = 0
      try {
        if (fileServer.movies) {
          serverEntityTotal += Object.keys(fileServer.movies).length
        }
        if (fileServer.tv) {
          for (const showKey of Object.keys(fileServer.tv)) {
            serverEntityTotal += 1 // the show itself
            const seasons = fileServer.tv[showKey]?.seasons || {}
            for (const seasonKey of Object.keys(seasons)) {
              serverEntityTotal += 1 // the season itself
              const episodes = seasons[seasonKey]?.episodes || {}
              serverEntityTotal += Object.keys(episodes).length
            }
          }
        }
      } catch {
        serverEntityTotal = 0
      }

      // Signal that this server is beginning sync
      syncEventBus.emitStarted('__server_start__', MediaType.Movie, serverId, undefined, {
        total: serverEntityTotal,
      })

      try {
        // Run missing-media detection and the actual sync in parallel.
        // Previously this used `buildEnhancedFlatDBStructure`, which loaded
        // every Flat* record into 15 in-memory Maps (~414 MB old_space per
        // cycle per SigNoz). The missing-media report only needs two
        // projection-only finds + a Set diff — see computeMissingMedia.js.
        const [missingMedia, syncResult] = await Promise.all([
          computeMissingMedia(fileServer, fieldAvailability),
          syncToFlatStructure(
            fileServer,
            serverConfig,
            fieldAvailability,
            false,
            Boolean(options.forceSync),
            {
              useNewArchitecture: options.useNewArchitecture,
              forceOldArchitecture: options.forceOldArchitecture,
              // Authoritative-pass gate for field-absence cleanup: true only when
              // every enabled file server responded this run (computed in the route
              // handler). Threaded unchanged into SyncContext.cleanup.
              allEnabledServersProbed: options.allEnabledServersProbed === true,
            }
          )
        ])

        // Process missing movies
        if (missingMedia.missingMovies && missingMedia.missingMovies.length > 0) {
          results.missingMedia[serverId].movies = missingMedia.missingMovies
        }

        // Process missing TV shows
        if (missingMedia.missingTVShows && missingMedia.missingTVShows.length > 0) {
          const missingTV = missingMedia.missingTVShows.map((show) => ({
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

        // Accumulate changed entities for post-sync cache invalidation. Only the
        // new architecture populates changedMedia; the old-arch path omits it, so
        // guard. Duplicates across servers are fine — the revalidate route builds
        // a tag Set which dedupes.
        if (syncResult?.changedMedia) {
          results.changedMedia.movies.push(...(syncResult.changedMedia.movies || []))
          results.changedMedia.shows.push(...(syncResult.changedMedia.shows || []))
          results.changedMedia.seasons.push(...(syncResult.changedMedia.seasons || []))
          results.changedMedia.episodes.push(...(syncResult.changedMedia.episodes || []))
        }

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

  try {
    await updateLastSynced(client)
  } catch (error) {
    results.errors.push({ error: error.message, phase: 'update_last_synced', stack: error.stack })
  }
 } finally {
  // The "writing phase" of this orchestration ends here. Clear before any
  // background task starts so a follow-up syncAllServers invocation that
  // overlaps in wall-clock time doesn't see this one's id. The post-sync
  // cleanup that fires below receives syncRunId as an explicit argument.
  clearCurrentSyncRunId()
 }

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
  try {
    syncEventBus.emitComplete(
      '__sync_complete__',
      MediaType.Movie,
      'server-all',
      SyncOperation.Metadata,
      { summary: results }
    )
  } catch (error) {
    console.error(chalk.red(`emitComplete failed: ${error.message}`))
  }

  // Run post-sync cleanup in the background — does not block __sync_complete__ above.
  // Includes: stale video detection/removal, WatchHistory migration, WatchHistory validation.
  // The orchestration lock is held until cleanup settles (so the next run cannot
  // race this run's find→delete), then released in the finally (the watchdog
  // armed at acquire is the liveness backstop; ownership is re-checked inside
  // runPostSyncCleanup before any delete, so a force-released stale run cannot
  // reap a newer run's records).
  Promise.resolve().then(async () => {
    try {
      console.log(chalk.bold.yellow('Performing post-sync cleanup (background)...'))
      const finalAvailabilityResults = await runPostSyncCleanup(
        fileServers,
        fieldAvailability,
        { syncRunId, preTagCoverage: preTagResult, runStartedAt: startTime }
      )
      results.finalAvailabilityResults = finalAvailabilityResults
      console.log(chalk.bold.yellow('Post-sync cleanup complete'))
    } catch (error) {
      console.error(chalk.red(`❌ Post-sync cleanup failed: ${error.message}`))
    } finally {
      clearTimeout(lockWatchdog)
      releaseSyncLock(syncRunId)
    }
  })

  return results
}
