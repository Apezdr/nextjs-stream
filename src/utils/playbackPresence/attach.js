/**
 * Attach live presence to a user's recently-watched cards.
 *
 * One card per title, but a title can have several live sessions — paused on
 * the Shield, playing on the phone. Badge and device icon must then come from
 * the SAME session, or the card shows one device's pause state under another
 * device's icon. That is exactly what the dashboard used to do: the first
 * session found decided the badge while the icon came from the WatchHistory
 * row's last writer. The session with the newest heartbeat is the one the
 * viewer is actually using; the others are listed for the "N devices" note.
 */

function heartbeatTime(session) {
  const t = session?.lastHeartbeat ? new Date(session.lastHeartbeat).getTime() : 0
  return Number.isFinite(t) ? t : 0
}

/** The card-facing shape of one live session. */
export function describePresenceSession(session) {
  return {
    deviceType: session.deviceInfo?.type ?? null,
    userAgentTruncated: session.deviceInfo?.userAgent ?? null,
    isPaused: session.isPaused === true,
    lastHeartbeat: session.lastHeartbeat ?? null,
    playbackTime: Number.isFinite(session.playbackTime) ? session.playbackTime : null,
  }
}

/**
 * The live sessions for one card, newest heartbeat first. Matched by the
 * URL-hash identity, or by the durable mediaId when both sides carry one
 * (a session started on a since-replaced file still belongs to the card).
 */
export function sessionsForVideo(video, sessions) {
  if (!video || !Array.isArray(sessions) || sessions.length === 0) return []
  return sessions
    .filter(
      (session) =>
        (session.normalizedVideoId && session.normalizedVideoId === video.normalizedVideoId) ||
        (session.mediaId && video.mediaId && session.mediaId === video.mediaId)
    )
    .sort((a, b) => heartbeatTime(b) - heartbeatTime(a))
}

/**
 * @param {Array<Object>} videos - recently-watched cards for one user
 * @param {Array<Object>} sessions - that user's active PlaybackPresence docs
 * @returns {Array<Object>} the cards, with `watchingNow`, `isPaused`,
 *   `deviceInfo` and `activeDevices` set on the ones that have a live session
 */
export function attachPresenceToVideos(videos, sessions) {
  if (!Array.isArray(videos)) return videos
  return videos.map((video) => {
    const matches = sessionsForVideo(video, sessions)
    if (matches.length === 0) return video

    const primary = matches[0]
    return {
      ...video,
      watchingNow: true,
      isPaused: primary.isPaused === true,
      // Badge and icon from ONE session — the newest heartbeat.
      ...(primary.deviceInfo?.type && {
        deviceInfo: {
          deviceType: primary.deviceInfo.type,
          userAgentTruncated: primary.deviceInfo.userAgent,
          lastUpdated: primary.lastHeartbeat,
        },
      }),
      activeDevices: matches.map(describePresenceSession),
    }
  })
}
