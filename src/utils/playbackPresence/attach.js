/**
 * Attach live sessions to a user's recently-watched cards.
 *
 * One card per title, but a title can have several live sessions — paused on
 * the Shield, playing on the phone. The badge and the device icon must come
 * from the SAME session, the first by rankSessions (playing before paused,
 * then the newest heartbeat); the others are listed for the "N devices" note.
 */

import { rankSessions } from './session'

/**
 * Whether a session is on this card's title: by the durable mediaId when both
 * carry one (a session started on a since-replaced file still belongs to the
 * card), by the URL-hash identity only when one of them has no mediaId yet.
 */
function isSameTitle(video, session) {
  if (video.mediaId && session.mediaId) return video.mediaId === session.mediaId
  return Boolean(video.normalizedVideoId) && video.normalizedVideoId === session.normalizedVideoId
}

/**
 * The live sessions for one card, ranked.
 *
 * @param {Object} video - a recently-watched card
 * @param {Array<Object>} sessions - LiveSessions (playbackPresence/live.js)
 * @returns {Array<Object>}
 */
export function sessionsForVideo(video, sessions) {
  if (!video || !Array.isArray(sessions) || sessions.length === 0) return []
  return rankSessions(sessions.filter((session) => isSameTitle(video, session)))
}

/**
 * @param {Array<Object>} videos - recently-watched cards for one user
 * @param {Array<Object>} sessions - that user's LiveSessions
 * @returns {Array<Object>} the cards; one with a live session gains
 *   `liveSessions` (ranked) and the first session's device as its `deviceInfo`
 */
export function attachPresenceToVideos(videos, sessions) {
  if (!Array.isArray(videos)) return videos
  return videos.map((video) => {
    const liveSessions = sessionsForVideo(video, sessions)
    if (liveSessions.length === 0) return video

    const primary = liveSessions[0]
    return {
      ...video,
      liveSessions,
      // Badge and icon from ONE session.
      ...(primary.device.type && {
        deviceInfo: {
          deviceType: primary.device.type,
          userAgentTruncated: primary.device.userAgent,
          lastUpdated: primary.lastHeartbeat,
        },
      }),
    }
  })
}
