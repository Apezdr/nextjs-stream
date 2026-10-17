/**
 * Skipping sync ticks that would change nothing.
 *
 * Most ticks find the file servers exactly as the last pass left them, yet a
 * full pass downloads and parses every payload and rebuilds fieldAvailability
 * before the per-title gates (core/syncGate) skip every title. A tick is
 * skipped instead — two conditional GETs per server, no parse, no pass, no
 * post-sync cleanup — when all of these hold:
 *
 *   1. forceSync is off;
 *   2. a complete pass is on record (`app_config.syncInfo`, see sync/appliedPayloads)
 *      under the current SYNC_GATE_VERSION, the current server set and
 *      priorities (ownership follows priority; a deploy that changes the write
 *      rules raises the version), and THIS process: the first tick after a
 *      restart or deploy is a full pass, so a changed environment or new code
 *      (and the indexes a pass creates) is applied whether or not anyone
 *      raised the version;
 *   3. every document that pass covered is still there: a document deleted
 *      since has to be put back by a pass — and nothing is left for that
 *      pass's post-sync cleanup, which runs after it is recorded and is
 *      retried by the next full pass if it failed. The admin deletes also
 *      forget the record (below). The document count catches only a delete
 *      made AFTER the record was written, by any path; a delete made DURING a
 *      pass is counted out by that pass, so it is caught only by the forget
 *      — a delete whose forget failed, or a path that does not forget, goes
 *      unnoticed until a pass runs for another reason;
 *   4. no document that pass covered lacks an enabled server's gate: an admin
 *      edit, a removal held back, a failed title or a pass that changed a
 *      document all leave a gate open, and only a pass closes it;
 *   5. every enabled server answers 304 for both payloads.
 *
 * "Covered by that pass" is the pass's syncRunId: pre-tag and every write
 * stamp it on each document a server has. Manual entries no server has are
 * not stamped, never carry a gate, and so do not hold every tick open.
 *
 * A pass replaces the record with its running marker when it starts, and
 * turns that marker into a complete record only when the pass completed for
 * every server — so a failed or partial pass is retried with a full fetch.
 * A Flat* delete outside the sync removes the record (forgetAppliedPayloads):
 * after a pass, so the next tick runs one; during a pass, so that pass, whose
 * counts may be taken after the delete, cannot record itself.
 */

import { randomUUID } from 'crypto'
import clientPromise from '@src/lib/mongodb'
import { getAllServers } from '@src/utils/config'
import { fetchAllServerData } from '@src/utils/fetchAllServerData'
import { migratePlaybackStatusIfNeeded } from '@src/utils/watchHistory/migrate'
import { validateWatchHistoryAgainstDatabase } from './watchHistoryValidation'
import { cleanupOrphanFilter } from './orphanFilter'
import { getSyncLockHolder } from './runState'
import { SYNC_GATE_VERSION } from '@src/utils/sync/core/syncGate'
import { syncEventBus } from '@src/utils/sync/core/events'
import { MediaType, SyncOperation } from '@src/utils/sync/core/types'
import { updateLastSynced } from './lastSynced'
import { getAppliedPayloads, markPassRunning, setAppliedPayloads } from './appliedPayloads'

/** The payloads each server publishes. */
const PAYLOAD_KINDS = ['tv', 'movies']

/**
 * This process's id, new on every start. Kept on globalThis so every bundle
 * that loads this module in the one process agrees on it.
 * @returns {string}
 */
export function currentBootId() {
  if (!globalThis.__syncTickBootId) globalThis.__syncTickBootId = randomUUID()
  return globalThis.__syncTickBootId
}

/**
 * Collections whose documents carry `syncGates`. Seasons do not: a season is
 * gated through its show (an edit to one reopens the show's gate).
 */
export const GATED_TICK_COLLECTIONS = ['FlatMovies', 'FlatTVShows', 'FlatEpisodes']

/** Collections whose documents a pass stamps with its syncRunId. */
export const STAMPED_COLLECTIONS = ['FlatMovies', 'FlatTVShows', 'FlatSeasons', 'FlatEpisodes']

