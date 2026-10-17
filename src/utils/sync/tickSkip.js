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
 *   2. a complete pass is on record (`app_config.syncInfo`, see sync/database)
 *      under the current SYNC_GATE_VERSION and the current server set and
 *      priorities (ownership follows priority; a deploy that changes the write
 *      rules raises the version);
 *   3. every document that pass covered is still there: a document deleted
 *      since (an admin delete) has to be put back by a pass — and nothing is
 *      left for that pass's post-sync cleanup, which runs after it is
 *      recorded and is retried by the next full pass if it failed;
 *   4. no document that pass covered lacks an enabled server's gate: an admin
 *      edit, a removal held back, a failed title or a pass that changed a
 *      document all leave a gate open, and only a pass closes it;
 *   5. every enabled server answers 304 for both payloads.
 *
 * "Covered by that pass" is the pass's syncRunId: pre-tag and every write
 * stamp it on each document a server has. Manual entries no server has are
 * not stamped, never carry a gate, and so do not hold every tick open.
 *
 * The record is cleared when a pass starts and written only when the pass
 * completed for every server, so a failed or partial pass is retried with a
 * full fetch.
 */

import clientPromise from '@src/lib/mongodb'
import { getAllServers } from '@src/utils/config'
import { fetchAllServerData } from '@src/utils/fetchAllServerData'
import { migratePlaybackStatusIfNeeded } from '@src/utils/watchHistory/migrate'
import { validateWatchHistoryAgainstDatabase } from '@src/utils/flatSync/watchHistoryValidation'
import { SYNC_GATE_VERSION } from './core/syncGate'
import { syncEventBus } from './core/events'
import { MediaType, SyncOperation } from './core/types'
import {
  getAppliedPayloads,
  setAppliedPayloads,
  clearAppliedPayloads,
  updateLastSynced,
} from './database'

/** The payloads each server publishes. */
const PAYLOAD_KINDS = ['tv', 'movies']

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
 * delete after a pass with this syncRunId — its own filter (postSyncCleanup):
 * not stamped by the run, not a manual entry, last written before now. Any
 * left means that pass's cleanup did not finish (it failed, or refused), and
 * a full pass, whose cleanup retries it, must run.
 *
 * @param {import('mongodb').Db} db
 * @param {string} syncRunId
 * @returns {Promise<Object<string, number>>} Only non-zero entries
 */
export async function countLeftForCleanup(db, syncRunId) {
  const filter = { syncRunId: { $ne: syncRunId }, manualEntry: { $ne: true }, updatedAt: { $lt: new Date() } }
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
 * @returns {Promise<
 *   { skipped: true, result: Object } |
 *   { skipped: false, fileServers: Object, errors: Array|undefined, etags: Object, statuses: Object, reason: string }
 * >} `errors` is undefined when every server answered, as getFileServerData has it.
 */
export async function fetchSyncTick({ forceSync = false } = {}) {
  const startedAt = Date.now()
  const servers = getAllServers()
  const client = await clientPromise
  const db = client.db('Media')

  let record = null
  let blocker = null
  try {
    record = await getAppliedPayloads(client)
    blocker = await whyTickNotSkippable({ db, record, servers, forceSync: Boolean(forceSync) })
  } catch (error) {
    blocker = `skip check failed: ${error.message}`
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
 * Forget the last complete pass. Called when a pass starts: until it
 * completes, no tick may be skipped. Never throws — if the record cannot be
 * removed, the pass's own stamps (pre-tag restamps every covered document)
 * leave its document counts wrong, which keeps the next tick from skipping.
 *
 * @param {Object} client - MongoDB client
 */
export async function forgetAppliedPayloads(client) {
  try {
    await clearAppliedPayloads(client)
  } catch (error) {
    console.error(`[SYNC] Could not clear the record of the last complete pass: ${error.message}`)
  }
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
    await setAppliedPayloads(client, {
      servers: Object.fromEntries(
        servers.map((server) => [
          server.id,
          Object.fromEntries(PAYLOAD_KINDS.map((kind) => [kind, payloadETags[server.id][kind]])),
        ])
      ),
      gateVersion: SYNC_GATE_VERSION,
      serversFingerprint: serversFingerprint(servers),
      syncRunId,
      documentCounts,
    })
    return true
  } catch (error) {
    console.error(`[SYNC] Could not record the complete pass: ${error.message}`)
    return false
  }
}
