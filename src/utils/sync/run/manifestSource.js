/**
 * The file servers' per-title routes, from the sync's side: each kind's
 * manifest (`GET /media/<kind>/manifest`) and the entries of chosen titles
 * (`POST /media/<kind>/entries`). The processor's lib/mediaManifest.mjs holds
 * the contract; this module only reads it, and holds every answer to it.
 *
 * Only manifest format 2 is read. A server that answers the manifest with a 404
 * or another format runs a processor without that contract: it is a contract
 * failure, not retried, and the run treats the server as not answering. There
 * is no fallback to the full payloads.
 *
 * Reading the entries (NDJSON):
 *   - lines are split on the byte 0x0A only, then decoded as strict UTF-8 and
 *     parsed one by one (raw U+2028/U+2029 are legal inside JSON strings, so a
 *     line reader that splits on them would cut an entry in two);
 *   - every line is `{title, hash, entry}`, `{title, missing: true}` or the
 *     closing `{end: true, count}`, which must come last and count the title
 *     lines; a stream without it was cut off;
 *   - each title comes once; when titles were asked for, exactly those come;
 *   - any break of these, a body-stream error or a timeout fails the whole
 *     response: none of its lines is used.
 *
 * Every title-keyed structure is a Map, so any folder name is a key.
 *
 * Time. Each attempt has its own deadlines (headers, idle, total), and every
 * entries request of a run also carries the run's fetch-phase deadline (see
 * fetchPhaseBudgetMs), shared by all its attempts and rounds, so the fetch can
 * never outlive the orchestration lock's watchdog.
 */

import { getSyncUrls, fileServerVersionTV, fileServerVersionMOVIES } from '@src/utils/config'
import { getWebhookIdForServer } from '@src/utils/webhookServer'
import { LIST_VERSION_KEY } from './listing'

/** The manifest format this module reads (the processor's MANIFEST_FORMAT_VERSION). */
export const MANIFEST_FORMAT = 2

/** A title hash in a manifest or an entries line: the first 16 hex digits of a SHA-1. */
const TITLE_HASH = /^[0-9a-f]{16}$/

const EXPECTED_LIST_VERSIONS = { tv: fileServerVersionTV, movies: fileServerVersionMOVIES }

/** Per manifest attempt (the manifests are fetched before the lock). */
export const MANIFEST_TIMEOUTS = Object.freeze({ headersMs: 10_000, idleMs: 10_000, totalMs: 30_000 })

/**
 * The deadline over a tick's manifest probes, every server and kind at once,
 * retries included. Uncapped, one manifest could take 3 × 30 s plus backoff.
 */
export const PROBE_BUDGET_MS = 45_000

/** Per entries attempt; the fetch-phase deadline caps them all. */
export const ENTRIES_TIMEOUTS = Object.freeze({ headersMs: 10_000, idleMs: 30_000, totalMs: 120_000 })

/** Attempts per request, and the waits between them (each ±25 %). */
const ATTEMPTS = 3
const BACKOFF_MS = [1_000, 2_000]

/** The longest the entries fetch of one run may take, whatever the watchdog. */
export const FETCH_PHASE_BUDGET_MS = 240_000

/**
 * The entries fetch's deadline for a run: at most FETCH_PHASE_BUDGET_MS, and
 * at most half the lock watchdog, so the passes keep the other half.
 *
 * @param {number} watchdogMs - SYNC_LOCK_WATCHDOG_MS
 * @returns {number}
 */
export function fetchPhaseBudgetMs(watchdogMs) {
  return Math.min(FETCH_PHASE_BUDGET_MS, Math.floor(watchdogMs / 2))
}

