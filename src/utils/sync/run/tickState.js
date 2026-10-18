/**
 * What the manifest tick remembers between ticks, in this process only:
 *
 *   - per server and kind, the manifest the last run used (its ETag goes out as
 *     If-None-Match, and a 304 hands it back for the tick);
 *   - per kind and title, `applied`: the servers whose entries the last pass
 *     over the title used, each with the hash of the entry it applied (the
 *     entries line's hash, never the manifest's). Set only when that pass
 *     finished the title cleanly on every server that lists it;
 *   - `lastRunId`, the run that last changed `applied`.
 *
 * Nothing of it is written anywhere: a new process starts without it, and its
 * first tick passes over every title (the boot-time full pass T1 already
 * makes), which seeds it.
 *
 * It is trusted only while it tracks the last run (whyStateUnusable): the
 * record in `app_config.syncInfo` must name `lastRunId`. A run this state did
 * not see (another process, a run that wrote its marker and threw before
 * reaching beginRun, an admin delete that forgot the record) makes the next
 * tick pass over everything.
 *
 * `applied` is cleared before it is set (beginRun, then recordApplied): every
 * selected title loses its entry before any pass writes, and gets it back only
 * when its pass finished cleanly. A run that throws anywhere in between leaves
 * those titles unapplied, so the next tick selects them again, whatever hash
 * their servers publish by then.
 *
 * Only the run that holds the orchestration lock changes it, and once
 * begun, only while the state still tracks that run: a run the lock watchdog
 * released (it overran) may keep writing, and must neither begin nor record.
 * syncAllServers drops the whole state when it releases a run's lock by force
 * and when such a run finally ends, so the next tick passes over everything.
 *
 * All title-keyed structures are Maps. Kept on globalThis so every bundle that
 * loads this module in the one process shares it.
 */

import { getSyncLockHolder } from './runState'

const KINDS = ['tv', 'movies']

/** Whether `syncRunId` holds the orchestration lock. */
const holdsLock = (syncRunId) => Boolean(syncRunId) && getSyncLockHolder()?.syncRunId === syncRunId

/** Whether `syncRunId` may change `state`: it holds the lock, and the state is the current one and tracks it. */
const tracks = (state, syncRunId) =>
  holdsLock(syncRunId) && state === getTickState() && state?.lastRunId === syncRunId

/**
 * @typedef {Object} TickState
 * @property {string} bootId
 * @property {number} gateVersion
 * @property {string} serversFingerprint
 * @property {string|null} lastRunId
 * @property {Map<string, {tv?: Object, movies?: Object}>} manifests - Server id → its KindManifests
 * @property {{tv: Map<string, Map<string, string>>, movies: Map<string, Map<string, string>>}} applied
 */

/** @returns {TickState|null} */
export function getTickState() {
  return globalThis.__syncTickState ?? null
}

/**
 * Drop the state, so the next tick passes over every title. syncAllServers
 * calls it when the lock watchdog releases a run, and when a run that lost its
 * lock ends: that run's late writes are not in `applied`.
 */
export function resetTickState() {
  globalThis.__syncTickState = null
}

function freshState({ bootId, gateVersion, serversFingerprint }) {
  return {
    bootId,
    gateVersion,
    serversFingerprint,
    lastRunId: null,
    manifests: new Map(),
    applied: { tv: new Map(), movies: new Map() },
  }
}

/**
 * Why the state cannot be used for this tick, or null when it can.
 *
 * @param {TickState|null} state
 * @param {Object} current
 * @param {Object|null} current.record - The `appliedPayloads` record, running marker or complete
 * @param {string} current.bootId
 * @param {number} current.gateVersion
 * @param {string} current.serversFingerprint
 * @returns {string|null}
 */
export function whyStateUnusable(state, { record, bootId, gateVersion, serversFingerprint }) {
  if (!state) return 'no tick state in this process'
  if (state.bootId !== bootId) return 'the tick state is from another process'
  if (state.gateVersion !== gateVersion) return `gate version changed (${state.gateVersion} -> ${gateVersion})`
  if (state.serversFingerprint !== serversFingerprint) return 'servers or priorities changed'
  if (!record?.syncRunId) return 'no pass on record'
  if (record.syncRunId !== state.lastRunId) {
    return `the last run on record (${record.syncRunId}) is not the one this state saw (${state.lastRunId})`
  }
  return null
}

/**
 * Start a run's changes to the state: after the run's marker is written and
 * its entries are fetched, before any Flat* write.
 *
 * An `all` run (or one with no state) starts from a fresh state. The run's
 * manifests replace the held ones of the servers that answered; every selected
 * title loses its `applied` entry; `lastRunId` becomes this run.
 *
 * @param {Object} run
 * @param {string} run.syncRunId
 * @param {'all'|'select'} run.mode
 * @param {string} run.bootId
 * @param {number} run.gateVersion
 * @param {string} run.serversFingerprint
 * @param {Map<string, {tv: Object, movies: Object}>} run.manifests - The answering servers' manifests
 * @param {{tv: Iterable<string>, movies: Iterable<string>}} run.selected
 * @returns {TickState|null} Null, and nothing changed, for a run that does not
 *   hold the lock
 */
export function beginRun({ syncRunId, mode, bootId, gateVersion, serversFingerprint, manifests, selected }) {
  if (!holdsLock(syncRunId)) return null
  let state = getTickState()
  if (mode === 'all' || !state) {
    state = freshState({ bootId, gateVersion, serversFingerprint })
    globalThis.__syncTickState = state
  }
  for (const [serverId, kinds] of manifests) {
    state.manifests.set(serverId, { ...state.manifests.get(serverId), ...kinds })
  }
  for (const kind of KINDS) {
    for (const title of selected[kind]) state.applied[kind].delete(title)
  }
  state.lastRunId = syncRunId
  return state
}

/**
 * A selected title's pass finished cleanly on every server that lists it.
 * Ignored unless `syncRunId` still holds the lock and the state tracks it.
 *
 * @param {TickState} state
 * @param {'tv'|'movies'} kind
 * @param {string} title
 * @param {Map<string, string>} servers - Server id → the hash of the entry applied
 * @param {string} syncRunId - The run recording it
 * @returns {boolean} Whether it was recorded
 */
export function recordApplied(state, kind, title, servers, syncRunId) {
  if (!tracks(state, syncRunId)) return false
  state.applied[kind].set(title, new Map(servers))
  return true
}

/**
 * Forget the titles no answering server lists any more. Ignored unless
 * `syncRunId` still holds the lock and the state tracks it.
 *
 * @param {TickState} state
 * @param {'tv'|'movies'} kind
 * @param {Set<string>} listed
 * @param {string} syncRunId - The run forgetting them
 */
export function forgetUnlisted(state, kind, listed, syncRunId) {
  if (!tracks(state, syncRunId)) return
  for (const title of [...state.applied[kind].keys()]) {
    if (!listed.has(title)) state.applied[kind].delete(title)
  }
}
