/**
 * The one shape of a live viewing session, and the one rule for ranking
 * several of them. Pure: no database, so cards, widgets and tests share it.
 * See plans/media-activity-presence.md.
 */

import { detectBrowserType, getDeviceTypeLabel } from '@src/utils/deviceDetection'
import { UAParser } from 'ua-parser-js'
import { PRESENCE_STATES } from './contract'

const STATE_RANK = { playing: 0, paused: 1 }

function iso(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function time(value) {
  const t = value ? new Date(value).getTime() : NaN
  return Number.isFinite(t) ? t : 0
}

function wholeNumber(value) {
  return Number.isInteger(value) ? value : null
}

/**
 * "Chrome · Desktop" on "Windows" from a stored deviceInfo, the wording every
 * presence surface uses.
 *
 * @param {{ type?: string, userAgent?: string } | null | undefined} deviceInfo
 * @returns {{ type: string|null, label: string, platform: string, userAgent: string|null }}
 */
export function describeDevice(deviceInfo) {
  const type = deviceInfo?.type ?? null
  const typeLabel = getDeviceTypeLabel(type)
  const userAgent = deviceInfo?.userAgent || ''

  let browser = ''
  let os = ''
  if (userAgent) {
    const detected = detectBrowserType(userAgent)
    if (detected && detected !== 'unknown') {
      browser = detected.charAt(0).toUpperCase() + detected.slice(1)
    }
    try {
      os = new UAParser(userAgent).getOS()?.name || ''
    } catch {
      os = ''
    }
  }

  const hasType = typeLabel && typeLabel !== 'Unknown'
  const label = browser
    ? (hasType ? `${browser} · ${typeLabel}` : browser)
    : (hasType ? typeLabel : (type || 'Unknown'))

  return {
    type,
    label,
    platform: os || (hasType ? typeLabel : (type || '')),
    userAgent: userAgent || null,
  }
}

/**
 * A PlaybackPresence row as a LiveSession. Returns null for a row that does
 * not carry a known state: such a row was not written under the contract and
 * says nothing reliable about whether anyone is watching.
 *
 * @param {Object} row
 * @returns {Object | null}
 */
export function toLiveSession(row) {
  if (!row || !PRESENCE_STATES.includes(row.state)) return null
  return {
    id: String(row._id),
    sessionId: row.sessionId,
    userId: String(row.userId),
    videoId: row.videoId ?? null,
    normalizedVideoId: row.normalizedVideoId ?? null,
    mediaId: row.mediaId ?? null,
    mediaType: row.mediaType ?? null,
    showId: row.showId ? String(row.showId) : null,
    seasonNumber: wholeNumber(row.seasonNumber),
    episodeNumber: wholeNumber(row.episodeNumber),
    state: row.state,
    position: Number.isFinite(row.playbackTime) ? row.playbackTime : null,
    positionAt: iso(row.positionAt),
    device: describeDevice(row.deviceInfo),
    ipAddress: row.ipAddress ?? null,
    localIp: row.localIp ?? null,
    lastHeartbeat: iso(row.lastHeartbeat),
    staleAfter: iso(row.staleAfter),
  }
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