const utf8 = new TextDecoder('utf-8', { fatal: true })

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value, keys) {
  const own = Object.keys(value)
  return own.length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

/** A break of the contract or of the protocol: retrying cannot help. */
class ContractError extends Error {}

/** The sync's own configuration is missing something (a webhook ID): retrying cannot help, and the server is not to blame. */
class ConfigError extends Error {}

/** A response that did not follow the line protocol (it may have been cut off). */
class ProtocolError extends Error {}

/** An HTTP status other than the ones the route answers with. */
class StatusError extends Error {
  constructor(status) {
    super(`HTTP ${status}`)
    this.status = status
  }
}

/** What was logged once per process (the `version` folder). */
const warned = new Set()
function warnOnce(key, message) {
  if (warned.has(key)) return
  warned.add(key)
  console.warn(message)
}

function concatBytes(chunks, size) {
  if (chunks.length === 1) return chunks[0]
  const out = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/**
 * One attempt's abort signal. It aborts when the total passes, when the
 * headers take longer than `headersMs`, when no byte comes for `idleMs` once
 * they have, or when `outer` (a deadline over every attempt) aborts, named by `outerReason`. `reason`
 * says which.
 */
function attemptTimer({ headersMs, idleMs, totalMs }, outer, outerReason = 'the deadline passed') {
  const controller = new AbortController()
  const timer = { signal: controller.signal, reason: null }
  const abort = (reason) => {
    if (controller.signal.aborted) return
    timer.reason = reason
    controller.abort(new Error(reason))
  }
  const total = setTimeout(() => abort(`no complete answer in ${totalMs} ms`), totalMs)
  let wait = setTimeout(() => abort(`no response headers in ${headersMs} ms`), headersMs)
  const idle = () => {
    clearTimeout(wait)
    wait = setTimeout(() => abort(`no bytes for ${idleMs} ms`), idleMs)
  }
  const onOuter = () => abort(outerReason)
  if (outer?.aborted) onOuter()
  else outer?.addEventListener('abort', onOuter, { once: true })
  timer.headersArrived = idle
  timer.progress = idle
  timer.done = () => {
    clearTimeout(total)
    clearTimeout(wait)
    outer?.removeEventListener('abort', onOuter)
  }
  return timer
}

/** A read from the body that gives up when `signal` aborts, whatever the stream does. */
function readChunk(reader, signal) {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    reader.read().then(
      (result) => {
        signal.removeEventListener('abort', onAbort)
        resolve(result)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      }
    )
  })
}

