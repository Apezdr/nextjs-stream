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

const HEALTHY_TTL_MS = 30_000
const UNHEALTHY_TTL_MS = 10_000
const PROBE_TIMEOUT_MS = 1_500

/** origin -> { healthy: boolean, expiresAt: number } */
const cache = new Map()

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
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
    try {
      const res = await fetch(`${origin}/health`, {
        signal: controller.signal,
        cache: 'no-store',
      })
      if (res.ok) {
        const ceiling = await maxQueued()
        if (ceiling === null) {
          healthy = true
        } else {
          const body = await res.json().catch(() => null)
          healthy = body ? Number(body.queued ?? 0) <= ceiling : true
        }
      }
    } finally {
      clearTimeout(timer)
    }
  } catch (e) {
    healthy = false
  }

  cache.set(origin, {
    healthy,
    expiresAt: Date.now() + (healthy ? HEALTHY_TTL_MS : UNHEALTHY_TTL_MS),
  })
  return healthy
}

/** Test hook — clears the module-level cache. */
export function _resetHealthCacheForTests() {
  cache.clear()
}
