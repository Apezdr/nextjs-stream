/**
 * @jest-environment node
 *
 * POST /api/cast/playback: the receiver's reports keep the cast's presence row
 * live, so a title playing on a TV reads as watching, and a final report ends
 * the row. The row is namespaced to casts, so a cast token never touches the
 * same user's web or TV-app sessions, and it names the cast device, never the
 * receiver's user agent.
 */

const mockUpsertPlaybackFromCast = jest.fn()
jest.mock('@src/utils/watchHistory/database', () => ({
  __esModule: true,
  upsertPlaybackFromCast: (...args) => mockUpsertPlaybackFromCast(...args),
}))

const mockUpsertPresence = jest.fn()
const mockEndPresence = jest.fn()
jest.mock('@src/utils/playbackPresence/database', () => ({
  __esModule: true,
  upsertPresenceHeartbeat: (...args) => mockUpsertPresence(...args),
  endPresenceSession: (...args) => mockEndPresence(...args),
}))

jest.mock('@src/utils/rateLimiter', () => ({
  __esModule: true,
  checkRateLimit: () => ({ isLimited: false }),
  createRateLimitHeaders: () => ({}),
  getClientIP: () => '203.0.113.5',
}))
jest.mock('@src/utils/cache/invalidation', () => ({
  __esModule: true,
  invalidateUserWatchHistoryCache: jest.fn(async () => {}),
}))
jest.mock('@src/utils/videoIdentity', () => ({
  __esModule: true,
  generateNormalizedVideoId: (videoId) => `nid:${videoId}`,
}))
jest.mock('@src/utils/deviceDetection', () => ({
  __esModule: true,
  createPlaybackDeviceInfo: (ua) => ({ type: 'tv', userAgent: ua }),
}))
jest.mock('@src/lib/requestCaller', () => ({ __esModule: true, recordUserCaller: jest.fn() }))
const mockLog = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
jest.mock('@src/lib/logger', () => ({ __esModule: true, createLogger: () => mockLog }))
jest.mock('mongodb', () => ({
  __esModule: true,
  ObjectId: class ObjectId {
    constructor(value) {
      this.value = String(value)
    }
    toString() {
      return this.value
    }
  },
}))

const USER = '507f1f77bcf86cd799439011'
const VIDEO = 'https://files.example.com/tv/show/s02e07/master.m3u8'
const CAST_SESSION = '3f2b6c1e-8a4d-4f0b-9c2e-5d7a1b0e6f42'
const RECEIVER_UA = 'Mozilla/5.0 (X11; Linux aarch64) CrKey/1.56.500000 Chrome/114 Safari/537.36'

let mintCastPlaybackToken
let CAST_TOKEN_TTL_MS
let POST

beforeAll(() => {
  process.env.BETTER_AUTH_SECRET = 'test-better-auth-secret'
  ;({ mintCastPlaybackToken, CAST_TOKEN_TTL_MS } = require('@src/lib/castPlaybackToken'))
  ;({ POST } = require('../../src/app/api/cast/playback/route'))
})

beforeEach(() => {
  jest.clearAllMocks()
  mockUpsertPlaybackFromCast.mockResolvedValue(true)
  mockUpsertPresence.mockResolvedValue(true)
  mockEndPresence.mockResolvedValue(undefined)
})

function token(videoId = VIDEO) {
  return mintCastPlaybackToken({
    userId: USER,
    normalizedVideoId: `nid:${videoId}`,
    metadata: { mediaType: 'tv', showId: 'route-show-id', seasonNumber: 2, episodeNumber: 7 },
  })
}

function report(body) {
  return POST(
    new Request('http://localhost/api/cast/playback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'user-agent': RECEIVER_UA },
      body: JSON.stringify({ token: token(), videoId: VIDEO, castSessionId: CAST_SESSION, ...body }),
    })
  )
}