/** Wait `ms`, or less if `signal` aborts (then reject). */
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const done = () => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }
    const id = setTimeout(done, ms)
    const onAbort = () => {
      clearTimeout(id)
      reject(signal.reason)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function backoffMs(attempt, delays = BACKOFF_MS) {
  const base = delays[Math.min(attempt, delays.length - 1)]
  return base + base * 0.25 * (Math.random() * 2 - 1)
}

/** Whether another attempt may help after `error`. */
function isRetryable(error) {
  if (error instanceof ContractError || error instanceof ConfigError) return false
  if (error instanceof StatusError) return error.status >= 500 || error.status === 408 || error.status === 429
  return true
}

async function requestHeaders(serverId) {
  const webhookId = await getWebhookIdForServer(serverId)
  if (!webhookId) {
    throw new ConfigError(`no webhook ID configured for server ${serverId} (check WEBHOOK_ID)`)
  }
  return { 'x-webhook-id': webhookId }
}

/**
 * @typedef {Object} KindManifest
 * @property {string} etag - As the server sent it (weak)
 * @property {number} format - MANIFEST_FORMAT
 * @property {number} version - The list version
 * @property {Map<string, {hash: string, seasons?: Map<string, string[]>}>} titles -
 *   Folder name → its hash and, for TV, each season key with its episode keys.
 *   A folder named `version` is left out: the payload's list version shadows
 *   it, so it has never been synced (lifted when the payload goes, Step P).
 */

/**
 * Read a manifest body.
 *
 * @param {Uint8Array} bytes
 * @param {'tv'|'movies'} kind
 * @param {string} etag
 * @returns {KindManifest}
 */
export function parseManifest(bytes, kind, etag) {
  let body
  try {
    body = JSON.parse(utf8.decode(bytes))
  } catch (error) {
    throw new ProtocolError(`the manifest is not JSON: ${error.message}`)
  }
  if (!isPlainObject(body)) throw new ProtocolError('the manifest is not an object')
  if (body.format !== MANIFEST_FORMAT) {
    throw new ContractError(`answered manifest format ${JSON.stringify(body.format ?? null)}`)
  }
  if (body.kind !== kind) throw new ProtocolError(`the ${kind} manifest says it is ${JSON.stringify(body.kind)}`)
  if (typeof body.version !== 'number') throw new ProtocolError('the manifest has no list version')
  if (!isPlainObject(body.titles)) throw new ProtocolError('the manifest has no titles object')

  const titles = new Map()
  for (const [name, record] of Object.entries(body.titles)) {
    if (name === LIST_VERSION_KEY) {
      warnOnce(
        `version-folder:${kind}`,
        `[SYNC] A ${kind} folder named "version" is not synced: the payload's list version shadows it (until Step P)`
      )
      continue
    }
    if (!isPlainObject(record) || typeof record.hash !== 'string' || !TITLE_HASH.test(record.hash)) {
      throw new ProtocolError(`the manifest has no valid hash for ${JSON.stringify(name)}`)
    }
    if (kind !== 'tv') {
      titles.set(name, { hash: record.hash })
      continue
    }
    if (!isPlainObject(record.seasons)) {
      throw new ProtocolError(`the manifest has no seasons for ${JSON.stringify(name)}`)
    }
    const seasons = new Map()
    for (const [seasonKey, episodeKeys] of Object.entries(record.seasons)) {
      if (!Array.isArray(episodeKeys) || !episodeKeys.every((key) => typeof key === 'string')) {
        throw new ProtocolError(`the manifest's episode keys of ${JSON.stringify(name)} ${JSON.stringify(seasonKey)} are not strings`)
      }
      seasons.set(seasonKey, episodeKeys)
    }
    titles.set(name, { hash: record.hash, seasons })
  }

  if (body.version !== EXPECTED_LIST_VERSIONS[kind]) {
    console.error(`${kind} data version mismatch: ${body.version} not equal to expected ${EXPECTED_LIST_VERSIONS[kind]} (manifest)`)
  }
  return { etag, format: body.format, version: body.version, titles }
}

/**
 * Fetch one kind's manifest from a server.
 *
 * With `etag` (the manifest held from an earlier tick, as the server sent its
 * ETag) the request is conditional: If-None-Match plus `Cache-Control:
 * max-age=0` (Node's fetch adds no-cache otherwise). A 304 means the server
 * answered and the held manifest is current.
 *
 * @param {{id: string}} server
 * @param {'tv'|'movies'} kind
 * @param {Object} [options]
 * @param {string|null} [options.etag]
 * @param {AbortSignal} [options.deadline] - Stops every attempt and retry when it aborts
 * @param {Object} [options.timeouts] - MANIFEST_TIMEOUTS
 * @param {number[]} [options.retryDelaysMs] - The waits before the 2nd and 3rd attempts (±25 %)
 * @returns {Promise<
 *   {ok: true, status: 304, etag: string, received: number, parsed: number} |
 *   {ok: true, status: 200, manifest: KindManifest, received: number, parsed: number} |
 *   {ok: false, contract: boolean, error: string}
 * >} `contract` is true when the server does not serve manifest format 2
 *   (a 404, or another format): its processor predates the contract.
 */
export async function fetchManifest(
  server,
  kind,
  { etag = null, deadline = null, timeouts = MANIFEST_TIMEOUTS, retryDelaysMs = BACKOFF_MS } = {}
) {
  const url = `${getSyncUrls(server.id)[kind]}/manifest`
  let lastError = null
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (attempt > 0) {
      try {
        await sleep(backoffMs(attempt - 1, retryDelaysMs), deadline)
      } catch {
        lastError = new Error('the manifest deadline passed')
        break
      }
    }
    const timer = attemptTimer(timeouts, deadline, 'the manifest deadline passed')
    let reader = null
    try {
      const headers = await requestHeaders(server.id)
      if (etag) Object.assign(headers, { 'If-None-Match': etag, 'Cache-Control': 'max-age=0' })
      const response = await fetch(url, { headers, signal: timer.signal })
      timer.headersArrived()
      if (response.status === 304) {
        if (!etag) throw new ProtocolError('answered 304 to a request that was not conditional')
        await response.body?.cancel()
        return { ok: true, status: 304, etag, received: 0, parsed: 0 }
      }
      if (response.status === 404) {
        await response.body?.cancel()
        throw new ContractError('answered 404 (no manifest route)')
      }
      if (response.status !== 200) {
        await response.body?.cancel()
        throw new StatusError(response.status)
      }
      const responseETag = response.headers.get('etag')
      if (!responseETag) throw new ProtocolError('the manifest came without an ETag')
      reader = response.body.getReader()
      const chunks = []
      let size = 0
      for (;;) {
        const { done, value } = await readChunk(reader, timer.signal)
        if (done) break
        timer.progress()
        chunks.push(value)
        size += value.byteLength
      }
      reader = null
      const manifest = parseManifest(concatBytes(chunks, size), kind, responseETag)
      return { ok: true, status: 200, manifest, received: size, parsed: size }
    } catch (error) {
      lastError = timer.reason ? new Error(timer.reason) : error
      if (deadline?.aborted || !isRetryable(error)) break
    } finally {
      timer.done()
      reader?.cancel().catch(() => {})
    }
  }
  return {
    ok: false,
    contract: lastError instanceof ContractError,
    error: `${kind} manifest from ${url}: ${lastError?.message ?? lastError}`,
  }
}

