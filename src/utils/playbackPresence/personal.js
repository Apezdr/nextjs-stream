/**
 * A user's own live sessions: what /api/authenticated/presence returns and
 * what /api/authenticated/media attaches as `watchingNow`. The same reader,
 * shape, ranking and title rule as every other surface (./live.js,
 * ./session.js); see plans/media-activity-presence.md, "A user's own
 * sessions".
 */

import { findLiveSessions } from './live'
import { sessionsOnShow, sessionsOnTitle } from './rules'

/**
 * A LiveSession as its own user sees it. The addresses and the raw user agent
 * stay on the admin surfaces: a "Playing on TV · 41:12" line needs neither, and
 * under "View as" this is what an admin reads as the user.
 *
 * @param {Object} session - a LiveSession
 * @returns {Object}
 */
export function toOwnSession(session) {
  const { ipAddress: _ip, localIp: _localIp, userId: _userId, device, ...rest } = session
  return {
    ...rest,
    device: { type: device?.type ?? null, label: device?.label ?? 'Unknown', platform: device?.platform ?? '' },
  }
}

/**
 * The signed-in user's live sessions, ranked. Takes the id from the caller's
 * auth result, never from a request parameter.
 *
 * @param {string} userId
 * @returns {Promise<Array<Object>>}
 */
export async function findOwnLiveSessions(userId) {
  if (!userId) return []
  return (await findLiveSessions({ userIds: [userId] })).map(toOwnSession)
}

/**
 * The sessions a /api/authenticated/media payload is about, read off the
 * payload's own fields (flatDatabaseUtils.getFlatRequestedMedia):
 *
 *  - a movie, or an episode (has `episodeNumber`): sessions on that title;
 *  - a season (has `seasonNumber`, no `episodeNumber`; `showId` is its show):
 *    sessions on any of the season's episodes;
 *  - a show (neither; its `_id` is the show): sessions on any of its episodes.
 *
 * Each session names its season and episode, so a show or season page can say
 * which one is playing.
 *
 * @param {Object} media
 * @param {Array<Object>} sessions - the user's own sessions
 * @returns {Array<Object>}
 */
export function watchingNowFor(media, sessions) {
  if (!media) return []
  if (media.type === 'movie' || Number.isInteger(media.episodeNumber)) {
    return sessionsOnTitle(sessions, media)
  }
  if (media.type !== 'tv') return []
  if (Number.isInteger(media.seasonNumber)) return sessionsOnShow(sessions, media.showId, media.seasonNumber)
  return sessionsOnShow(sessions, media._id ?? media.id)
}