/**
 * The server settings ownership depends on: which servers are enabled (the
 * ids fieldAvailability records) and their priorities (equal priorities
 * break on the id). Nothing else in a server's config decides who owns a
 * field.
 *
 * @param {Array<{id: string, priority: number}>} servers
 * @returns {string}
 */
export function serversFingerprint(servers) {
  return [...(servers || [])]
    .map((server) => `${server.id}:${server.priority}`)
    .sort()
    .join(',')
}

/**
 * How many documents in each stamped collection carry `syncRunId`.
 * @param {import('mongodb').Db} db
 * @param {string} syncRunId
 * @returns {Promise<Object<string, number>>}
 */
export async function countDocumentsOfRun(db, syncRunId) {
  const counts = await Promise.all(
    STAMPED_COLLECTIONS.map((name) => db.collection(name).countDocuments({ syncRunId }))
  )
  return Object.fromEntries(STAMPED_COLLECTIONS.map((name, i) => [name, counts[i]]))
}

/**
 * How many documents in each stamped collection post-sync cleanup would
 * delete after a pass with this syncRunId — its own filter, with "before the
 * run started" read as "before now". Any left means that pass's cleanup did
 * not finish (it failed, or refused), and a full pass, whose cleanup retries
 * it, must run.
 *
 * @param {import('mongodb').Db} db
 * @param {string} syncRunId
 * @returns {Promise<Object<string, number>>} Only non-zero entries
 */
export async function countLeftForCleanup(db, syncRunId) {
  const filter = cleanupOrphanFilter(syncRunId, new Date())
  const counts = await Promise.all(STAMPED_COLLECTIONS.map((name) => db.collection(name).countDocuments(filter)))
  return Object.fromEntries(
    STAMPED_COLLECTIONS.map((name, i) => [name, counts[i]]).filter(([, count]) => count > 0)
  )
}

/**
 * Per server, how many documents the run covered lack that server's gate
 * (absent, null or empty), in each collection that carries gates. Only
 * non-zero entries are returned.
 *
 * @param {import('mongodb').Db} db
 * @param {string} syncRunId
 * @param {string[]} serverIds
 * @returns {Promise<Object<string, Object<string, number>>>}
 */
export async function countOpenGates(db, syncRunId, serverIds) {
  const open = {}
  for (const serverId of serverIds) {
    const counts = await Promise.all(
      GATED_TICK_COLLECTIONS.map((name) =>
        db.collection(name).countDocuments({ syncRunId, [`syncGates.${serverId}`]: { $in: [null, ''] } })
      )
    )
    GATED_TICK_COLLECTIONS.forEach((name, i) => {
      if (counts[i] > 0) {
        open[serverId] = open[serverId] || {}
        open[serverId][name] = counts[i]
      }
    })
  }
  return open
}

/**
 * Why this tick may not be skipped whatever the servers answer, or null when
 * only the servers' answers remain to be seen.
 *
 * @param {Object} args
 * @param {import('mongodb').Db} args.db - The media database
 * @param {Object|null} args.record - The stored record of the last complete pass
 * @param {Array<{id: string, priority: number}>} args.servers - Enabled servers
 * @param {boolean} args.forceSync
 * @returns {Promise<string|null>}
 */