/**
 * The lines of one entries response, checked as they come.
 *
 * @param {Set<string>|null} requested - The titles asked for; null for `{all: true}`
 */
function createEntriesParser(requested) {
  const lines = new Map()
  let titleLines = 0
  let ended = false
  let parsed = 0
  let pending = []
  let pendingSize = 0

  const onLine = (bytes) => {
    if (ended) throw new ProtocolError('a line came after the end line')
    parsed += bytes.byteLength
    let value
    try {
      value = JSON.parse(utf8.decode(bytes))
    } catch (error) {
      throw new ProtocolError(`a line is not JSON: ${error.message}`)
    }
    if (!isPlainObject(value)) throw new ProtocolError('a line is not an object')
    if (value.end === true) {
      if (!hasExactKeys(value, ['end', 'count']) || !Number.isInteger(value.count)) {
        throw new ProtocolError('the end line is malformed')
      }
      if (value.count !== titleLines) {
        throw new ProtocolError(`the end line counts ${value.count} titles, ${titleLines} came`)
      }
      ended = true
      return
    }
    const title = value.title
    if (typeof title !== 'string') throw new ProtocolError('a line has no title')
    if (lines.has(title)) throw new ProtocolError(`${JSON.stringify(title)} came twice`)
    if (requested && !requested.has(title)) throw new ProtocolError(`${JSON.stringify(title)} was not asked for`)
    if (value.missing === true && hasExactKeys(value, ['title', 'missing'])) {
      lines.set(title, { missing: true })
    } else if (
      hasExactKeys(value, ['title', 'hash', 'entry']) &&
      typeof value.hash === 'string' &&
      TITLE_HASH.test(value.hash) &&
      isPlainObject(value.entry)
    ) {
      lines.set(title, { hash: value.hash, entry: value.entry })
    } else {
      throw new ProtocolError(`the line for ${JSON.stringify(title)} has an unknown shape`)
    }
    titleLines += 1
  }

  return {
    /** Feed the next chunk of the body; whole lines are parsed now, a partial one is kept. */
    push(chunk) {
      let start = 0
      for (;;) {
        const newline = chunk.indexOf(0x0a, start)
        if (newline === -1) {
          if (start < chunk.byteLength) {
            pending.push(chunk.subarray(start))
            pendingSize += chunk.byteLength - start
          }
          return
        }
        const piece = chunk.subarray(start, newline)
        const line = pendingSize > 0 ? concatBytes([...pending, piece], pendingSize + piece.byteLength) : piece
        pending = []
        pendingSize = 0
        onLine(line)
        start = newline + 1
      }
    },
    /** The body ended: everything must have come, closed by the end line. */
    finish() {
      if (pendingSize > 0) throw new ProtocolError('the body ends inside a line (cut off)')
      if (!ended) throw new ProtocolError('no end line (the body was cut off)')
      if (requested) {
        for (const title of requested) {
          if (!lines.has(title)) throw new ProtocolError(`no line for ${JSON.stringify(title)}`)
        }
      }
      return { lines, parsed }
    },
  }
}

