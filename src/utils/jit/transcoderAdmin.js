import 'server-only'

/**
 * Calls each file server's transcoder admin API (jit-transcoder `GET /admin/sessions`, schema 1)
 * for the admin dashboard and for the serve-time queue ceiling (`health.js`).
 *
 * Which transcoder belongs to which file server is read from that server's synced titles: the
 * base every `jitUrl` was minted from (everything before `/stream/`). The app calls that same
 * base players use, so the transcoder can live on any host or network a player can reach, unless
 * `JIT_TRANSCODER_INTERNAL_URL[_N]` names a private one. The key and that override come from
 * `transcoderAdminConfig.js`. A server's key only ever goes to a base learned from that server's
 * own titles or its own variable.
 *
 * Every failure returns no data and says what to fix (`detail` names the variable or the URL);
 * nothing falls back to another server's key or to stale data shown as live.
 */

import { getAllServers } from '@src/utils/config'
import { createLogger } from '@src/lib/logger'
import { resolveTranscoderKey, resolveInternalBase } from './transcoderAdminConfig'

const log = createLogger('JIT.TranscoderAdmin')

/** How long the server → transcoder-base map is reused. A transcoder rarely moves. */
const DISCOVERY_TTL_MS = 5 * 60_000
/** One answer serves every dashboard tab (and the health probe) for this long. */
const FETCH_TTL_MS = 4_000
const FETCH_TIMEOUT_MS = 3_000

let discovery = { at: 0, promise: null }
/** base → { at, promise } */
const fetches = new Map()
/** base → the last failure reason logged, so a broken target logs once, not every poll. */
const lastLogged = new Map()

/**
 * serverId → sorted transcoder bases seen in that server's titles. Two small aggregations, each
 * grouping by `(videoSource, base)`; the collections are walked at most once per
 * DISCOVERY_TTL_MS, and only when a dashboard or a configured queue ceiling asks.
 */
async function discoverBases() {
  if (discovery.promise && Date.now() - discovery.at < DISCOVERY_TTL_MS) return discovery.promise
  const promise = (async () => {
    const { default: clientPromise } = await import('@src/lib/mongodb')
    const db = (await clientPromise).db('Media')
    const pipeline = [
      { $match: { jitUrl: { $type: 'string', $ne: '' }, videoSource: { $type: 'string' } } },
      {
        $group: {
          _id: {
            server: '$videoSource',
            base: { $arrayElemAt: [{ $split: ['$jitUrl', '/stream/'] }, 0] },
          },
        },
      },
    ]
    const groups = (
      await Promise.all(['FlatMovies', 'FlatEpisodes'].map((c) => db.collection(c).aggregate(pipeline).toArray()))
    ).flat()
    const bases = new Map()
    for (const { _id } of groups) {
      if (typeof _id?.base !== 'string' || !/^https?:\/\//.test(_id.base)) continue
      if (!bases.has(_id.server)) bases.set(_id.server, new Set())
      bases.get(_id.server).add(_id.base.replace(/\/+$/, ''))
    }
    return new Map([...bases].map(([server, set]) => [server, [...set].sort()]))
  })()
  discovery = { at: Date.now(), promise }
  // A failed walk must not be cached for five minutes.
  promise.catch(() => {
    if (discovery.promise === promise) discovery = { at: 0, promise: null }
  })
  return promise
}

/**
 * Every file server with how the app reaches its transcoder:
 * `{ serverId, displayName, publicBases, keyVariable, internalBase, endpoints, problem }`.
 * `endpoints` are the bases to call (the internal one when set, else every public base);
 * `problem` is set when none can be called, naming what to fix. Safe to send to the admin UI:
 * it never carries a key (see `fetchTargetSessions`).
 */
export async function getTranscoderTargets() {
  const bases = await discoverBases()
  return getAllServers().map((server) => {
    const key = resolveTranscoderKey(server.id)
    const internal = resolveInternalBase(server.id)
    const publicBases = bases.get(server.id) ?? []
    let problem = null
    if (!key.ok) problem = key.reason
    else if (!internal.ok) problem = internal.reason
    else if (!internal.base && publicBases.length === 0) {
      problem = `no title on this server carries a transcoder URL (jitUrl) yet, and ${internal.variable} is not set`
    }
    return {
      serverId: server.id,
      displayName: server.displayName ?? null,
      publicBases,
      keyVariable: key.variable,
      internalBase: internal.ok ? internal.base : null,
      endpoints: problem ? [] : internal.base ? [internal.base] : publicBases,
      problem,
    }
  })
}

/**
 * Call one of `target`'s endpoints with that server's key, resolved here so the key never sits
 * on an object that could be serialized.
 */
export function fetchTargetSessions(target, endpoint) {
  if (!target.endpoints.includes(endpoint)) {
    throw new Error(`${endpoint} is not an endpoint of ${target.serverId}`)
  }
  const key = resolveTranscoderKey(target.serverId)
  if (!key.ok) return Promise.resolve({ ok: false, base: endpoint, reason: 'no-key', detail: key.reason })
  return fetchAdminSessions(endpoint, key.key, key.variable)
}

function failure(base, reason, detail, extra = {}) {
  if (lastLogged.get(base) !== reason) {
    lastLogged.set(base, reason)
    log.warn({ base, reason, detail }, 'transcoder admin call failed')
  }
  return { ok: false, base, reason, detail, ...extra }
}

async function callAdminSessions(base, key, keyVariable) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  const started = Date.now()
  try {
    const res = await fetch(`${base}/admin/sessions`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: 'no-store',
      signal: controller.signal,
    })
    const body = await res.json().catch(() => null)
    const ms = Date.now() - started
    if (res.ok) {
      if (body?.schema !== 1) {
        return failure(base, 'unexpected-schema', `${base}/admin/sessions answered schema ${body?.schema ?? 'none'}; this app reads schema 1`)
      }
      if (lastLogged.has(base)) {
        lastLogged.delete(base)
        log.info({ base }, 'transcoder admin calls recovered')
      }
      return { ok: true, base, ms, data: body }
    }
    if (res.status === 401) {
      return failure(base, 'unauthorized', `the transcoder at ${base} refused the key in ${keyVariable}; set the same value in its WEBHOOK_ID_n`, { status: 401 })
    }
    if (res.status === 503) {
      return failure(base, body?.reason ?? 'admin-disabled', body?.error ?? `the transcoder at ${base} has no admin key configured`, { status: 503 })
    }
    if (res.status === 404) {
      return failure(base, 'no-admin-api', `${base} has no /admin/sessions: the transcoder predates the admin API`, { status: 404 })
    }
    return failure(base, `http-${res.status}`, `${base}/admin/sessions answered ${res.status}`, { status: res.status })
  } catch (e) {
    if (e?.name === 'AbortError') {
      return failure(base, 'timeout', `${base} did not answer within ${FETCH_TIMEOUT_MS / 1000} s`)
    }
    return failure(base, 'unreachable', `${base}: ${e?.message ?? e}`)
  } finally {
    clearTimeout(timer)
  }
}

