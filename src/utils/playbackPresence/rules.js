/**
 * The rules every presence surface applies to live sessions: how several
 * rank, whether one is on a title or a show, and where it is now. They import
 * nothing, so the server's readers and the web's client components (the
 * media pages' line, the cards' badge) apply the same rules.
 * See plans/media-activity-presence.md.
 */

const STATE_RANK = { playing: 0, paused: 1 }

function time(value) {
  const t = value ? new Date(value).getTime() : NaN
  return Number.isFinite(t) ? t : 0
}

/**
 * Playing before paused; within a state, the newest heartbeat first.
 *
 * Newest-heartbeat alone is not enough: a paused device's keep-alive is a
 * heartbeat too, so it would win every few minutes over a device that is
 * actually playing.
 *
 * @param {Array<Object>} sessions - LiveSessions
 * @returns {Array<Object>} a new, ranked array
 */
export function rankSessions(sessions) {
  return [...sessions].sort(
    (a, b) =>
      (STATE_RANK[a.state] - STATE_RANK[b.state]) ||
      (time(b.lastHeartbeat) - time(a.lastHeartbeat))
  )
}

/**
 * Whether a session is on this title: by the durable mediaId when both carry
 * one (a session started on a since-replaced file is still on the title), by
 * the URL-hash identity only when one of them has no mediaId yet. Two
 * different mediaIds are two titles, whatever the hash says.
 *
 * @param {Object} session - a LiveSession
 * @param {{ mediaId?: string|null, normalizedVideoId?: string|null }} title -
 *   a movie or an episode
 * @returns {boolean}
 */
export function isOnTitle(session, title) {
  if (!session || !title) return false
  if (title.mediaId && session.mediaId) return title.mediaId === session.mediaId
  return Boolean(title.normalizedVideoId) && title.normalizedVideoId === session.normalizedVideoId
}

/**
 * The sessions on one movie or episode, ranked.
 *
 * @param {Array<Object>} sessions - LiveSessions
 * @param {{ mediaId?: string|null, normalizedVideoId?: string|null }} title
 * @returns {Array<Object>}
 */
export function sessionsOnTitle(sessions, title) {
  if (!Array.isArray(sessions) || sessions.length === 0) return []
  return rankSessions(sessions.filter((session) => isOnTitle(session, title)))
}

/**
 * The sessions on any episode of a show, or of one of its seasons, ranked.
 * The show and the season come from the catalog at write time
 * (resolveMediaIdForNid), so a session the catalog could not place is on no
 * show.
 *
 * @param {Array<Object>} sessions - LiveSessions
 * @param {string} showId - the show's catalog id (FlatTVShows _id)
 * @param {number|null} [seasonNumber]
 * @returns {Array<Object>}
 */
export function sessionsOnShow(sessions, showId, seasonNumber = null) {
  if (!Array.isArray(sessions) || sessions.length === 0 || !showId) return []
  const show = String(showId)
  return rankSessions(
    sessions.filter(
      (session) =>
        session.showId === show &&
        (seasonNumber === null || session.seasonNumber === seasonNumber)
    )
  )
}

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