export async function whyTickNotSkippable({ db, record, servers, forceSync }) {
  if (forceSync) return 'force sync requested'
  if (!record?.syncRunId) return 'no complete pass on record'
  if (record.state !== 'complete') return 'the last pass is still running or did not complete'
  if (record.bootId !== currentBootId()) return 'first tick since the app started'
  if (record.gateVersion !== SYNC_GATE_VERSION) {
    return `gate version changed (${record.gateVersion} -> ${SYNC_GATE_VERSION})`
  }
  if (record.serversFingerprint !== serversFingerprint(servers)) {
    return `servers or priorities changed (${record.serversFingerprint} -> ${serversFingerprint(servers)})`
  }
  for (const server of servers) {
    const etags = record.servers?.[server.id]
    if (!PAYLOAD_KINDS.every((kind) => typeof etags?.[kind] === 'string' && etags[kind])) {
      return `no ETags on record for ${server.id}`
    }
  }

  const counts = await countDocumentsOfRun(db, record.syncRunId)
  const changed = STAMPED_COLLECTIONS.filter((name) => counts[name] !== record.documentCounts?.[name])
  if (changed.length > 0) {
    return 'documents of the last complete pass deleted (' +
      changed.map((name) => `${name} ${record.documentCounts?.[name]} -> ${counts[name]}`).join(', ') + ')'
  }

  const leftovers = await countLeftForCleanup(db, record.syncRunId)
  if (Object.keys(leftovers).length > 0) {
    return 'documents left for post-sync cleanup (' +
      Object.entries(leftovers).map(([name, n]) => `${name}=${n}`).join(' ') + ')'
  }

  const open = await countOpenGates(db, record.syncRunId, servers.map((server) => server.id))
  if (Object.keys(open).length > 0) {
    return 'open gates (' +
      Object.entries(open)
        .map(([serverId, byCollection]) =>
          `${serverId}: ` + Object.entries(byCollection).map(([name, n]) => `${name}=${n}`).join(' '))
        .join('; ') + ')'
  }
  return null
}

/** `default tv=304 movies=304, server2 tv=200 movies=304` */
function formatStatuses(servers, statuses) {
  return servers
    .map((server) => {
      const s = statuses?.[server.id]
      return s ? `${server.id} ${PAYLOAD_KINDS.map((kind) => `${kind}=${s[kind]}`).join(' ')}` : `${server.id} failed`
    })
    .join(', ')
}

/**
 * Fetch the file servers' payloads for a sync tick, conditionally when the
 * tick could be skipped, and skip it when nothing changed (see the module
 * comment).
 *
 * A skip takes no lock and writes no Flat* document: it never reaches
 * syncAllServers, so it neither holds the orchestration lock nor schedules
 * post-sync cleanup. What it still does, and why:
 *   - updates `syncInfo.lastSyncTime`, which the admin UI shows as the last
 *     sync: the tick did confirm the database matches every server;
 *   - runs migratePlaybackStatusIfNeeded: once per process, it creates the
 *     WatchHistory indexes playback writes rely on, and a process whose
 *     ticks all skip would otherwise never create them;
 *   - runs validateWatchHistoryAgainstDatabase: WatchHistory changes without
 *     the payloads changing (the player marks a record invalid when a HEAD
 *     request fails, a network blip included), and this is what marks it
 *     valid again;
 *   - emits the sync's start and complete events, so an admin's sync popup
 *     closes.
 *
 * @param {Object} [options]
 * @param {boolean} [options.forceSync=false]
 * @param {boolean} [options.allowSkip=true] - false for a sync an admin
 *   started from the UI: it always runs the full pass (the per-title gates
 *   still apply), so the admin gets the pass's report
 * @returns {Promise<
 *   { skipped: true, result: Object } |
 *   { skipped: false, fileServers: Object, errors: Array|undefined, etags: Object, statuses: Object, reason: string }
 * >} `errors` is undefined when every server answered, as getFileServerData has it.
 */
