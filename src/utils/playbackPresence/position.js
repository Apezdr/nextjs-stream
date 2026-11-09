/**
 * Where a live session is now. Its own module, with no imports, so a client
 * component (the media pages' "watching now" line) can tick a position
 * without bringing session.js's user-agent parsing into its bundle.
 * See plans/media-activity-presence.md.
 */

/**
 * Where the session is now, in seconds. A playing session has moved on since
 * its position was written; a paused one has not.
 *
 * @param {{ state?: string, position?: number|null, positionAt?: string|null } | null | undefined} session - a LiveSession
 * @param {number} [nowMs] - the server's clock, in ms; a client corrects its own clock by the response's `asOf`
 * @returns {number | null}
 */
export function livePosition(session, nowMs = Date.now()) {
  if (!Number.isFinite(session?.position)) return null
  if (session.state !== 'playing' || !session.positionAt) return session.position
  const at = new Date(session.positionAt).getTime()
  if (!Number.isFinite(at)) return session.position
  const elapsed = (nowMs - at) / 1000
  return elapsed > 0 ? session.position + elapsed : session.position
}