/**
 * Fetch the entries of chosen titles (or of all) from a server, as NDJSON.
 *
 * A response counts only when it is complete and follows the protocol (see the
 * module comment); otherwise the request is retried, and after the last
 * attempt it failed, with none of its lines kept. A `missing` line is not a
 * deletion: it says the title is not in the generation this response comes
 * from, which `manifestETag` names.
 *
 * @param {{id: string}} server
 * @param {'tv'|'movies'} kind
 * @param {{titles: string[]}|{all: true}} request
 * @param {Object} options
 * @param {AbortSignal} options.deadline - The run's fetch-phase deadline
 *   (fetchPhaseBudgetMs), shared by every attempt
 * @param {Object} [options.timeouts] - ENTRIES_TIMEOUTS
 * @param {number[]} [options.retryDelaysMs] - The waits before the 2nd and 3rd attempts (±25 %)
 * @returns {Promise<
 *   {ok: true, lines: Map<string, {hash: string, entry: Object}|{missing: true}>,
 *    manifestETag: string, libraryETag: string|null, received: number, parsed: number} |
 *   {ok: false, error: string}
 * >}
 */
export async function fetchEntries(
  server,
  kind,
  request,
  { deadline = null, timeouts = ENTRIES_TIMEOUTS, retryDelaysMs = BACKOFF_MS } = {}
) {
  const url = `${getSyncUrls(server.id)[kind]}/entries`
  const requested = request.all === true ? null : new Set(request.titles)
  const body = JSON.stringify(requested ? { titles: [...requested] } : { all: true })
  let lastError = null
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (attempt > 0) {
      try {
        await sleep(backoffMs(attempt - 1, retryDelaysMs), deadline)
      } catch {
        lastError = new Error('the fetch phase deadline passed')
        break
      }
    }
    const timer = attemptTimer(timeouts, deadline, 'the fetch phase deadline passed')
    let reader = null
    let received = 0
    try {
      const headers = await requestHeaders(server.id)
      headers['Content-Type'] = 'application/json'
      headers.Accept = 'application/x-ndjson'
      const response = await fetch(url, { method: 'POST', headers, body, signal: timer.signal })
      timer.headersArrived()
      if (response.status !== 200) {
        await response.body?.cancel()
        throw new StatusError(response.status)
      }
      const manifestETag = response.headers.get('x-manifest-etag')
      if (!manifestETag) throw new ProtocolError('no X-Manifest-ETag header')
      const parser = createEntriesParser(requested)
      reader = response.body.getReader()
      for (;;) {
        const { done, value } = await readChunk(reader, timer.signal)
        if (done) break
        timer.progress()
        received += value.byteLength
        parser.push(value)
      }
      reader = null
      const { lines, parsed } = parser.finish()
      return { ok: true, lines, manifestETag, libraryETag: response.headers.get('x-library-etag'), received, parsed }
    } catch (error) {
      lastError = timer.reason ? new Error(timer.reason) : error
      if (deadline?.aborted || !isRetryable(error)) break
    } finally {
      timer.done()
      reader?.cancel().catch(() => {})
    }
  }
  return { ok: false, error: `${kind} entries from ${url}: ${lastError?.message ?? lastError}` }
}
