/**
 * Thumbnail (sprite VTT) delivery status — the shared truth between the
 * <track> retry logic in PlayerMedia and the scrub preview in ScrubPreview.
 *
 * A <track> element's `error` event carries no status, so on its own the
 * client cannot tell "the backend is still generating this" from "this
 * title will never have previews" from "the backend is down". The retry
 * logic probes the same URL with a short fetch and classifies the answer:
 *
 *   ready       200 — the VTT exists now (the earlier failure was transient)
 *   generating  202 (+ Retry-After), or a probe that hangs — the backend is
 *               building it right now; keep the spinner, wait as told
 *   gone        404 — no previews are possible for this title; stop asking
 *   failed      5xx / other — a real failure; say so, retry slowly
 *   network     the probe could not reach the proxy at all
 *   exhausted   retries used up without a VTT
 *
 * Pure helpers here (classification + schedule) so they are unit-testable;
 * the tiny external store below is what React subscribes to.
 */

/** @typedef {'idle'|'loading'|'ready'|'generating'|'gone'|'failed'|'network'|'exhausted'} ThumbnailState */

export const PROBE_TIMEOUT_MS = 8_000

// A hanging probe means the backend is generating on this very request
// (today it blocks the response until the VTT exists), so ask again soon.
const GENERATING_DEFAULT_MS = 5_000
const GENERATING_MAX_TOTAL_MS = 15 * 60_000
// A real failure is retried, but slowly and not for long: it is rarely
// transient, and the box should not spin for it.
const FAILED_DELAYS_MS = [15_000, 30_000, 60_000, 60_000, 60_000, 60_000, 60_000, 60_000]
const NETWORK_DELAYS_MS = [3_000, 6_000, 12_000, 24_000, 45_000, 60_000]

/**
 * Progress, when the backend reports it on a 202, is normalised to
 * `{progress: 0..1|null, step, totalSteps, message}` so the preview can show
 * "Preparing previews · 42%" instead of an open-ended spinner.
 *
 * @param {{status?: number|null, timedOut?: boolean, networkError?: boolean, retryAfter?: string|null, body?: object|null}} probe
 * @returns {{state: ThumbnailState, retryAfterMs: number|null, progress: number|null, step: number|null, totalSteps: number|null, message: string|null}}
 */
export function classifyProbe({ status = null, timedOut = false, networkError = false, retryAfter = null, body = null }) {
  const none = { progress: null, step: null, totalSteps: null, message: null }
  if (networkError) return { state: 'network', retryAfterMs: null, ...none }
  if (timedOut) return { state: 'generating', retryAfterMs: GENERATING_DEFAULT_MS, ...none }
  if (status === 200) return { state: 'ready', retryAfterMs: 0, ...none }
  if (status === 202) {
    const s = Number.parseInt(retryAfter ?? '', 10)
    const p = Number(body?.progress)
    const step = Number(body?.step)
    const total = Number(body?.totalSteps)
    return {
      state: 'generating',
      retryAfterMs: Number.isFinite(s) && s > 0 ? s * 1000 : GENERATING_DEFAULT_MS,
      progress: Number.isFinite(p) && p >= 0 && p <= 1 ? p : null,
      step: Number.isInteger(step) && step > 0 ? step : null,
      totalSteps: Number.isInteger(total) && total > 0 ? total : null,
      message: typeof body?.message === 'string' && body.message.length <= 120 ? body.message : null,
    }
  }
  if (status === 404 || status === 410) return { state: 'gone', retryAfterMs: null, ...none }
  // The backend holds a failure for a window and says how long (Retry-After
  // on 5xx); probing inside that window only reads the same answer back.
  const hold = Number.parseInt(retryAfter ?? '', 10)
  return { state: 'failed', retryAfterMs: Number.isFinite(hold) && hold > 0 ? hold * 1000 : null, ...none }
}

/**
 * Overall progress for display, from the backend's per-step fraction. Step 2
 * (frame extraction) is almost all of the work; analysis and the final
 * encode+VTT are short. Weighted so the bar moves the way the wait feels.
 * @returns {number|null} 0..1
 */
const STEP_WEIGHTS = [0.05, 0.85, 0.1]
export function overallProgress(step, totalSteps, progress) {
  if (!Number.isInteger(step) || step < 1 || !Number.isInteger(totalSteps) || totalSteps < 1) return null
  const p = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0
  const weights = totalSteps === STEP_WEIGHTS.length ? STEP_WEIGHTS : Array(totalSteps).fill(1 / totalSteps)
  let done = 0
  for (let i = 0; i < Math.min(step - 1, weights.length); i++) done += weights[i]
  const current = weights[Math.min(step, weights.length) - 1] ?? 0
  return Math.max(0, Math.min(1, done + current * p))
}

/**
 * When to try the <track> again, or null to stop.
 * @param {ThumbnailState} state
 * @param {number} attempts - retries already made in this state
 * @param {number} sinceMs - how long we have been in this state
 * @param {number|null} retryAfterMs - from classifyProbe
 * @returns {number|null}
 */
export function nextRetryDelay(state, attempts, sinceMs, retryAfterMs) {
  switch (state) {
    case 'ready':
      return 0
    case 'generating':
      return sinceMs >= GENERATING_MAX_TOTAL_MS ? null : (retryAfterMs ?? GENERATING_DEFAULT_MS)
    case 'failed':
      if (attempts >= FAILED_DELAYS_MS.length) return null
      return Math.max(FAILED_DELAYS_MS[attempts], retryAfterMs ?? 0)
    case 'network':
      return attempts < NETWORK_DELAYS_MS.length ? NETWORK_DELAYS_MS[attempts] : null
    default:
      return null
  }
}

/**
 * Probe the VTT URL and classify. Aborting a hung probe is safe: the Next
 * proxy keeps its upstream request open, so the backend's generation is not
 * interrupted by us hanging up.
 * @param {string} url
 * @param {typeof fetch} [fetchImpl]
 */
export async function probeThumbnailUrl(url, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(url, {
      credentials: 'include',
      cache: 'no-store',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    let body = null
    if (res.status === 202) {
      try {
        body = await res.json()
      } catch {
        body = null
      }
    }
    return classifyProbe({ status: res.status, retryAfter: res.headers.get('retry-after'), body })
  } catch (e) {
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return classifyProbe({ timedOut: true })
    return classifyProbe({ networkError: true })
  }
}

// ---- the store ------------------------------------------------------------

const EMPTY = Object.freeze({ state: 'idle', since: 0, attempts: 0, progress: null, step: null, totalSteps: null, message: null })
let current = EMPTY
const listeners = new Set()

export function getThumbnailStatus() {
  return current
}

export function setThumbnailStatus(next) {
  const merged = { ...current, ...next }
  if (merged.state !== current.state) merged.since = Date.now()
  current = Object.freeze(merged)
  for (const l of listeners) l()
}

export function resetThumbnailStatus() {
  current = EMPTY
  for (const l of listeners) l()
}

export function subscribeThumbnailStatus(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// Dev hook: drive the preview box's states from the console to check copy
// and layout without waiting on a real generation.
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  window.__thumbnailStatus = { get: getThumbnailStatus, set: setThumbnailStatus, reset: resetThumbnailStatus }
}
