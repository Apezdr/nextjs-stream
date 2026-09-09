/**
 * One definition of "how far through" and "finished" for every surface on
 * every client.
 *
 * Before this the same row read three ways: the server's `isWatched` was
 * true for any row with a heartbeat, the TV app's bars turned green at 95%,
 * the web's Restart overlay appeared past 90%, and the mobile app had no
 * threshold at all. The server has both the position and the catalog
 * duration at join time, so it computes the two fields and the clients
 * render them.
 */

/** Percent of the runtime at which a title counts as completed. */
export const WATCH_COMPLETION_PERCENT = 95

/**
 * The runtime of a catalog item in milliseconds, or null when unknown.
 * Movies and episodes carry `duration` in ms from the media-processor; a
 * recently-watched TV record carries it on the nested episode; TMDB's
 * `metadata.runtime` (minutes) is the last resort.
 *
 * @param {Object|null|undefined} item
 * @returns {number|null}
 */
export function durationMsForItem(item) {
  if (!item) return null
  const candidates = [item.duration, item.episode?.duration, item.length]
  for (const value of candidates) {
    const n = typeof value === 'string' ? Number(value) : value
    if (Number.isFinite(n) && n > 0) return n
  }
  const runtimeMinutes = item.metadata?.runtime
  if (Number.isFinite(runtimeMinutes) && runtimeMinutes > 0) return runtimeMinutes * 60_000
  return null
}

/**
 * @param {number} playbackTime - seconds
 * @param {number|null} durationMs
 * @returns {{ progressPercent: number, completed: boolean }}
 */
export function computeWatchProgress(playbackTime, durationMs) {
  const seconds = Number.isFinite(playbackTime) && playbackTime > 0 ? playbackTime : 0
  if (!seconds || !Number.isFinite(durationMs) || durationMs <= 0) {
    return { progressPercent: 0, completed: false }
  }
  const raw = (seconds / (durationMs / 1000)) * 100
  const progressPercent = Math.max(0, Math.min(100, Math.round(raw * 10) / 10))
  return { progressPercent, completed: progressPercent >= WATCH_COMPLETION_PERCENT }
}
