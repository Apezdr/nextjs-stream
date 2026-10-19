import { ObjectId } from 'mongodb'
import clientPromise from '@src/lib/mongodb'
import chalk from 'chalk'
import { updateLastSynced } from './lastSynced'
import { runServerPass } from './serverPass'
import { runPostSyncCleanup, runAfterSyncJobs } from './postSync'
import { createWrittenMedia } from './writtenMedia'
import {
  setCurrentSyncRunId,
  clearCurrentSyncRunId,
  tryAcquireSyncLock,
  releaseSyncLock,
  getSyncLockHolder,
} from './runState'
import { preTagSyncRunId } from './preTag'
import { computeMissingMedia } from './missingMedia'
import { createTitleCounts, noVideoTitles } from './syncReport'
import { cantPlayTitles } from './cantPlay'
import { buildTickInputs, settleApplied, tickPerfLine } from './manifestTick'
import { getTickState, beginRun, resetTickState } from './tickState'
import { SYNC_GATE_VERSION } from '@src/utils/sync/core/syncGate'
import { getAllServers } from '@src/utils/config'
import { syncEventBus } from '@src/utils/sync/core/events'
import { MediaType, SyncOperation } from '@src/utils/sync/core'
import {
  startPassRecord,
  recordCompletePass,
  incompletePassReasons,
  confirmTickMode,
  currentBootId,
  serversFingerprint,
} from './tickSkip'

// The sync route probes each tick's manifests through this, and skips the tick
// when nothing changed (see run/tickSkip.js).
export { fetchSyncTick } from './tickSkip'

// Hard ceiling on how long the orchestration single-flight lock may be held. A
// hung post-sync cleanup must never freeze every future sync — if the lock is
// not released within this window the watchdog force-releases it (the per-
// collection coverage gate keeps cleanup correct even if a later run overlaps).
const SYNC_LOCK_WATCHDOG_MS = (() => {
  const p = Number(process.env.SYNC_LOCK_WATCHDOG_MS)
  return Number.isFinite(p) && p > 0 ? p : 10 * 60 * 1000
})()

/**
 * Performs a multi-server sync operation.
 * @param {Object} tick - fetchSyncTick's answer for a tick that is not skipped:
 *   its mode (`all` or `select`), every enabled server's manifest probe and
 *   the servers that did not answer. Under the lock, after the running
 *   marker, the run selects the titles, fetches their entries and builds the
 *   pass's inputs (run/manifestTick buildTickInputs).
 * @param {Object} [options]
 * @param {boolean} [options.forceSync]
 * @returns {Promise<Object>} Sync results
 */
