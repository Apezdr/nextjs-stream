/**
 * Skipping sync ticks that would change nothing.
 *
 * Most ticks find the file servers exactly as the last pass left them. A tick
 * is skipped — two conditional manifest GETs per server (run/manifestTick), no
 * entries, no pass, no post-sync cleanup — when all of these hold:
 *
 *   1. forceSync is off, and the tick was not started from the admin UI;
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
 *   4. no document that pass covered lacks the gate of an enabled server that
 *      lists it (in the manifests the tick state holds): an admin edit, a
 *      removal held back, a failed title or a pass that changed a document
 *      all leave a gate open, and only a pass closes it. A server's pass never
 *      visits what it does not list, so that server's gate there is not open;
 *      without every server's manifests the tick does not skip;
 *   5. this process's tick state (run/tickState) tracks that pass, and selects
 *      no title on its own (rules R1, R2 and R7 of run/selectTitles);
 *   6. every enabled server answers 304 for both manifests, to the ETags that
 *      pass recorded.
 *
 * Any other tick runs: in `select` mode it passes over only the titles
 * run/selectTitles picks, in `all` mode (no usable tick state, forceSync, a
 * sync started from the admin UI) over every title.
 *
 * "Covered by that pass" is the pass's syncRunId: pre-tag and every write
 * stamp it on each document a server has. Manual entries no server has are
 * not stamped, never carry a gate, and so do not hold every tick open.
 *
 * A pass replaces the record with its running marker when it starts, and
 * turns that marker into a complete record only when the pass completed for
 * every server — so a failed or partial pass is followed by another pass.
 * A Flat* delete outside the sync removes the record (forgetAppliedPayloads):
 * after a pass, so the next tick runs one; during a pass, so that pass, whose
 * counts may be taken after the delete, cannot record itself.
 */

import { randomUUID } from 'crypto'
import clientPromise from '@src/lib/mongodb'
import { getAllServers } from '@src/utils/config'
import { migratePlaybackStatusIfNeeded } from '@src/utils/watchHistory/migrate'
import { validateWatchHistoryIfDue } from './validateWatchHistory'
import { cleanupOrphanFilter } from './orphanFilter'
import { getSyncLockHolder } from './runState'
import { SYNC_GATE_VERSION } from '@src/utils/sync/core/syncGate'
import { syncEventBus } from '@src/utils/sync/core/events'
import { MediaType, SyncOperation } from '@src/utils/sync/core/types'
import { updateLastSynced } from './lastSynced'
import { getAppliedPayloads, markPassRunning, setAppliedPayloads } from './appliedPayloads'
import { getTickState, whyStateUnusable } from './tickState'
import { stateRules } from './selectTitles'
import { listingOfManifests, seasonNumberOfKey, episodeNumberOfKey } from './listing'
import { probeServers, logProbeFailures, formatProbeStatuses, tickPerfLine, probePerf } from './manifestTick'

/** The kinds each server publishes a manifest for. */
const PAYLOAD_KINDS = ['tv', 'movies']

/**
 * The shape of the record a complete pass writes: 2 = manifest ETags. A record
 * of another shape (the payload ETags before it) never lets a tick skip; the
 * next complete pass writes this one over it.
 */
export const RECORD_FORMAT = 2

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

/** Whether a document lacks the server's gate: absent, null or empty. */
const lacksGate = (doc, serverId) => {
  const gate = doc?.syncGates?.[serverId]
  return gate === undefined || gate === null || gate === ''
}

/** An episode's key in a listing, from its show's folder name and its numbers. */
const episodeKey = (show, seasonNumber, episodeNumber) => JSON.stringify([show, seasonNumber, episodeNumber])

/** Every episode a listing names, as episodeKey. */
function listedEpisodes(listing) {
  const keys = new Set()
  for (const [show, seasons] of listing.tv) {
    for (const [seasonKey, episodeKeys] of seasons) {
      const seasonNumber = seasonNumberOfKey(seasonKey)
      if (seasonNumber === null) continue
      for (const key of episodeKeys) {
        const episodeNumber = episodeNumberOfKey(key)
        if (episodeNumber !== null) keys.add(episodeKey(show, seasonNumber, episodeNumber))
      }
    }
  }
  return keys
}

