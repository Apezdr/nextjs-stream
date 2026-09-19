/**
 * JIT transcoder liveness/capacity check for serve-time delivery decisions.
 *
 * The transcoder's GET /health returns
 *   { status, active_encoders, audio_encoders, queued, active_sessions, version }
 * (jit-transcoder src/server/routes/health.rs). "Healthy" here means: it
 * answered 200 within the timeout, and — when a queue ceiling is configured —
 * its encode queue is not backed up.
 *
 * What this check deliberately CANNOT see: the one-time keyframe scan that a
 * first master request for a large direct-play-eligible source blocks on
 * (minutes for a huge remux). That is a per-title warmup, not service
 * unhealth — which is exactly why serve-time code must never put a
 * synchronous preflight in front of a manifest URL.
 *
 * Results are cached module-level with asymmetric TTLs (healthy sticks
 * longer than unhealthy) so a ~1Hz heartbeat/serve rate never turns into a
 * health-probe flood, while recovery after an outage is noticed quickly.
 */

import { getCachedJitServeSettings } from './serveSettings'
import { createLogger } from '@src/lib/logger'

const log = createLogger('JIT.Health')

const HEALTHY_TTL_MS = 30_000
const UNHEALTHY_TTL_MS = 10_000
const PROBE_TIMEOUT_MS = 1_500

/** origin -> { healthy: boolean, expiresAt: number } */
const cache = new Map()

/**
 * origin -> what the LAST real probe saw. Serve decisions are fail-closed on
 * this probe, so when a title is served raw the only useful question is
 * "what did the probe actually see" — a timeout, a non-200, a full queue —
 * and how long it took against the 1.5 s budget.
 */
const lastProbe = new Map()

/** @returns {{at: number, ms: number, ok: boolean, status?: number, queued?: number, error?: string}|null} */
export function getLastHealthProbe(origin) {
  return lastProbe.get(origin) ?? null
}

/**
 * Max acceptable value of /health's `queued` before we shed to direct play.
 * Precedence: admin runtime override > JIT_SERVE_MAX_QUEUED env > null
 * (capacity arm disabled, liveness-only).
 */
async function maxQueued() {
  const settings = await getCachedJitServeSettings()
  if (settings && Number.isInteger(settings.maxQueued) && settings.maxQueued >= 0) {
    return settings.maxQueued
  }
  const raw = (process.env.JIT_SERVE_MAX_QUEUED || '').trim()
  if (!raw) return null
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/**
 * Whether the transcoder at `origin` should receive traffic right now.
 * Fail-closed: any error, timeout, or non-200 → false (callers fall back to
 * the direct URL — degraded playback beats no playback, and no playback
 * beats a hung player).
 *
 * @param {string} origin - e.g. 'https://transcoder.example.com'
 * @returns {Promise<boolean>}
 */
export async function isTranscoderHealthy(origin) {
  if (typeof origin !== 'string' || !origin) return false

  const cached = cache.get(origin)
  if (cached && cached.expiresAt > Date.now()) return cached.healthy

  let healthy = false
  const started = Date.now()
  const probe = { at: started, ms: 0, ok: false }
  // Only OUR timer may turn an abort into a verdict. Caught live: Next's
  // prerender pass aborts dynamic fetches (the same mechanism behind the
  // "headers() rejects when the prerender is complete" build noise), the
  // AbortError arrived after 76 ms, and the fail-closed branch below
  // negative-cached "unhealthy" for 10 s — which the real dynamic render
  // then read back and served the title raw. The play page prerenders; the
  // media API route does not, which is why only the page ever went raw.
  let timedOut = false
  let foreignAbort = false
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, PROBE_TIMEOUT_MS)
    try {
      const res = await fetch(`${origin}/health`, {
        signal: controller.signal,
        cache: 'no-store',
      })
      probe.status = res.status
      if (res.ok) {
        const ceiling = await maxQueued()
        if (ceiling === null) {
          healthy = true
        } else {
          const body = await res.json().catch(() => null)
          probe.queued = body ? Number(body.queued ?? 0) : undefined
          healthy = body ? Number(body.queued ?? 0) <= ceiling : true
        }
      }
    } finally {
      clearTimeout(timer)
    }
  } catch (e) {
    healthy = false
    if (e?.name === 'AbortError') {
      foreignAbort = !timedOut
      probe.error = timedOut ? `timeout>${PROBE_TIMEOUT_MS}ms` : 'aborted-by-environment'
    } else {
      probe.error = String(e?.message ?? e)
    }
  }
  probe.ms = Date.now() - started
  probe.ok = healthy
  lastProbe.set(origin, probe)

  if (foreignAbort) {
    // Not a verdict about the transcoder. Do not cache it: the render that
    // was aborted is discarded anyway, and the next real probe must run.
    // Prefer any still-valid prior verdict so a warm process never regresses.
    const prior = cache.get(origin)
    if (prior && prior.expiresAt > Date.now()) return prior.healthy
    return false
  }

  if (!healthy) {
    // This is the moment a title silently becomes a raw file for the next
    // UNHEALTHY_TTL_MS. Loud on purpose.
    log.warn({ origin, ...probe }, 'transcoder health probe failed — serving raw for 10s')
  }

  cache.set(origin, {
    healthy,
    expiresAt: Date.now() + (healthy ? HEALTHY_TTL_MS : UNHEALTHY_TTL_MS),
  })
  return healthy
}

/** Drop cached liveness/capacity decisions after the queue policy changes. */
export function invalidateTranscoderHealthCache() {
  cache.clear()
}

/** Test hook — clears the module-level cache. */
export function _resetHealthCacheForTests() {
  invalidateTranscoderHealthCache()
}
