/**
 * The presence contract every client meets, and the expiry the server
 * derives from it. See plans/media-activity-presence.md.
 *
 * A client checks in at least this often in each state; it may check in more
 * often, never less. The server marks each row live for twice the interval,
 * so a single missed check-in does not drop a session that is still running.
 *
 * Readers never compute freshness: they compare a row's `staleAfter` with the
 * clock. That keeps the answer the same for every reader and every client.
 */

export const PRESENCE_STATES = Object.freeze(['playing', 'paused'])

export const MAX_CHECK_IN_INTERVAL_MS = Object.freeze({
  playing: 30_000,
  paused: 180_000,
})

/**
 * @param {boolean} isPaused
 * @returns {'playing' | 'paused'}
 */
export function presenceStateFor(isPaused) {
  return isPaused === true ? 'paused' : 'playing'
}

/**
 * When a row written now in `state` stops counting as live.
 *
 * @param {'playing' | 'paused'} state
 * @param {Date} now
 * @returns {Date}
 */
export function staleAfterFor(state, now) {
  const interval = MAX_CHECK_IN_INTERVAL_MS[state]
  if (!interval) throw new Error(`Unknown presence state: ${String(state)}`)
  return new Date(now.getTime() + 2 * interval)
}
