/**
 * The words of the media pages' "watching now" line, pure so they can be
 * tested and so the TV app's hand-off can quote them:
 *
 *   Playing on TV · 41:12                    a movie or an episode page
 *   Paused on Chrome · Desktop · 12:03
 *   Playing S2 · E7 on TV · 41:12            a show page names the episode
 *   Playing Episode 7 on a Cast device       a season page names it by number
 *
 * The episode noun is the one the primary button already uses (nextUpNoun):
 * "S2 · E7", "Specials · E3", "Episode 7". See plans/media-activity-presence.md.
 */

import { formatClock } from '@components/WatchProgress/progress'
import { tvHrefs } from '@src/utils/media/tvFacts'
import { livePosition } from '@src/utils/playbackPresence/position'

/** How many devices the line lists; more than this is "and N more". */
export const MAX_LISTED_SESSIONS = 3

/**
 * The device as the line names it: the shared LiveSession label ("TV",
 * "Chrome · Desktop"), except where that label reads badly after "on".
 *
 * @param {{ type?: string|null, label?: string|null } | null | undefined} device
 * @returns {string}
 */
export function deviceName(device) {
  if (device?.type === 'cast') return 'a Cast device'
  const label = typeof device?.label === 'string' ? device.label.trim() : ''
  return label && label !== 'Unknown' ? label : 'another device'
}

/**
 * The episode a session is on, as a show or season page names it, or null
 * when the page is about one title (or the catalog could not place it).
 *
 * @param {{ seasonNumber?: number|null, episodeNumber?: number|null }} session
 * @param {'title'|'show'|'season'} scope
 * @returns {string|null}
 */
export function episodeNoun(session, scope) {
  const { seasonNumber, episodeNumber } = session || {}
  if (scope === 'title' || !Number.isInteger(episodeNumber)) return null
  if (scope === 'season') return `Episode ${episodeNumber}`
  if (!Number.isInteger(seasonNumber)) return null
  return seasonNumber === 0 ? `Specials · E${episodeNumber}` : `S${seasonNumber} · E${episodeNumber}`
}

/**
 * One session as the line's parts. The caller renders them; `episodeHref`
 * makes the episode noun a link.
 *
 * @param {Object} session - a session from /api/authenticated/presence
 * @param {Object} options
 * @param {'title'|'show'|'season'} options.scope
 * @param {number} options.serverNowMs - the server's clock now (the response's asOf, moved on by the time since)
 * @param {{ originalTitle?: string|null, showTitle?: string|null } | null} [options.show] - the show's route key, for the episode link
 * @returns {{ key: string, playing: boolean, verb: string, episode: { label: string, href: string|null } | null, device: string, clock: string|null }}
 */
export function sessionLineParts(session, { scope, serverNowMs, show = null }) {
  const playing = session.state === 'playing'
  const noun = episodeNoun(session, scope)
  const position = livePosition(session, serverNowMs)
  const href =
    noun && show
      ? tvHrefs({
          originalTitle: show.originalTitle,
          showTitle: show.showTitle,
          seasonNumber: session.seasonNumber,
          episodeNumber: session.episodeNumber,
        }).episode
      : null
  return {
    key: session.id || session.sessionId,
    playing,
    verb: playing ? 'Playing' : 'Paused',
    episode: noun ? { label: noun, href } : null,
    device: deviceName(session.device),
    clock: Number.isFinite(position) && position > 0 ? formatClock(position) : null,
  }
}