describe('a report keeps the cast live', () => {
  it('with no sender: the position, and the cast presence row for the token’s user', async () => {
    const res = await report({ playbackTime: 600, isPaused: false })
    expect(res.status).toBe(200)

    expect(mockUpsertPlaybackFromCast).toHaveBeenCalledTimes(1)
    expect(mockUpsertPresence).toHaveBeenCalledTimes(1)
    const [presence] = mockUpsertPresence.mock.calls[0]
    expect(String(presence.userId)).toBe(USER)
    expect(presence).toMatchObject({
      sessionId: `cast:${CAST_SESSION}`,
      videoId: VIDEO,
      playbackTime: 600,
      isPaused: false,
      // The cast device, never the receiver's user agent
      deviceInfo: { type: 'cast' },
      ipAddress: '203.0.113.5',
      // Signed claims; showId and mediaId come from the catalog inside the write
      metadata: { mediaType: 'tv', seasonNumber: 2, episodeNumber: 7 },
    })
    expect(presence.metadata).not.toHaveProperty('showId')
  })

  it('with a sender connected: presence only, the sender owns the position', async () => {
    const res = await report({ playbackTime: 600, isPaused: true, presenceOnly: true })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, applied: false })

    expect(mockUpsertPlaybackFromCast).not.toHaveBeenCalled()
    expect(mockUpsertPresence.mock.calls[0][0]).toMatchObject({ playbackTime: 600, isPaused: true })
  })

  it('a position the ordering guard refused still keeps the cast live: the TV is there either way', async () => {
    mockUpsertPlaybackFromCast.mockResolvedValue(false)
    await report({ playbackTime: 590 })
    expect(mockUpsertPresence).toHaveBeenCalledTimes(1)
  })

  it('a presence failure never fails the report', async () => {
    mockUpsertPresence.mockRejectedValue(new Error('mongo down'))
    const res = await report({ playbackTime: 600 })
    expect(res.status).toBe(200)
    expect(mockUpsertPlaybackFromCast).toHaveBeenCalledTimes(1)
    expect(mockLog.error).toHaveBeenCalled()
  })
})

describe('a final report ends the cast', () => {
  it('with the last position: saves it and ends the row', async () => {
    const res = await report({ playbackTime: 2400, final: true })
    expect(res.status).toBe(200)

    expect(mockUpsertPlaybackFromCast).toHaveBeenCalledTimes(1)
    expect(mockUpsertPresence).not.toHaveBeenCalled()
    expect(mockEndPresence).toHaveBeenCalledTimes(1)
    const [ended] = mockEndPresence.mock.calls[0]
    expect(String(ended.userId)).toBe(USER)
    expect(ended.sessionId).toBe(`cast:${CAST_SESSION}`)
  })

  it('rolls no token: a final report is the last word for its token', async () => {
    const realNow = Date.now
    const mintedAt = realNow()
    const nearExpiry = token()
    Date.now = () => mintedAt + CAST_TOKEN_TTL_MS - 30 * 60_000
    try {
      const ordinary = await (await report({ token: nearExpiry, playbackTime: 2300 })).json()
      expect(ordinary.token).toEqual(expect.any(String))
      const final = await (await report({ token: nearExpiry, playbackTime: 2400, final: true })).json()
      expect(final).toMatchObject({ ok: true })
      expect(final).not.toHaveProperty('token')
    } finally {
      Date.now = realNow
    }
  })

  it('with no position (nothing worth saving, or the outgoing title of a swap): ends the row only', async () => {
    const res = await report({ final: true })
    expect(res.status).toBe(200)
    expect(mockUpsertPlaybackFromCast).not.toHaveBeenCalled()
    expect(mockEndPresence).toHaveBeenCalledTimes(1)
  })

  it('a final report even with a presenceOnly flag saves the position: it is the last word', async () => {
    await report({ playbackTime: 2400, final: true, presenceOnly: true })
    expect(mockUpsertPlaybackFromCast).toHaveBeenCalledTimes(1)
  })
})

describe('what a report may touch', () => {
  it('only a final report may omit the position', async () => {
    const res = await report({})
    expect(res.status).toBe(400)
    expect(mockUpsertPresence).not.toHaveBeenCalled()
  })

  it('a malformed position is refused, final or not', async () => {
    expect((await report({ playbackTime: 'soon', final: true })).status).toBe(400)
    expect((await report({ playbackTime: -1 })).status).toBe(400)
    expect(mockEndPresence).not.toHaveBeenCalled()
  })

  it('an id the receiver could not have minted writes no presence', async () => {
    for (const castSessionId of ['web-session/../x', 'a'.repeat(65), '', 42, null]) {
      jest.clearAllMocks()
      const res = await report({ playbackTime: 600, castSessionId })
      expect(res.status).toBe(200)
      expect(mockUpsertPresence).not.toHaveBeenCalled()
      expect(mockUpsertPlaybackFromCast).toHaveBeenCalledTimes(1)
    }
  })

  it('a token for another title writes nothing, presence included', async () => {
    const res = await POST(
      new Request('http://localhost/api/cast/playback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token('https://files.example.com/other.mp4'), videoId: VIDEO, castSessionId: CAST_SESSION, final: true }),
      })
    )
    expect(res.status).toBe(403)
    expect(mockEndPresence).not.toHaveBeenCalled()
    expect(mockUpsertPresence).not.toHaveBeenCalled()
  })
})