/** `GET {base}/admin/sessions`, shared by concurrent callers for FETCH_TTL_MS. */
function fetchAdminSessions(base, key, keyVariable) {
  // Per base AND key variable: two servers pointed at one transcoder with different keys must
  // not read each other's cached answer (or refusal).
  const cacheKey = `${keyVariable} ${base}`
  const hit = fetches.get(cacheKey)
  if (hit && Date.now() - hit.at < FETCH_TTL_MS) return hit.promise
  const promise = callAdminSessions(base, key, keyVariable)
  fetches.set(cacheKey, { at: Date.now(), promise })
  return promise
}

/**
 * The live encode queue of the transcoder at `origin` (a `jitUrl` origin), for the serve-time
 * queue ceiling. `{ ok: true, queued }`, or `{ ok: false, detail }` saying why it is unknown, in
 * which case the caller must not serve through it.
 */
export async function getTranscoderLoadForOrigin(origin) {
  let targets
  try {
    targets = await getTranscoderTargets()
  } catch (e) {
    return { ok: false, detail: `could not read which server owns ${origin}: ${e?.message ?? e}` }
  }
  const target = targets.find((t) => t.publicBases.some((b) => new URL(b).origin === origin))
  if (!target) return { ok: false, detail: `no file server's titles use the transcoder at ${origin}` }
  if (target.problem) return { ok: false, detail: target.problem }
  const endpoint = target.internalBase ?? target.publicBases.find((b) => new URL(b).origin === origin)
  const res = await fetchTargetSessions(target, endpoint)
  if (!res.ok) return { ok: false, detail: res.detail }
  const queued = res.data?.load?.queued
  if (!Number.isInteger(queued) || queued < 0) {
    return { ok: false, detail: `${endpoint}/admin/sessions carried no load.queued` }
  }
  return { ok: true, queued }
}

/** Test hook. */
export function _resetTranscoderAdminForTests() {
  discovery = { at: 0, promise: null }
  fetches.clear()
  lastLogged.clear()
}