export async function syncAllServers(tick, options = {}) {
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
      added: { movies: 0, shows: 0, episodes: 0 },
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
      // The released run may keep writing, outside `applied`: the next tick
      // passes over every title (run/tickState)
      resetTickState()
    }
  }, SYNC_LOCK_WATCHDOG_MS)
  if (typeof lockWatchdog.unref === 'function') lockWatchdog.unref()

  // What the passes wrote, recorded by each pass title by title as the titles
  // finish (run/writtenMedia): a pass that throws part way has still handed
  // over what it wrote before it threw.
  const written = createWrittenMedia()

  const results = {
    syncRunId,
    // Per server: what it lists that is not in the library after its pass
    // (run/missingMedia), and the titles it lists with no video file yet
    // (run/syncReport noVideoTitles)
    missingMedia: {},
    noVideo: {},
    // Per server (the server each video came from): what the library hides
    // although it has a video. Filled on a tick over every title (run/cantPlay)
    cantPlay: {},
    // Per server: titles checked, updated, unchanged and failed (run/syncReport createTitleCounts)
    titleCounts: {},
    errors: [],
    // Union (across servers) of entities re-synced this run, keyed by folder
    // name (originalTitle), as the media pages tag their caches. Drives the
    // post-sync cache-invalidation POST in the route handler.
    // The run's record itself, so it holds every title as soon as it finishes.
    // Duplicates across servers are fine — the revalidate route builds a tag
    // Set, which dedupes.
    changedMedia: written.changedMedia,
    // Documents the passes created (not updated), across servers: the admins'
    // "sync complete" notice reports them. A document one server's pass
    // creates is an update to every later server's pass, so none is counted
    // twice. Set when the passes are done.
    added: { movies: 0, shows: 0, episodes: 0 },
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

  // Why this run was not complete (every enabled server answered, pre-tag
  // covered every collection, every pass ran with nothing failed), or empty:
  // only a complete run may start the new-content notices' announced-titles
  // set (run/newContent). Set when the passes are done.
  let incompleteReasons = ['the passes did not finish']

  // Captured from pre-tag and handed to post-sync cleanup as a coverage
  // contract: cleanup deletes a collection ONLY if pre-tag proved it fully
  // stamped that collection this run (fail-closed). Declared out here so it is
  // in scope at the background cleanup call below.
  let preTagResult = null

  // The pass's inputs (run/manifestTick buildTickInputs), built inside the try
  // below, after the running marker. Until then, and if building them fails,
  // they say no server answered: no pass runs and cleanup deletes nothing.
  // `listings` is what each answering server has, by key (run/listing):
  // pre-tag, the missing-media report and cleanup's no-server-data guard read
  // these, never the payloads.
  let fileServers = {}
  let allEnabledServersProbed = false
  let fieldAvailability = { movies: {}, tv: {} }
  let listings = new Map()
  // The rest of what the inputs carry (the selection, the manifests used, the
  // entry hashes), the tick state the run updates, and per kind, title and
  // server, whether the server's pass finished the title cleanly
  let inputs = null
  let tickState = null
  const finished = { tv: new Map(), movies: new Map() }

  // Whether the tick may still pass over only some titles: decided before the
  // marker, which changes the record the tick state is checked against
  const mode = await confirmTickMode(client, tick)

 try {
  // No tick may be skipped on the strength of an earlier pass while this one
  // writes: the record of the last complete pass is replaced now by this
  // pass's running marker, which becomes a complete record only if this pass
  // completes (recordCompletePass below; see run/tickSkip.js).
  await startPassRecord(client, syncRunId)

  try {
    inputs = await buildTickInputs({
      tick,
      mode,
      state: getTickState(),
      db: client.db('Media'),
      watchdogMs: SYNC_LOCK_WATCHDOG_MS,
    })
    ;({ fileServers, allEnabledServersProbed, fieldAvailability, listings } = inputs)
    console.info(tickPerfLine({ kind: mode, selected: inputs.selected, manifests: inputs.manifests, perf: inputs.perf }))
    // Before the first Flat* write (pre-tag): every selected title loses its
    // `applied` entry, and the state now tracks this run (run/tickState)
    tickState = beginRun({
      syncRunId,
      mode,
      bootId: currentBootId(),
      gateVersion: SYNC_GATE_VERSION,
      serversFingerprint: serversFingerprint(getAllServers()),
      manifests: inputs.manifests,
      selected: {
        tv: [...inputs.selected.tv.keys(), ...inputs.dropped.tv],
        movies: [...inputs.selected.movies.keys(), ...inputs.dropped.movies],
      },
    })
  } catch (inputError) {
    console.error(chalk.red(`❌ Could not build the pass's inputs: ${inputError.message}`))
    results.errors.push({ error: inputError.message, phase: 'pass_inputs', stack: inputError.stack })
  }

  // Pre-tag every record currently present on a file server with the current
  // syncRunId. The per-write marker injection in the sync helpers only fires
  // for records that change; this catches the steady-state case where most
  // records are unchanged. By the time post-sync cleanup runs, anything
  // without the current marker is provably orphan.
  try {
    preTagResult = await preTagSyncRunId(listings, syncRunId)
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
      results.noVideo[serverId] = { movies: [], tv: [] }
      const titleCounts = createTitleCounts()

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
        const syncResult = await runServerPass(fileServer, serverConfig, fieldAvailability, {
          forceSync: Boolean(options.forceSync),
          // Authoritative-pass gate for field-absence cleanup: true only when
          // every enabled file server answered this run (buildTickInputs).
          // Threaded unchanged into RunConfig (and its cleanup).
          allEnabledServersProbed,
          written,
          onTitleFinished: (kind, title, clean, titleResults) => {
            if (!finished[kind].has(title)) finished[kind].set(title, new Map())
            finished[kind].get(title).set(serverId, clean)
            titleCounts.record(kind, title, titleResults)
          },
        })
        results.titleCounts[serverId] = titleCounts.counts()
        // What the server lists that is still not in the library, read after
        // its pass, so a title the pass added is not reported: two
        // projection-only finds and a Set diff (computeMissingMedia).
        const missingMedia = await computeMissingMedia(listings.get(serverId), fieldAvailability)

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

        // The titles it lists with no video file yet, and why
        results.noVideo[serverId] = noVideoTitles(fileServer)

        // Store the sync results for reference. (What the pass changed and
        // created is already in the run's record, `written`.)
        results.flatSyncResults = results.flatSyncResults || {}
        results.flatSyncResults[serverId] = syncResult

        // Signal that this server finished successfully
        syncEventBus.emitComplete('__server_complete__', MediaType.Movie, serverId)
      } catch (error) {
        // The titles the pass finished before it threw
        results.titleCounts[serverId] = titleCounts.counts()
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

  // `applied` again for the selected titles every server finished cleanly
  if (tickState && inputs) {
    try {
      settleApplied(tickState, inputs, finished, syncRunId)
    } catch (error) {
      results.errors.push({ error: error.message, phase: 'tick_state', stack: error.stack })
    }
  }

  try {
    await updateLastSynced(client)
  } catch (error) {
    results.errors.push({ error: error.message, phase: 'update_last_synced', stack: error.stack })
  }

  incompleteReasons = incompletePassReasons({
    results,
    preTagResult,
    fileServers,
    allEnabledServersProbed,
  })

  // If every server's pass completed, record the payloads it applied: the
  // next tick sends their ETags and is skipped when none changed.
  await recordCompletePass({
    client,
    syncRunId,
    results,
    preTagResult,
    fileServers,
    allEnabledServersProbed,
    manifestETags: inputs
      ? Object.fromEntries([...inputs.manifests].map(([serverId, kinds]) => [serverId, { tv: kinds.tv.etag, movies: kinds.movies.etag }]))
      : undefined,
  })

  // On a tick over every title (every manual sync): what the library hides
  // although it has a video, read after every pass. Informational: a failure
  // is reported with the run's errors, after the record is written.
  if (mode === 'all') {
    try {
      results.cantPlay = await cantPlayTitles(client.db('Media'))
    } catch (error) {
      results.errors.push({
        error: `Could not list the titles that can't play yet: ${error.message}`,
        phase: 'cant_play_report',
      })
    }
  }
 } finally {
  results.added = written.addedCounts()
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
  // the popup closes. Post-sync cleanup and the run's own jobs below run as a
  // background task and do not block the user-facing sync completion.
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
  // Then the run's own jobs, once per run (run/postSync runAfterSyncJobs): the
  // WatchHistory migration, the watch-history validation (after cleanup's
  // deletes, and after the pass, which can take a title's video away) and the
  // new-content notices (after cleanup has decided what is deleted, so a title
  // deleted this run is never announced). They run whether or not cleanup
  // completed: a pass that wrote anything has to be followed by them.
  // The orchestration lock is held until all of it settles (so the next run cannot
  // race this run's find→delete), then released in the finally (the watchdog
  // armed at acquire is the liveness backstop; ownership is re-checked inside
  // runPostSyncCleanup before any delete, so a force-released stale run cannot
  // reap a newer run's records).
  Promise.resolve().then(async () => {
    try {
      try {
        console.log(chalk.bold.yellow('Performing post-sync cleanup (background)...'))
        const finalAvailabilityResults = await runPostSyncCleanup(
          listings,
          {
            syncRunId,
            preTagCoverage: preTagResult,
            runStartedAt: startTime,
            // Whether every enabled server answered. Cleanup deletes nothing on a
            // run where one did not (see the every-server gate there).
            allEnabledServersProbed,
          }
        )
        results.finalAvailabilityResults = finalAvailabilityResults
        console.log(chalk.bold.yellow('Post-sync cleanup complete'))
      } catch (error) {
        console.error(chalk.red(`❌ Post-sync cleanup failed: ${error.message}`))
      }
      results.afterSync = await runAfterSyncJobs({ syncRunId, incompleteReasons })
    } catch (error) {
      console.error(chalk.red(`❌ The run's after-sync jobs failed: ${error.message}`))
    } finally {
      clearTimeout(lockWatchdog)
      // A run that lost its lock to the watchdog wrote until now: whatever the
      // runs since then recorded, the next tick passes over every title
      if (getSyncLockHolder()?.syncRunId !== syncRunId) resetTickState()
      releaseSyncLock(syncRunId)
    }
  })

  return results
}
