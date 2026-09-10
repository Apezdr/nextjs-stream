/**
 * Recent Activity cards with more than one live session on a title.
 *
 * Paused on the Shield, playing on the phone: the card used to show "Paused"
 * (from the first presence session found) under a phone icon (from the
 * WatchHistory row's last writer). Badge and icon now come from the same
 * session — the newest heartbeat — and the others are listed.
 */

const { attachPresenceToVideos, sessionsForVideo } = require('@src/utils/playbackPresence/attach')

const NID = 'a8a118c3a0e89d31'
const video = {
  id: 'v1',
  normalizedVideoId: NID,
  mediaId: 'mid:944495dc51b94a3a',
  // What the WatchHistory row's last writer left on the card
  deviceInfo: { deviceType: 'mobile', userAgentTruncated: 'NextJSStreamTVApp/1.0.0 (android; mobile; samsung SM-S918U)' },
}
const shield = {
  sessionId: 'shield',
  normalizedVideoId: NID,
  isPaused: true,
  playbackTime: 600,
  lastHeartbeat: new Date('2026-09-09T10:00:00Z'),
  deviceInfo: { type: 'tv', userAgent: 'NextJSStreamTVApp/1.0.0 (android; tv; NVIDIA SHIELD Android TV)' },
}
const phone = {
  sessionId: 'phone',
  normalizedVideoId: NID,
  isPaused: false,
  playbackTime: 1500,
  lastHeartbeat: new Date('2026-09-09T10:02:30Z'),
  deviceInfo: { type: 'mobile', userAgent: 'NextJSStreamTVApp/1.0.0 (android; mobile; samsung SM-S918U)' },
}

describe('attachPresenceToVideos', () => {
  it('badge and icon come from the newest session, whichever was created first', () => {
    // Shield session was created first — the old `find()` would have picked it
    const [card] = attachPresenceToVideos([video], [shield, phone])

    expect(card.watchingNow).toBe(true)
    expect(card.isPaused).toBe(false)
    expect(card.deviceInfo.deviceType).toBe('mobile')
    expect(card.activeDevices).toHaveLength(2)
    expect(card.activeDevices.map((d) => d.deviceType)).toEqual(['mobile', 'tv'])
    expect(card.activeDevices[1]).toMatchObject({ deviceType: 'tv', isPaused: true, playbackTime: 600 })
  })

  it('when the Shield is the live one, the card says so — even if the phone wrote the row last', () => {
    const laterShield = { ...shield, lastHeartbeat: new Date('2026-09-09T10:05:00Z') }
    const [card] = attachPresenceToVideos([video], [phone, laterShield])

    expect(card.isPaused).toBe(true)
    expect(card.deviceInfo.deviceType).toBe('tv')
    expect(card.deviceInfo.userAgentTruncated).toContain('SHIELD')
  })

  it('a single session still flags the card and lists one device', () => {
    const [card] = attachPresenceToVideos([video], [phone])
    expect(card.watchingNow).toBe(true)
    expect(card.activeDevices).toHaveLength(1)
  })

  it('leaves cards without a live session untouched', () => {
    const other = { id: 'v2', normalizedVideoId: 'ffffffffffffffff', deviceInfo: { deviceType: 'desktop' } }
    const [a, b] = attachPresenceToVideos([video, other], [phone])
    expect(a.watchingNow).toBe(true)
    expect(b).toBe(other)
    expect(attachPresenceToVideos([other], [])).toEqual([other])
  })

  it('matches a session by durable mediaId when the hash moved under a quality swap', () => {
    const swapped = { ...phone, normalizedVideoId: 'newfile0000000000', mediaId: 'mid:944495dc51b94a3a' }
    expect(sessionsForVideo(video, [swapped])).toHaveLength(1)
    expect(sessionsForVideo({ ...video, mediaId: null }, [swapped])).toHaveLength(0)
  })
})
