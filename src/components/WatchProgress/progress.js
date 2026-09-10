/**
 * Pure helpers behind every web watch-progress surface (rail card bar, popup
 * row, details-page panel). No React here so they can be unit tested.
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
 * "HH:MM:SS" for a number of seconds. Hours are always shown and zero-padded
 * so a position and a runtime line up as "01:12:34 / 02:01:54".
 *
 * @param {number} seconds
 * @returns {string}
 */
export function formatClock(seconds) {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${pad(h)}:${pad(m)}:${pad(s)}`
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
 * @returns {{ playbackTime: number, durationMs: number|null, progressPercent: number, completed: boolean, hasProgress: boolean, clock: string }}
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

  return {
    playbackTime: position,
    durationMs: runtime,
    progressPercent,
    completed,
    hasProgress: position > 0 || progressPercent > 0,
    clock,
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
