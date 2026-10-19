/**
 * A sync tick on the file servers' manifests (run/manifestSource).
 *
 * Before the lock (fetchSyncTick in run/tickSkip): probeServers asks every
 * enabled server for its two manifests, conditionally with the ones the last
 * run used. A tick whose manifests all answer 304, with nothing else to do, is
 * skipped there.
 *
 * Under the lock, after the run's marker (syncAllServers): buildTickInputs
 * selects the titles to pass over (run/selectTitles), asks each answering
 * server for the entries of the selected titles it lists, one request per
 * server and kind, and builds the pass's inputs: the payloads of those titles
 * only (from every server that lists them), each server's whole listing (from
 * its manifest), fieldAvailability and whether every enabled server answered.
 *
 * A server answered only when both its manifests and every entries request
 * made to it succeeded. Otherwise it is out of the tick, as a server whose
 * payloads failed to download always was: its titles are not stamped, nothing
 * is deleted, and the run is not recorded. A manifest 404, or a format other
 * than 2, is such a failure, logged on every tick: there is no fallback to the
 * full payloads.
 *
 * A library that moved between the manifest and the entries (the entries'
 * X-Manifest-ETag is not the manifest's) gets one conditional re-read of that
 * manifest. A format-2 re-read with exactly that ETag is adopted: its lines
 * apply, and it becomes the server's listing and remembered manifest for the
 * kind. Anything else and the server did not answer. A `missing` line comes
 * only with such a move: once the re-read is adopted, the title is not listed
 * there, and it leaves this tick (its `applied` cleared, so the next tick takes
 * it up). A `missing` line never deletes anything by itself.
 */

import { getAllServers } from '@src/utils/config'
import { fetchManifest, fetchEntries, fetchPhaseBudgetMs, PROBE_BUDGET_MS } from './manifestSource'
import { selectTitles, readSelectionFacts } from './selectTitles'
import { listingOfManifests } from './listing'
import { buildFieldAvailability } from './availability'
import { recordApplied, forgetUnlisted } from './tickState'

const KINDS = ['tv', 'movies']

/** What a server must serve, named in the error a server that does not serve it gets. */
export const MANIFEST_CONTRACT = 'manifest format 2 (the processor’s per-title manifest and entries routes, T4a-2)'

/**
 * @typedef {Object} Probe - One server's answer to the two manifest requests
 * @property {boolean} ok
 * @property {{tv: Object, movies: Object}} [manifests] - KindManifests: the held one on a 304
 * @property {{tv: number, movies: number}} [statuses] - 200 or 304
 * @property {{tv: {received: number, parsed: number}, movies: {received: number, parsed: number}}} [bytes]
 * @property {string} [error]
 * @property {boolean} [contract] - The server does not serve manifest format 2
 */

/**
 * Ask every enabled server for its two manifests, all at once, under one
 * deadline (PROBE_BUDGET_MS) over every request and retry.
 *
 * @param {Array<{id: string}>} servers - Enabled servers, in config order
 * @param {Map<string, {tv?: Object, movies?: Object}>|null} held - The
 *   manifests the last run used (run/tickState), sent as If-None-Match; null
 *   asks unconditionally
 * @returns {Promise<Map<string, Probe>>} In `servers` order
 */
export async function probeServers(servers, held) {
  const budget = new AbortController()
  const timer = setTimeout(() => budget.abort(new Error('the manifest deadline passed')), PROBE_BUDGET_MS)
  const probes = await Promise.all(
    servers.map(async (server) => {
      const heldKinds = held?.get(server.id)
      const answers = await Promise.all(
        KINDS.map((kind) => fetchManifest(server, kind, { etag: heldKinds?.[kind]?.etag ?? null, deadline: budget.signal }))
      )
      const probe = { ok: true, manifests: {}, statuses: {}, bytes: {} }
      for (const [i, kind] of KINDS.entries()) {
        const answer = answers[i]
        if (!answer.ok) return [server.id, { ok: false, contract: answer.contract, error: answer.error }]
        probe.statuses[kind] = answer.status
        probe.manifests[kind] = answer.status === 304 ? heldKinds[kind] : answer.manifest
        probe.bytes[kind] = { received: answer.received, parsed: answer.parsed }
      }
      return [server.id, probe]
    })
  ).finally(() => clearTimeout(timer))
  return new Map(probes)
}

/** Log one error per server that did not answer its manifests. */
export function logProbeFailures(probes) {
  for (const [serverId, probe] of probes) {
    if (probe.ok) continue
    console.error(
      `[SYNC] ${serverId} did not answer this tick: ${probe.error}` +
        (probe.contract ? `. The sync needs ${MANIFEST_CONTRACT}; this server is left out until its processor serves it.` : '')
    )
  }
}