/**
 * Per server, how many documents the run covered lack that server's gate
 * (absent, null or empty) while that server lists them, in each collection
 * that carries gates: a movie or a show its listing names, an episode its
 * listing names under that show, season and episode number (read as pre-tag
 * reads the keys). A server's pass never visits what it does not list, so a
 * gate it has never stamped there is not open; an episode with no showId
 * cannot be placed in any listing and counts as open. Only non-zero entries
 * are returned, servers in `listings` order.
 *
 * The queries: the run's shows once (folder name and gates), then per server
 * a count of its listed movies without its gate (originalTitle $in) and its
 * listed shows' episodes without its gate (showId $in, projected to their
 * numbers).
 *
 * @param {import('mongodb').Db} db
 * @param {string} syncRunId
 * @param {Map<string, import('./listing').ServerListing>} listings - Every enabled server's listing
 * @returns {Promise<Object<string, Object<string, number>>>}
 */
export async function countOpenGates(db, syncRunId, listings) {
  const shows = await db
    .collection('FlatTVShows')
    .find({ syncRunId }, { projection: { originalTitle: 1, syncGates: 1 } })
    .toArray()
  const titleOfShow = new Map(shows.map((show) => [String(show._id), show.originalTitle]))

  const perServer = await Promise.all(
    [...listings].map(async ([serverId, listing]) => {
      const lacking = { [`syncGates.${serverId}`]: { $in: [null, ''] } }
      const listedShows = shows.filter((show) => listing.tv.has(show.originalTitle))
      const [movies, episodes] = await Promise.all([
        listing.movies.size > 0
          ? db.collection('FlatMovies').countDocuments({ syncRunId, originalTitle: { $in: [...listing.movies] }, ...lacking })
          : 0,
        db
          .collection('FlatEpisodes')
          .find(
            { syncRunId, $or: [{ showId: { $in: listedShows.map((show) => show._id) } }, { showId: null }], ...lacking },
            { projection: { showId: 1, seasonNumber: 1, episodeNumber: 1 } }
          )
          .toArray(),
      ])
      const named = episodes.length > 0 ? listedEpisodes(listing) : new Set()
      const openEpisodes = episodes.filter(
        (episode) =>
          episode.showId == null ||
          named.has(episodeKey(titleOfShow.get(String(episode.showId)), episode.seasonNumber, episode.episodeNumber))
      )
      const counts = {
        FlatMovies: movies,
        FlatTVShows: listedShows.filter((show) => lacksGate(show, serverId)).length,
        FlatEpisodes: openEpisodes.length,
      }
      return [serverId, counts]
    })
  )

  const open = {}
  for (const [serverId, counts] of perServer) {
    for (const name of GATED_TICK_COLLECTIONS) {
      if (counts[name] > 0) {
        open[serverId] = open[serverId] || {}
        open[serverId][name] = counts[name]
      }
    }
  }
  return open
}

/**
 * Each server's listing from the manifests the tick state holds for it
 * (run/tickState), for the servers it holds both manifests of.
 *
 * @param {import('./tickState').TickState|null} state
 * @param {Array<{id: string}>} servers
 * @returns {Map<string, import('./listing').ServerListing>}
 */
