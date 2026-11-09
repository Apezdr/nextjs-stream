/**
 * Recent Activity cards with more than one live session on a title.
 *
 * Paused on the Shield, playing on the phone: the card used to show "Paused"
 * (from the first presence session found) under a phone icon (from the
 * WatchHistory row's last writer). Badge and icon now come from one session,
 * the first by rankSessions (playing before paused, then the newest
 * heartbeat), and the others are listed.
 */

const { attachPresenceToVideos, sessionsForVideo } = require('@src/utils/playbackPresence/attach')

const NID = 'a8a118c3a0e89d31'
const MID = 'mid:944495dc51b94a3a'
const SHIELD_UA = 'NextJSStreamTVApp/1.0.0 (android; tv; NVIDIA SHIELD Android TV)'
const PHONE_UA = 'NextJSStreamTVApp/1.0.0 (android; mobile; samsung SM-S918U)'

const video = {
  id: 'v1',
  normalizedVideoId: NID,
  mediaId: MID,
  // What the WatchHistory row's last writer left on the card
  deviceInfo: { deviceType: 'mobile', userAgentTruncated: PHONE_UA },
}

// LiveSessions, as playbackPresence/live.js returns them.
const shield = {
  id: 'row-shield',
  sessionId: 'shield',
  normalizedVideoId: NID,
  mediaId: MID,
  state: 'paused',
  position: 600,
  lastHeartbeat: '2026-09-09T10:00:00.000Z',
  device: { type: 'tv', label: 'TV', platform: 'Android', userAgent: SHIELD_UA },
}
const phone = {
  id: 'row-phone',
  sessionId: 'phone',
  normalizedVideoId: NID,
  mediaId: MID,
  state: 'playing',
  position: 1500,
  lastHeartbeat: '2026-09-09T10:02:30.000Z',
  device: { type: 'mobile', label: 'Mobile', platform: 'Android', userAgent: PHONE_UA },
}

describe('attachPresenceToVideos', () => {
  it('badge and icon come from the playing session, whichever was created first', () => {
    const [card] = attachPresenceToVideos([video], [shield, phone])

    expect(card.liveSessions.map((s) => s.sessionId)).toEqual(['phone', 'shield'])
    expect(card.liveSessions[0].state).toBe('playing')
    expect(card.deviceInfo.deviceType).toBe('mobile')
  })

  it('a paused keep-alive landing later does not take the badge from a playing device', () => {
    const shieldKeepAlive = { ...shield, lastHeartbeat: '2026-09-09T10:05:00.000Z' }
    const [card] = attachPresenceToVideos([video], [shieldKeepAlive, phone])

    expect(card.liveSessions[0].sessionId).toBe('phone')
    expect(card.deviceInfo.deviceType).toBe('mobile')
  })

  it('when the Shield is the only live one, the card says so, even if the phone wrote the row last', () => {
    const [card] = attachPresenceToVideos([video], [shield])

    expect(card.liveSessions[0].state).toBe('paused')
    expect(card.deviceInfo.deviceType).toBe('tv')
    expect(card.deviceInfo.userAgentTruncated).toContain('SHIELD')
  })

  it('leaves cards without a live session untouched', () => {
    const other = { id: 'v2', normalizedVideoId: 'ffffffffffffffff', mediaId: 'mid:other', deviceInfo: { deviceType: 'desktop' } }
    const [a, b] = attachPresenceToVideos([video, other], [phone])
    expect(a.liveSessions).toHaveLength(1)
    expect(b).toBe(other)
    expect(attachPresenceToVideos([other], [])).toEqual([other])
  })

  it('matches by durable mediaId when the hash moved under a quality swap', () => {
    const swapped = { ...phone, normalizedVideoId: 'newfile0000000000' }
    expect(sessionsForVideo(video, [swapped])).toHaveLength(1)
  })

  it('falls back to the hash only when one side has no mediaId yet', () => {
    const unresolved = { ...phone, mediaId: null }
    expect(sessionsForVideo(video, [unresolved])).toHaveLength(1)
    expect(sessionsForVideo({ ...video, mediaId: null }, [{ ...phone, normalizedVideoId: 'newfile0000000000' }])).toHaveLength(0)
    // Two different durable ids are two different titles, whatever the hash says.
    expect(sessionsForVideo(video, [{ ...phone, mediaId: 'mid:somethingelse' }])).toHaveLength(0)
  })
})