/** `default tv=304 movies=200, server2 failed` */
export function formatProbeStatuses(probes) {
  return [...probes]
    .map(([serverId, probe]) =>
      probe.ok ? `${serverId} ${KINDS.map((kind) => `${kind}=${probe.statuses[kind]}`).join(' ')}` : `${serverId} failed`
    )
    .join(', ')
}

/** At most this many rounds of entries requests per run (a library that keeps moving). */
const MAX_ROUNDS = 4

/** The config a server's pass reads, as the payload fetch used to hand it over. */
function passConfig(server) {
  return {
    baseURL: server.baseURL,
    prefixPath: server.prefixPath,
    syncEndpoint: server.syncEndpoint,
    priority: server.priority,
  }
}

const emptyKinds = () => ({ tv: new Map(), movies: new Map() })

/** Per kind, every title an answering server lists. */
function listedTitles(manifests) {
  const listed = { tv: new Set(), movies: new Set() }
  for (const kinds of manifests.values()) {
    for (const kind of KINDS) for (const title of kinds[kind].titles.keys()) listed[kind].add(title)
  }
  return listed
}

/**
 * What is still to be asked for: per server and kind, the selected titles it
 * lists that have not come yet. `{all: true}` when that is everything it lists
 * and nothing of the kind has come from it yet.
 */
function pendingRequests(manifests, selected, dropped, fetched) {
  const requests = new Map()
  for (const [serverId, kinds] of manifests) {
    const request = {}
    for (const kind of KINDS) {
      const have = fetched.get(serverId)[kind]
      const titles = []
      for (const title of kinds[kind].titles.keys()) {
        if (selected[kind].has(title) && !dropped[kind].has(title) && !have.has(title)) titles.push(title)
      }
      if (titles.length === 0) continue
      request[kind] = have.size === 0 && titles.length === kinds[kind].titles.size ? { all: true } : { titles }
    }
    if (Object.keys(request).length > 0) requests.set(serverId, request)
  }
  return requests
}

/**
 * Check one entries response against the manifest its lines must come from,
 * re-reading that manifest once when the library moved (see the module
 * comment).
 *
 * @returns {Promise<{ok: true, adopted: Object|null, entries: Map, missing: string[]} | {ok: false, error: string}>}
 */
async function readKindAnswer(server, kind, request, response, manifest, perf, deadline) {
  if (!response.ok) return { ok: false, error: response.error }
  perf.received += response.received
  perf.parsed += response.parsed
  perf.titles += response.lines.size
  let adopted = null
  if (response.manifestETag !== manifest.etag) {
    const reread = await fetchManifest(server, kind, { etag: manifest.etag, deadline })
    if (reread.ok) {
      perf.received += reread.received
      perf.parsed += reread.parsed
    }
    if (!reread.ok || reread.status !== 200 || reread.manifest.etag !== response.manifestETag) {
      const got = !reread.ok ? reread.error : reread.status === 304 ? 'it answered 304' : `it is ${reread.manifest.etag}`
      return {
        ok: false,
        error: `${kind}: the library moved during the tick (entries of ${response.manifestETag}, manifest ${manifest.etag}) and the manifest re-read did not match (${got})`,
      }
    }
    adopted = reread.manifest
  }
  const current = adopted ?? manifest
  const entries = new Map()
  const missing = []
  for (const [title, line] of response.lines) {
    const listed = current.titles.get(title)
    if (line.missing) {
      if (listed) return { ok: false, error: `${kind}: ${JSON.stringify(title)} came missing, yet its manifest lists it` }
      missing.push(title)
      continue
    }
    if (!listed) {
      // {all: true} sends every folder the library has. A processor whose
      // payload's list version shadowed a folder named `version` leaves it out
      // of its manifest but may still send its line; only the manifest's
      // titles are synced (and pre-tagged)
      if (request.all === true) continue
      return { ok: false, error: `${kind}: ${JSON.stringify(title)} is not in the manifest its entries come from` }
    }
    if (line.hash !== listed.hash) {
      return { ok: false, error: `${kind}: ${JSON.stringify(title)} came with hash ${line.hash}, its manifest has ${listed.hash}` }
    }
    entries.set(title, line)
  }
  if (request.all === true) {
    for (const title of current.titles.keys()) {
      if (!entries.has(title)) return { ok: false, error: `${kind}: no entry for ${JSON.stringify(title)}` }
    }
  }
  return { ok: true, adopted, entries, missing }
}

