/**
 * The five things a playback write can mean. Clients report, the server
 * decides — and the first thing it decides is whether a body carries a
 * position worth storing at all.
 *
 * - `progress`  — the player is rendering this position right now (the 1 s
 *                 web throttle, the RN 30 s beat, the pause flip). Writes.
 * - `seek`      — a deliberate jump. Writes; reserved so a future guard can
 *                 tell a rewind from a stale beat.
 * - `final`     — the exit flush (pagehide, unmount, backgrounding). Writes,
 *                 and is paired with presence/end so it carries no sessionId.
 * - `keepalive` — a paused device saying "still here". Carries NO position:
 *                 a paused device must never drag the row back over progress
 *                 made on another device meanwhile. Refreshes presence only.
 * - `mark`      — the viewer's own statement ("mark watched"), not a player's
 *                 report. Writes the position it states, whatever it is: the
 *                 start threshold and the resume floor both exist to tell a
 *                 player starting up from a viewing, and no player is
 *                 involved. So it creates a row at any position and replaces
 *                 a stored one from under the floor. Nothing is playing, so
 *                 it carries no sessionId and touches no presence.
 *
 * Absent means `progress`, which is exactly what every pre-`kind` client
 * has always meant — except the paused keep-alive pings of those clients,
 * which the route reclassifies by comparing against the session's presence
 * row (see `isRepeatPausedPing`).
 */
export const PLAYBACK_WRITE_KINDS = Object.freeze(['progress', 'keepalive', 'seek', 'final', 'mark'])

export const DEFAULT_PLAYBACK_WRITE_KIND = 'progress'

/**
 * @param {unknown} kind
 * @returns {string|null} the kind, or null when the value is not one we know
 */
export function normalizePlaybackKind(kind) {
  if (kind === undefined || kind === null || kind === '') return DEFAULT_PLAYBACK_WRITE_KIND
  return PLAYBACK_WRITE_KINDS.includes(kind) ? kind : null
}

/** Kinds that carry a position the durable WatchHistory row should store. */
export function kindWritesPosition(kind) {
  return kind !== 'keepalive'
}

/**
 * Kinds that state a position instead of reporting a player's: exempt from the
 * rules that guard against a player starting up (WATCH_START_THRESHOLD_S and
 * MIN_PERSISTED_POSITION_S in watchHistory/database.js), and never a session.
 */
export function kindStatesPosition(kind) {
  return kind === 'mark'
}