export async function fetchSyncTick({ forceSync = false, allowSkip = true } = {}) {
  const startedAt = Date.now()
  const servers = getAllServers()
  const client = await clientPromise
  const db = client.db('Media')

  let record = null
  let blocker = allowSkip ? null : 'started from the admin UI (only webhook ticks skip)'
  if (!blocker) {
    try {
      record = await getAppliedPayloads(client)
      blocker = await whyTickNotSkippable({ db, record, servers, forceSync: Boolean(forceSync) })
    } catch (error) {
      blocker = `skip check failed: ${error.message}`
    }
  }

  const fetched = await fetchAllServerData(blocker ? {} : { validators: record.servers })
  const statusLine = formatStatuses(servers, fetched.statuses)

  if (!fetched.notModified) {
    const reason = blocker || 'a payload changed or a server did not answer'
    console.info(`[SYNC] Full pass: ${reason} [${statusLine}]`)
    return {
      skipped: false,
      fileServers: fetched.fileServers,
      errors: fetched.errors.length > 0 ? fetched.errors : undefined,
      etags: fetched.etags,
      statuses: fetched.statuses,
      reason,
    }
  }

  const decisionMs = Date.now() - startedAt
  console.info(
    `[SYNC] Tick skipped: every payload unchanged and every gate stamped [${statusLine}] (${decisionMs}ms)`
  )

  try {
    syncEventBus.emitStarted('__sync_warmup__', MediaType.Movie, 'server-all')
  } catch (error) {
    console.error(`emitStarted(warmup) failed: ${error.message}`)
  }

  await updateLastSynced(client)
  try {
    await migratePlaybackStatusIfNeeded()
  } catch (error) {
    console.warn(`WatchHistory migration check failed on a skipped tick: ${error.message}`)
  }
  let watchHistoryValidation = null
  try {
    watchHistoryValidation = await validateWatchHistoryAgainstDatabase()
  } catch (error) {
    watchHistoryValidation = { error: error.message }
  }

  const result = {
    syncRunId: null,
    skipped: true,
    reason: 'payloads_unchanged',
    servers: fetched.statuses,
    lastCompleteSyncRunId: record.syncRunId,
    errors: [],
    missingMedia: {},
    missingMp4: {},
    changedMedia: { movies: [], shows: [], seasons: [], episodes: [] },
    watchHistoryValidation,
    duration: (Date.now() - startedAt) / 1000,
  }

  try {
    syncEventBus.emitComplete('__sync_complete__', MediaType.Movie, 'server-all', SyncOperation.Metadata, {
      summary: result,
    })
  } catch (error) {
    console.error(`emitComplete failed: ${error.message}`)
  }

  return { skipped: true, result }
}

/**
 * Replace the record with this pass's running marker. Called when a pass
 * starts: until it completes, no tick may be skipped, and only this pass may
 * record itself (recordCompletePass). Writes nothing for a run that no longer
 * holds the sync lock (holdsSyncLock). Never throws — if the marker cannot be
 * written, the pass cannot record itself either, and an earlier complete
 * record left in place no longer matches the database: pre-tag restamps every
 * covered document with this pass's id, so that record's document counts are
 * wrong and the next tick does not skip.
 *
 * @param {Object} client - MongoDB client
 * @param {string} syncRunId
 */
export async function startPassRecord(client, syncRunId) {
  if (!holdsSyncLock(syncRunId)) {
    console.error(`[SYNC] Not marking run ${syncRunId} as running: it no longer holds the sync lock`)
    return
  }
  try {
    await markPassRunning(client, syncRunId)
  } catch (error) {
    console.error(`[SYNC] Could not mark the pass as running: ${error.message}`)
  }
}

/**
 * Whether `syncRunId` still holds the orchestration lock — the ownership
 * re-check runPostSyncCleanup makes before deleting. A pass the watchdog has
 * released (it hung, and a stale takeover may have started a newer pass)
 * must not write the record: its marker would replace the newer pass's, and
 * its record would describe a database the newer pass is writing. A write
 * already in flight when the lock is lost can still land; that only costs
 * the newer pass its record (its compare-and-set then fails), never records
 * a pass that did not complete.
 *
 * @param {string} syncRunId
 * @returns {boolean}
 */
function holdsSyncLock(syncRunId) {
  return Boolean(syncRunId) && getSyncLockHolder()?.syncRunId === syncRunId
}

/** Failures a server's pass reported, whichever result shape it has. */
function countPassFailures(syncResult) {
  const n = (value) => (Array.isArray(value) ? value.length : typeof value === 'number' ? value : 0)
  return n(syncResult?.errors) +
    ['movies', 'tvShows', 'seasons', 'episodes'].reduce((total, key) => total + n(syncResult?.[key]?.errors), 0)
}