/** Union of two selections, kept to titles some answering server still lists. */
function mergeSelections(previous, next, manifests) {
  const listed = listedTitles(manifests)
  const merged = { tv: new Map(), movies: new Map() }
  for (const kind of KINDS) {
    for (const source of [next[kind], previous[kind]]) {
      for (const [title, reasons] of source) {
        if (listed[kind].has(title) && !merged[kind].has(title)) merged[kind].set(title, reasons)
      }
    }
  }
  return merged
}

/**
 * Select the titles, fetch their entries and build the pass's inputs. Runs
 * under the lock, after the run's marker. Never throws for a server that
 * fails: that server is left out and named in `errors`.
 *
 * @param {Object} args
 * @param {{servers: Map<string, Probe>, errors?: Array}} args.tick - From fetchSyncTick
 * @param {'all'|'select'} args.mode - As confirmed under the lock
 * @param {Object|null} args.state - run/tickState (read on a select tick)
 * @param {import('mongodb').Db} args.db - The media database (select only)
 * @param {number} args.watchdogMs - SYNC_LOCK_WATCHDOG_MS: the fetch phase gets fetchPhaseBudgetMs of it
 */
export async function buildTickInputs({ tick, mode, state, db, watchdogMs }) {
  const configs = new Map(getAllServers().map((server) => [server.id, server]))
  const errors = [...(tick.errors ?? [])]
  const manifests = new Map()
  const perf = new Map()
  for (const [serverId, probe] of tick.servers) {
    if (!probe.ok) continue
    manifests.set(serverId, { ...probe.manifests })
    perf.set(
      serverId,
      Object.fromEntries(
        KINDS.map((kind) => [kind, { manifest: probe.statuses[kind], titles: 0, ...probe.bytes[kind] }])
      )
    )
  }

  const facts = mode === 'select' ? await readSelectionFacts(db) : null
  const select = () => selectTitles({ mode, manifests, applied: state?.applied, held: state?.manifests, facts })
  let selected = select()
  const dropped = { tv: new Set(), movies: new Set() }
  const fetched = new Map([...manifests.keys()].map((serverId) => [serverId, emptyKinds()]))
  const exclude = (serverId, error) => {
    manifests.delete(serverId)
    fetched.delete(serverId)
    errors.push({ serverId, error })
    console.error(`[SYNC] ${serverId} did not answer this tick: ${error}`)
  }

  const budget = fetchPhaseBudgetMs(watchdogMs)
  const phase = new AbortController()
  const deadline = setTimeout(() => phase.abort(new Error(`the fetch phase deadline (${budget} ms) passed`)), budget)
  try {
    for (let round = 0; ; round++) {
      const requests = pendingRequests(manifests, selected, dropped, fetched)
      if (requests.size === 0) break
      if (round >= MAX_ROUNDS) {
        for (const serverId of requests.keys()) exclude(serverId, 'its library kept moving during the tick')
        break
      }
      const outcomes = await Promise.all(
        [...requests].map(async ([serverId, kinds]) => {
          const server = configs.get(serverId)
          const answers = await Promise.all(
            Object.entries(kinds).map(async ([kind, request]) => {
              const response = await fetchEntries(server, kind, request, { deadline: phase.signal })
              const answer = await readKindAnswer(
                server,
                kind,
                request,
                response,
                manifests.get(serverId)[kind],
                perf.get(serverId)[kind],
                phase.signal
              )
              return [kind, answer]
            })
          )
          return [serverId, answers]
        })
      )
      let excludedAny = false
      for (const [serverId, answers] of outcomes) {
        const failed = answers.find(([, answer]) => !answer.ok)
        if (failed) {
          exclude(serverId, failed[1].error)
          excludedAny = true
          continue
        }
        for (const [kind, answer] of answers) {
          const have = fetched.get(serverId)[kind]
          if (answer.adopted) {
            manifests.get(serverId)[kind] = answer.adopted
            // What came from an older generation is asked for again, or dropped
            for (const [title, line] of [...have]) {
              if (answer.adopted.titles.get(title)?.hash !== line.hash) have.delete(title)
            }
          }
          for (const title of answer.missing) dropped[kind].add(title)
          for (const [title, line] of answer.entries) have.set(title, line)
        }
      }
      // A server that left the tick changes who lists its titles (R2)
      selected = mergeSelections(selected, excludedAny ? select() : selected, manifests)
      for (const kind of KINDS) for (const title of dropped[kind]) selected[kind].delete(title)
    }
  } finally {
    clearTimeout(deadline)
  }

  // The payloads of the selected titles, from every answering server that
  // lists them, in each manifest's order (the order the payload had)
  const fileServers = {}
  const hashes = { tv: new Map(), movies: new Map() }
  for (const [serverId, kinds] of manifests) {
    const payloads = {}
    for (const kind of KINDS) {
      const entries = []
      for (const title of kinds[kind].titles.keys()) {
        if (!selected[kind].has(title)) continue
        const line = fetched.get(serverId)[kind].get(title)
        if (!line) throw new Error(`${serverId} ${kind}: ${JSON.stringify(title)} was selected but never fetched`)
        entries.push([title, line.entry])
        if (!hashes[kind].has(title)) hashes[kind].set(title, new Map())
        hashes[kind].get(title).set(serverId, line.hash)
      }
      payloads[kind] = Object.fromEntries(entries)
    }
    fileServers[serverId] = { config: passConfig(configs.get(serverId)), movies: payloads.movies, tv: payloads.tv }
  }

  return {
    mode,
    fileServers,
    // The gate for every removal the pass and cleanup make: every enabled
    // server answered its manifests and every entries request made to it
    allEnabledServersProbed: errors.length === 0 && manifests.size > 0,
    errors,
    fieldAvailability: await buildFieldAvailability(fileServers),
    listings: new Map([...manifests].map(([serverId, kinds]) => [serverId, listingOfManifests(kinds.tv, kinds.movies)])),
    manifests,
    selected,
    dropped,
    hashes,
    perf,
  }
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`

/**
 * The tick's one `[SYNC PERF]` line: its kind (skip, select or all), the
 * selected titles per kind out of those listed, and per server and kind the
 * manifest's status, the entries that came and the bytes received and parsed.
 *
 * @param {Object} args
 * @param {'skip'|'select'|'all'} args.kind
 * @param {{tv: Map, movies: Map}} args.selected
 * @param {Map<string, {tv: Object, movies: Object}>} args.manifests
 * @param {Map<string, Object>} args.perf - Server id → per kind {manifest, titles, received, parsed}
 * @returns {string}
 */
export function tickPerfLine({ kind, selected, manifests, perf }) {
  const listed = listedTitles(manifests)
  const servers = [...perf].map(
    ([serverId, kinds]) =>
      `${serverId} ` +
      KINDS.map((k) => {
        const p = kinds[k]
        return `${k}: manifest ${p.manifest}, ${p.titles} entries, ${kb(p.received)} received, ${kb(p.parsed)} parsed`
      }).join('; ')
  )
  return (
    `[SYNC PERF] tick=${kind} selected tv=${selected.tv.size}/${listed.tv.size} ` +
    `movies=${selected.movies.size}/${listed.movies.size}` +
    (servers.length > 0 ? ` | ${servers.join(' | ')}` : '')
  )
}

/** perf for a tick that fetched manifests only (a skip). */
export function probePerf(probes) {
  return new Map(
    [...probes]
      .filter(([, probe]) => probe.ok)
      .map(([serverId, probe]) => [
        serverId,
        Object.fromEntries(KINDS.map((kind) => [kind, { manifest: probe.statuses[kind], titles: 0, ...probe.bytes[kind] }])),
      ])
  )
}

/**
 * After the passes: `applied` again for every selected title that finished
 * cleanly on every answering server that lists it, with the hashes of the
 * entries used; forget the titles no answering server lists. (beginRun cleared
 * the selected titles before any write.)
 *
 * @param {Object} state - run/tickState
 * @param {Awaited<ReturnType<typeof buildTickInputs>>} inputs
 * @param {{tv: Map<string, Map<string, boolean>>, movies: Map<string, Map<string, boolean>>}} finished -
 *   Per kind and title, per server, whether its pass finished the title cleanly
 * @param {string} syncRunId - The run settling them: nothing is kept unless it
 *   still holds the lock and the state tracks it (run/tickState)
 */
export function settleApplied(state, inputs, finished, syncRunId) {
  const listed = listedTitles(inputs.manifests)
  for (const kind of KINDS) {
    for (const title of inputs.selected[kind].keys()) {
      const servers = inputs.hashes[kind].get(title)
      if (!servers || servers.size === 0) continue
      const clean = [...servers.keys()].every((serverId) => finished[kind].get(title)?.get(serverId) === true)
      if (clean) recordApplied(state, kind, title, servers, syncRunId)
    }
    forgetUnlisted(state, kind, listed[kind], syncRunId)
  }
}
