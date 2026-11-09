/**
 * The one shape of a live viewing session (toLiveSession) and the device
 * wording every presence surface uses (describeDevice). Pure: no database.
 * The rules for ranking and matching sessions are in ./rules.js, which
 * imports nothing, so client components can use them too.
 * See plans/media-activity-presence.md.
 */

import { detectBrowserType, getDeviceTypeLabel } from '@src/utils/deviceDetection'
import { UAParser } from 'ua-parser-js'
import { PRESENCE_STATES } from './contract'

function iso(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
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
