/**
 * Pure helpers behind every web watch-progress surface (rail card bar, popup
 * row, details-page panel, sticky title bar). No React here so they can be
 * unit tested.
 *
 * Inputs are what the server now emits on every playable item: a
 * `watchHistory` object with `playbackTime` (seconds), `progressPercent` and
 * `completed` (see watchHistory/progress.js), plus the catalog `duration` in
 * milliseconds. Older payloads without the two computed fields fall back to
 * the same 95% rule locally.
 */

import { WATCH_COMPLETION_PERCENT } from '@src/utils/watchHistory/progress'

const pad = (n) => String(n).padStart(2, '0')

/**
 * "H:MM:SS" for a number of seconds, the way a player's clock reads it:
 * hours unpadded and only when there are any, so a position and a runtime
 * line up as "1:40:13 / 3:02:29" and a short film reads "42:10".
 *
 * @param {number} seconds
 * @returns {string}
 */
export function formatClock(seconds) {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/**
 * How much is left, in words: "1h 22m left", "22m left", "Under a minute left".
 *
 * @param {number} seconds
 * @returns {string}
 */
export function formatRemaining(seconds) {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 0
  if (total < 60) return 'Under a minute left'
  const h = Math.floor(total / 3600)
  const m = Math.round((total % 3600) / 60)
  if (h > 0) return m > 0 ? `${h}h ${m}m left` : `${h}h left`
  return `${m}m left`
}

/**
 * A runtime in words: "3h 2m", "58m".
 *
 * @param {number|null} durationMs
 * @returns {string|null}
 */
export function formatRuntime(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null
  const totalMinutes = Math.round(durationMs / 60000)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  return `${m}m`
}

/**
 * The runtime in milliseconds from whatever the payload carries.
 *
 * @param {{ duration?: number|string|null, metadata?: { runtime?: number|null }|null }|null|undefined} item
 * @returns {number|null}
 */
export function durationMsFrom(item) {
  if (!item) return null
  const raw = typeof item.duration === 'string' ? Number(item.duration) : item.duration
  if (Number.isFinite(raw) && raw > 0) return raw
  const minutes = item.metadata?.runtime
  if (Number.isFinite(minutes) && minutes > 0) return minutes * 60_000
  return null
}

/**
 * One progress reading, however the position arrived.
 *
 * @param {Object} options
 * @param {Object|null} [options.watchHistory] - server object (preferred)
 * @param {number|null} [options.playbackTime] - seconds, when known without the object
 * @param {number|null} [options.durationMs]
 * @returns {{ playbackTime: number, durationMs: number|null, progressPercent: number, completed: boolean, hasProgress: boolean, clock: string, remainingSeconds: number|null }}
 */
export function readProgress({ watchHistory = null, playbackTime = null, durationMs = null } = {}) {
  const position = Number.isFinite(watchHistory?.playbackTime)
    ? watchHistory.playbackTime
    : Number.isFinite(playbackTime)
      ? playbackTime
      : 0
  const runtime = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : null

  let progressPercent
  if (Number.isFinite(watchHistory?.progressPercent) && watchHistory.progressPercent > 0) {
    progressPercent = watchHistory.progressPercent
  } else if (position > 0 && runtime) {
    progressPercent = Math.max(0, Math.min(100, Math.round((position / (runtime / 1000)) * 1000) / 10))
  } else {
    progressPercent = 0
  }

  const completed =
    typeof watchHistory?.completed === 'boolean'
      ? watchHistory.completed
      : progressPercent >= WATCH_COMPLETION_PERCENT

  const clock = runtime ? `${formatClock(position)} / ${formatClock(runtime / 1000)}` : formatClock(position)
  const remainingSeconds = runtime ? Math.max(0, runtime / 1000 - position) : null

  return {
    playbackTime: position,
    durationMs: runtime,
    progressPercent,
    completed,
    hasProgress: position > 0 || progressPercent > 0,
    clock,
    remainingSeconds,
  }
}

/**
 * Whether a card's content can carry a resume position at all: movies and
 * specific episodes do; a show-level card has no single position (out of
 * scope by design).
 */
export function canShowProgress({ type, seasonNumber, episodeNumber }) {
  if (type === 'movie') return true
  if (type === 'tv') return seasonNumber != null && episodeNumber != null
  return false
}
