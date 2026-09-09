/**
 * Where playback begins on the web watch page — one resolution per mount.
 *
 * Pure helpers (no React) so the priority order is testable on its own:
 *
 *   1. an explicit `?start=` deep link, INCLUDING `?start=0` — a present zero
 *      is a request to restart, not an absent value (the next-episode card
 *      links with it, and a finished episode must not reopen in its credits)
 *   2. the server's watch history, which the page rendered with — unless
 *      this is a Next Activity RE-SHOW, when that value is frozen from the
 *      original render and the row may have moved on another device since
 *   3. this browser's localStorage, as written by the tracker every second
 *
 * On a re-show the fresh server row is fetched and compared with
 * localStorage by timestamp; the newer one wins. That is the difference
 * between "resumed where the TV left off" and "overwrote the TV's position
 * with a stale one from render time".
 */

import { getPlaybackStorageKey, readWithLegacyFallback } from '@src/utils/playbackStorageKey'

/**
 * @param {unknown} start - the raw `?start=` search param
 * @returns {number|null} an explicit start in seconds (0 allowed), or null
 */
export function parseExplicitStart(start) {
  if (start === null || start === undefined || start === '' || start === false) return null
  const n = Number(start)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/**
 * The tracker's localStorage entry for this title, if any.
 *
 * @returns {{ playbackTime: number, lastUpdated: number|null }|null}
 */
export function readLocalResume({ mediaId, videoURL }) {
  if (typeof window === 'undefined') return null
  try {
    const raw = readWithLegacyFallback(getPlaybackStorageKey({ mediaId, videoURL }), videoURL)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const playbackTime = parseFloat(parsed?.playbackTime)
    if (!Number.isFinite(playbackTime) || playbackTime <= 0) return null
    const lastUpdated = parsed?.lastUpdated ? new Date(parsed.lastUpdated).getTime() : null
    return { playbackTime, lastUpdated: Number.isFinite(lastUpdated) ? lastUpdated : null }
  } catch {
    return null
  }
}

/**
 * Pick between the server's row and this browser's localStorage entry.
 * Newer timestamp wins; a side with no timestamp loses to one that has one;
 * a completed server row means "start over".
 *
 * @param {{ playbackTime: number, lastUpdated: number|null, completed?: boolean }|null} server
 * @param {{ playbackTime: number, lastUpdated: number|null }|null} local
 * @returns {number} seconds
 */
export function pickResume(server, local) {
  const serverTime = server && Number.isFinite(server.playbackTime) && server.playbackTime > 0 ? server.playbackTime : 0
  const localTime = local && Number.isFinite(local.playbackTime) && local.playbackTime > 0 ? local.playbackTime : 0
  if (server?.completed) return 0
  if (!serverTime) return localTime
  if (!localTime) return serverTime
  const serverAt = server.lastUpdated ?? null
  const localAt = local.lastUpdated ?? null
  if (serverAt !== null && localAt !== null) return localAt > serverAt ? localTime : serverTime
  if (serverAt !== null) return serverTime
  if (localAt !== null) return localTime
  return serverTime
}

/**
 * Resolve the position for a mount that does NOT need a network round trip:
 * the first render (server value is fresh) or an explicit deep link.
 *
 * @returns {number|null} seconds, 0 for an explicit restart, null when unknown
 */
export function resolveInitialResume({ explicitStart, savedPlaybackTime, mediaId, videoURL }) {
  if (explicitStart !== null && explicitStart !== undefined) return explicitStart
  if (Number.isFinite(savedPlaybackTime) && savedPlaybackTime > 0) return savedPlaybackTime
  const local = readLocalResume({ mediaId, videoURL })
  return local ? local.playbackTime : null
}

/**
 * Fetch the current server row for a title. Best effort: any failure or a
 * slow answer resolves to null and the caller falls back to what it has.
 *
 * @returns {Promise<{ playbackTime: number, lastUpdated: number|null, completed?: boolean }|null>}
 */
export async function fetchServerResume(videoURL, { timeoutMs = 1500, signal } = {}) {
  if (typeof fetch === 'undefined' || !videoURL) return null
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null
  const onOuterAbort = () => controller?.abort()
  signal?.addEventListener?.('abort', onOuterAbort)
  try {
    const res = await fetch(`/api/authenticated/sync/playback?videoId=${encodeURIComponent(videoURL)}`, {
      cache: 'no-store',
      signal: controller?.signal,
    })
    if (!res.ok) return null
    const body = await res.json()
    if (!body?.found) return { playbackTime: 0, lastUpdated: null, completed: false }
    const lastUpdated = body.lastUpdated ? new Date(body.lastUpdated).getTime() : null
    return {
      playbackTime: Number(body.playbackTime) || 0,
      lastUpdated: Number.isFinite(lastUpdated) ? lastUpdated : null,
      completed: body.completed === true,
    }
  } catch {
    return null
  } finally {
    if (timer) clearTimeout(timer)
    signal?.removeEventListener?.('abort', onOuterAbort)
  }
}