export function heldListings(state, servers) {
  const listings = new Map()
  for (const server of servers) {
    const held = state?.manifests?.get(server.id)
    if (held?.tv?.titles && held?.movies?.titles) listings.set(server.id, listingOfManifests(held.tv, held.movies))
  }
  return listings
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
 * @param {Map<string, import('./listing').ServerListing>} [args.listings] - Each
 *   server's listing from the manifests the tick state holds (heldListings): the
 *   open gates are counted against them, so a tick never skips without them
 * @returns {Promise<string|null>}
 */
export async function whyTickNotSkippable({ db, record, servers, forceSync, listings }) {
  if (forceSync) return 'force sync requested'
  if (!record?.syncRunId) return 'no complete pass on record'
  if (record.state !== 'complete') return 'the last pass is still running or did not complete'
  if (record.recordFormat !== RECORD_FORMAT) return 'the last complete pass was recorded by an older sync (no manifest ETags)'
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

  const unlisted = servers.find((server) => !listings?.has(server.id))
  if (unlisted) return `no manifests held for ${unlisted.id} to read its gates against`
  const open = await countOpenGates(db, record.syncRunId, new Map(servers.map((server) => [server.id, listings.get(server.id)])))
  if (Object.keys(open).length > 0) {
    return 'open gates (' +
      Object.entries(open)
        .map(([serverId, byCollection]) =>
          `${serverId}: ` + Object.entries(byCollection).map(([name, n]) => `${name}=${n}`).join(' '))
        .join('; ') + ')'
  }
  return null
}

/** What run/tickState's usability is checked against: the record and this process. */
function tickIdentity(record, servers) {
  return {
    record,
    bootId: currentBootId(),
    gateVersion: SYNC_GATE_VERSION,
    serversFingerprint: serversFingerprint(servers),
  }
}

/**
 * The tick's mode as it stands once the run holds the lock (before it writes
 * its marker): a `select` tick becomes `all` when the tick state no longer
 * tracks the run on record (a run in between threw before it reached the
 * state, or another process ran). Never throws: a record it cannot read makes
 * the tick `all`.
 *
 * @param {Object} client - MongoDB client
 * @param {{mode: 'all'|'select'}} tick
 * @returns {Promise<'all'|'select'>}
 */
export async function confirmTickMode(client, tick) {
  if (tick?.mode !== 'select') return 'all'
  try {
    const record = await getAppliedPayloads(client)
    return whyStateUnusable(getTickState(), tickIdentity(record, getAllServers())) ? 'all' : 'select'
  } catch (error) {
    console.error(`[SYNC] Could not confirm the tick's mode, passing over every title: ${error.message}`)
    return 'all'
  }
}

/**
 * Why the held manifests, which every server just confirmed with a 304, do
 * not let the tick skip: they are not the ones the complete pass on record
 * applied, or they select a title on their own (R1, R2, R7). Null when they
 * let it skip.
 */
function whyStateDiffers(state, record, servers) {
  for (const server of servers) {
    for (const kind of PAYLOAD_KINDS) {
      const etag = state.manifests.get(server.id)?.[kind]?.etag
      if (!etag || etag !== record.servers?.[server.id]?.[kind]) {
        return `${server.id}'s ${kind} manifest is not the one the last complete pass recorded`
      }
    }
  }
  const manifests = new Map(servers.map((server) => [server.id, state.manifests.get(server.id)]))
  const pending = stateRules({ manifests, applied: state.applied, held: state.manifests })
  const count = pending.tv.size + pending.movies.size
  return count > 0 ? `${count} title(s) pending in the tick state` : null
}

/**
 * Probe the file servers' manifests for a sync tick, and skip the tick when
 * nothing changed (see the module comment).
 *
 * A skip takes no lock and writes no Flat* document. What it still does: it
 * updates `syncInfo.lastSyncTime` (the admin UI's last sync), runs
 * migratePlaybackStatusIfNeeded (once per process: the WatchHistory indexes),
 * validates watch history when due (at most every 15 minutes: WatchHistory
 * changes without the library changing), and emits the sync's start and
 * complete events, so an admin's sync popup closes.
 *
 * @param {Object} [options]
 * @param {boolean} [options.forceSync=false]
 * @param {boolean} [options.allowSkip=true] - false for a sync an admin
 *   started from the UI: it always passes over every title (the per-title
 *   gates still apply), so the admin gets the whole report
 * @returns {Promise<
 *   { skipped: true, result: Object } |
 *   { skipped: false, mode: 'all'|'select', servers: Map<string, Object>, errors: Array|undefined, reason: string }
 * >} `servers` holds each enabled server's manifest probe (run/manifestTick);
 *   `errors` is undefined when every server answered, never an empty array.
 */
export async function fetchSyncTick({ forceSync = false, allowSkip = true } = {}) {
  const startedAt = Date.now()
  const servers = getAllServers()
  const client = await clientPromise
  const db = client.db('Media')

  let record = null
  let blocker = null
  try {
    record = await getAppliedPayloads(client)
  } catch (error) {
    blocker = `skip check failed: ${error.message}`
  }
  const state = getTickState()
  const stateProblem = blocker ?? whyStateUnusable(state, tickIdentity(record, servers))
  const mode = forceSync || !allowSkip || stateProblem ? 'all' : 'select'

  if (!allowSkip) blocker = 'started from the admin UI (only webhook ticks skip)'
  else if (forceSync) blocker = 'force sync requested'
  else if (stateProblem) blocker = stateProblem
  else {
    try {
      blocker = await whyTickNotSkippable({ db, record, servers, forceSync: false, listings: heldListings(state, servers) })
    } catch (error) {
      blocker = `skip check failed: ${error.message}`
    }
  }

  const probes = await probeServers(servers, mode === 'select' ? state.manifests : null)
  logProbeFailures(probes)
  const statusLine = formatProbeStatuses(probes)
  const unchanged = [...probes.values()].every((probe) => probe.ok && probe.statuses.tv === 304 && probe.statuses.movies === 304)

  const reason =
    blocker ||
    (unchanged ? whyStateDiffers(state, record, servers) : 'a manifest changed or a server did not answer')
  if (reason) {
    console.info(`[SYNC] Pass (${mode}): ${reason} [${statusLine}]`)
    const errors = [...probes].filter(([, probe]) => !probe.ok).map(([serverId, probe]) => ({ serverId, error: probe.error }))
    return { skipped: false, mode, servers: probes, errors: errors.length > 0 ? errors : undefined, reason }
  }

  console.info(
    `[SYNC] Tick skipped: every manifest unchanged and every gate stamped [${statusLine}] (${Date.now() - startedAt}ms)`
  )
  const none = { tv: new Map(), movies: new Map() }
  const manifests = new Map(servers.map((server) => [server.id, state.manifests.get(server.id)]))
  console.info(tickPerfLine({ kind: 'skip', selected: none, manifests, perf: probePerf(probes) }))

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
  // Null when not due; never throws (a failure comes back as { error })
  const watchHistoryValidation = await validateWatchHistoryIfDue()

  const result = {
    syncRunId: null,
    skipped: true,
    reason: 'manifests_unchanged',
    servers: Object.fromEntries([...probes].map(([serverId, probe]) => [serverId, probe.statuses])),
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
 * the next tick may send its manifests' ETags and skip. Never throws: a pass
 * that is not recorded just means the next tick does not skip.
 *
 * @param {Object} args
 * @param {Object} args.client - MongoDB client
 * @param {string} args.syncRunId
 * @param {Object} args.results - syncAllServers' results
 * @param {Object|null} args.preTagResult
 * @param {Object} args.fileServers
 * @param {boolean} args.allEnabledServersProbed
 * @param {Object<string, {tv: string|null, movies: string|null}>|undefined} args.manifestETags -
 *   Per server, the ETags of the manifests this pass used (run/manifestTick)
 * @returns {Promise<boolean>} Whether the pass was recorded
 */
export async function recordCompletePass({
  client,
  syncRunId,
  results,
  preTagResult,
  fileServers,
  allEnabledServersProbed,
  manifestETags,
}) {
  try {
    if (!manifestETags) return false
    const servers = getAllServers()
    const reasons = incompletePassReasons({ results, preTagResult, fileServers, allEnabledServersProbed })
    for (const server of servers) {
      const etags = manifestETags[server.id]
      const missing = PAYLOAD_KINDS.filter((kind) => !etags?.[kind])
      if (missing.length > 0) reasons.push(`${server.id} has no manifest ETag for ${missing.join(' and ')}`)
    }
    if (reasons.length > 0) {
      console.info(`[SYNC] Pass not recorded as complete, the next tick does not skip: ${reasons.join('; ')}`)
      return false
    }

    const documentCounts = await countDocumentsOfRun(client.db('Media'), syncRunId)
    if (!holdsSyncLock(syncRunId)) {
      console.error(`[SYNC] Not recording run ${syncRunId} as complete: it no longer holds the sync lock`)
      return false
    }
    const recorded = await setAppliedPayloads(client, syncRunId, {
      recordFormat: RECORD_FORMAT,
      servers: Object.fromEntries(
        servers.map((server) => [
          server.id,
          Object.fromEntries(PAYLOAD_KINDS.map((kind) => [kind, manifestETags[server.id][kind]])),
        ])
      ),
      gateVersion: SYNC_GATE_VERSION,
      serversFingerprint: serversFingerprint(servers),
      bootId: currentBootId(),
      documentCounts,
    })
    if (!recorded) {
      console.info(
        '[SYNC] Pass not recorded as complete, the next tick does not skip: ' +
        'its running marker is gone or replaced (a Flat* document was deleted outside the sync during the pass)'
      )
    }
    return recorded
  } catch (error) {
    console.error(`[SYNC] Could not record the complete pass: ${error.message}`)
    return false
  }
}