/**
 * Why a pass may not be recorded as complete, or an empty list when it may.
 * Complete means: every enabled server answered, pre-tag stamped every
 * collection, and every server's pass ran to the end with nothing failed.
 * Messages a pass reports for titles it skipped count too: in a steady state
 * every title is skipped on its gate and none is reported, so a pass that
 * reports one is followed by another full pass, which settles it.
 *
 * @param {Object} args
 * @param {Object} args.results - syncAllServers' results
 * @param {Object|null} args.preTagResult
 * @param {Object} args.fileServers
 * @param {boolean} args.allEnabledServersProbed
 * @returns {string[]}
 */
export function incompletePassReasons({ results, preTagResult, fileServers, allEnabledServersProbed }) {
  const reasons = []
  if (allEnabledServersProbed !== true) reasons.push('not every enabled server answered')
  if (!preTagResult || preTagResult.skipped || preTagResult.ok !== true) {
    reasons.push('pre-tag did not cover every collection')
  }
  if (results?.errors?.length > 0) reasons.push(`${results.errors.length} orchestration error(s)`)
  for (const serverId of Object.keys(fileServers || {})) {
    const syncResult = results?.flatSyncResults?.[serverId]
    if (!syncResult) {
      reasons.push(`${serverId}: no pass result`)
      continue
    }
    const failures = countPassFailures(syncResult)
    if (failures > 0) reasons.push(`${serverId}: ${failures} failure(s) or error(s)`)
  }
  return reasons
}

/**
 * Record the pass that just ran as the last complete pass, if it was one, so
 * the next tick may send its payloads' ETags and skip. Never throws: a pass
 * that is not recorded just means the next tick fetches in full.
 *
 * @param {Object} args
 * @param {Object} args.client - MongoDB client
 * @param {string} args.syncRunId
 * @param {Object} args.results - syncAllServers' results
 * @param {Object|null} args.preTagResult
 * @param {Object} args.fileServers
 * @param {boolean} args.allEnabledServersProbed
 * @param {Object<string, {tv: string|null, movies: string|null}>|undefined} args.payloadETags -
 *   The ETags of the payloads this pass applied (from fetchSyncTick)
 * @returns {Promise<boolean>} Whether the pass was recorded
 */
export async function recordCompletePass({
  client,
  syncRunId,
  results,
  preTagResult,
  fileServers,
  allEnabledServersProbed,
  payloadETags,
}) {
  try {
    if (!payloadETags) return false
    const servers = getAllServers()
    const reasons = incompletePassReasons({ results, preTagResult, fileServers, allEnabledServersProbed })
    for (const server of servers) {
      const etags = payloadETags[server.id]
      const missing = PAYLOAD_KINDS.filter((kind) => !etags?.[kind])
      if (missing.length > 0) reasons.push(`${server.id} sent no ETag for ${missing.join(' and ')}`)
    }
    if (reasons.length > 0) {
      console.info(`[SYNC] Pass not recorded as complete, next tick fetches in full: ${reasons.join('; ')}`)
      return false
    }

    const documentCounts = await countDocumentsOfRun(client.db('Media'), syncRunId)
    if (!holdsSyncLock(syncRunId)) {
      console.error(`[SYNC] Not recording run ${syncRunId} as complete: it no longer holds the sync lock`)
      return false
    }
    const recorded = await setAppliedPayloads(client, syncRunId, {
      servers: Object.fromEntries(
        servers.map((server) => [
          server.id,
          Object.fromEntries(PAYLOAD_KINDS.map((kind) => [kind, payloadETags[server.id][kind]])),
        ])
      ),
      gateVersion: SYNC_GATE_VERSION,
      serversFingerprint: serversFingerprint(servers),
      bootId: currentBootId(),
      documentCounts,
    })
    if (!recorded) {
      console.info(
        '[SYNC] Pass not recorded as complete, next tick fetches in full: ' +
        'its running marker is gone or replaced (a Flat* document was deleted outside the sync during the pass)'
      )
    }
    return recorded
  } catch (error) {
    console.error(`[SYNC] Could not record the complete pass: ${error.message}`)
    return false
  }
}
