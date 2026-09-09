/**
 * @jest-environment node
 *
 * Write kinds at the chokepoint both clients share.
 *
 * A paused device used to re-post its paused position every few minutes to
 * keep presence alive, and the server wrote it with a blind $set — so an idle
 * paused TV dragged the row back over progress made on the web meanwhile.
 * Now a paused keep-alive carries no position and refreshes presence only,
 * and a pre-`kind` client's repeated paused position is reclassified the
 * same way by comparing it with the session's presence row.
 *
 * Alongside: absent metadata fields never erase what the row already knows,
 * and Specials (season 0) survive the trip.
 */

let history = null
let presence = null

function matches(doc, filter) {
  if (!doc) return false
  return Object.entries(filter).every(([key, value]) => {
    if (key === 'userId') return String(doc.userId) === String(value)
    return doc[key] === value
  })
}

const historyCollection = {
  findOne: jest.fn(async (filter) => (matches(history, filter) ? history : null)),
  updateOne: jest.fn(async (filter, update, options = {}) => {
    if (matches(history, filter)) {
      history = { ...history, ...update.$set }
      return { matchedCount: 1, modifiedCount: 1, acknowledged: true }
    }
    if (options.upsert) {
      history = { userId: filter.userId, normalizedVideoId: filter.normalizedVideoId, ...update.$set }
      return { matchedCount: 0, upsertedCount: 1, acknowledged: true }
    }
    return { matchedCount: 0, modifiedCount: 0, acknowledged: true }
  }),
  deleteMany: jest.fn(async () => ({ deletedCount: 0 })),
}

const presenceCollection = {
  createIndex: jest.fn(async () => {}),
  findOne: jest.fn(async (filter) => (matches(presence, filter) ? presence : null)),
  updateOne: jest.fn(async (filter, update, options = {}) => {
    if (matches(presence, filter)) {
      presence = { ...presence, ...update.$set }
      return { matchedCount: 1, modifiedCount: 1 }
    }
    if (options.upsert) {
      presence = { userId: filter.userId, sessionId: filter.sessionId, ...update.$set }
      return { matchedCount: 0, upsertedCount: 1 }
    }
    return { matchedCount: 0, modifiedCount: 0 }
  }),
  deleteOne: jest.fn(async () => ({ deletedCount: 1 })),
}

jest.mock('@src/lib/mongodb', () => ({
  __esModule: true,
  default: Promise.resolve({
    db: () => ({
      collection: (name) => (name === 'PlaybackPresence' ? presenceCollection : historyCollection),
    }),
  }),
}))

jest.mock('@src/utils/watchHistory/mediaIdResolver', () => ({
  __esModule: true,
  resolveMediaIdForNid: jest.fn(async () => ({ mediaId: 'mid:abc123', mediaType: 'tv' })),
}))

jest.mock('@src/lib/logger', () => ({
  __esModule: true,
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}))

jest.mock('mongodb', () => ({
  __esModule: true,
  ObjectId: class ObjectId {
    constructor(value) {
      this.value = String(value ?? '507f1f77bcf86cd799439011')
    }
    toHexString() {
      return this.value
    }
    toString() {
      return this.value
    }
  },
}))

// Route-level collaborators that are not under test here.
jest.mock('../../src/utils/routeAuth', () => ({
  __esModule: true,
  default: jest.fn(),
  isAuthenticatedAndApproved: jest.fn(async () => ({ id: '507f1f77bcf86cd799439011' })),
}))
jest.mock('@src/utils/deviceDetection', () => ({
  __esModule: true,
  createPlaybackDeviceInfo: () => ({ type: 'tv', userAgent: 'test' }),
}))
jest.mock('@src/utils/rateLimiter', () => ({
  __esModule: true,
  getClientIP: () => 'unknown',
}))
const invalidate = jest.fn(async () => {})
jest.mock('@src/utils/cache/invalidation', () => ({
  __esModule: true,
  invalidateUserWatchHistoryCache: (...args) => invalidate(...args),
}))

const { ObjectId } = require('mongodb')
const { upsertPlayback } = require('@src/utils/watchHistory/database')
const { extractPlaybackMetadata, buildPlaybackMetadata } = require('@src/utils/watchHistory/metadata')
const { normalizePlaybackKind, kindWritesPosition } = require('@src/utils/watchHistory/writeKinds')
const { upsertPresenceHeartbeat, isRepeatPausedPing } = require('@src/utils/playbackPresence/database')
const { POST } = require('../../src/app/api/authenticated/sync/updatePlayback/route')

const USER = new ObjectId()
const VIDEO = 'https://transcoder.example.com/stream/dHYvWC9TMDFFMDEubWt2/master.m3u8'
const TV_META = { mediaType: 'tv', mediaId: 'abc', showId: 'show1', seasonNumber: 3, episodeNumber: 5 }

const post = (body) =>
  POST(new Request('http://localhost/api/authenticated/sync/updatePlayback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'user-agent': 'test' },
    body: JSON.stringify(body),
  }))

beforeEach(() => {
  history = null
  presence = null
  jest.clearAllMocks()
})

describe('write kinds', () => {
  it('absent means progress; unknown values are rejected', () => {
    expect(normalizePlaybackKind(undefined)).toBe('progress')
    expect(normalizePlaybackKind('keepalive')).toBe('keepalive')
    expect(normalizePlaybackKind('final')).toBe('final')
    expect(normalizePlaybackKind('seek')).toBe('seek')
    expect(normalizePlaybackKind('heartbeat')).toBeNull()
    expect(kindWritesPosition('keepalive')).toBe(false)
    expect(kindWritesPosition('final')).toBe(true)
  })
})

describe('metadata never erases what the row knows', () => {
  it('returns only the fields the client sent', () => {
    expect(extractPlaybackMetadata(undefined)).toEqual({})
    expect(extractPlaybackMetadata({ mediaType: 'tv' })).toEqual({ mediaType: 'tv' })
    expect(extractPlaybackMetadata({ mediaType: 'tv', showId: null, seasonNumber: undefined })).toEqual({
      mediaType: 'tv',
    })
  })

  it('keeps season 0 (Specials) and numeric strings', () => {
    expect(extractPlaybackMetadata({ mediaType: 'tv', seasonNumber: 0, episodeNumber: '3' })).toEqual({
      mediaType: 'tv',
      seasonNumber: 0,
      episodeNumber: 3,
    })
    expect(buildPlaybackMetadata({ mediaType: 'tv', seasonNumber: 0, episodeNumber: 3 })).toEqual({
      mediaType: 'tv',
      seasonNumber: 0,
      episodeNumber: 3,
    })
    expect(buildPlaybackMetadata({ mediaType: 'tv', seasonNumber: -1 })).toEqual({ mediaType: 'tv' })
  })

  it('a heartbeat without the TV fields leaves the stored grouping alone', async () => {
    await upsertPlayback({ userId: USER, videoId: VIDEO, playbackTime: 600, metadata: extractPlaybackMetadata(TV_META) })
    expect(history.showId).toBe('show1')

    await upsertPlayback({
      userId: USER,
      videoId: VIDEO,
      playbackTime: 700,
      metadata: extractPlaybackMetadata({ mediaType: 'tv' }),
    })
    expect(history.playbackTime).toBe(700)
    expect(history.showId).toBe('show1')
    expect(history.seasonNumber).toBe(3)
    expect(history.episodeNumber).toBe(5)

    // Even an explicit null from a client is "unchanged", not "erase".
    await upsertPlayback({ userId: USER, videoId: VIDEO, playbackTime: 800, metadata: { showId: null } })
    expect(history.showId).toBe('show1')
  })
})

describe('presence keep-alives', () => {
  it('refresh an existing row without touching its position and never insert', async () => {
    const inserted = await upsertPresenceHeartbeat({
      userId: USER, sessionId: 's1', videoId: VIDEO, playbackTime: undefined, isPaused: true,
    })
    expect(inserted).toBe(false)
    expect(presence).toBeNull()

    await upsertPresenceHeartbeat({ userId: USER, sessionId: 's1', videoId: VIDEO, playbackTime: 600, isPaused: true })
    const before = presence.lastHeartbeat
    await new Promise((r) => setTimeout(r, 2))
    const refreshed = await upsertPresenceHeartbeat({
      userId: USER, sessionId: 's1', videoId: VIDEO, playbackTime: undefined, isPaused: true,
    })
    expect(refreshed).toBe(true)
    expect(presence.playbackTime).toBe(600)
    expect(new Date(presence.lastHeartbeat).getTime()).toBeGreaterThan(new Date(before).getTime())
  })

  it('recognises a pre-kind client repeating its paused position', async () => {
    await upsertPresenceHeartbeat({ userId: USER, sessionId: 's1', videoId: VIDEO, playbackTime: 600, isPaused: false })
    // The pause flip itself: presence still says playing → a real write.
    expect(await isRepeatPausedPing({ userId: USER, sessionId: 's1', playbackTime: 600 })).toBe(false)

    await upsertPresenceHeartbeat({ userId: USER, sessionId: 's1', videoId: VIDEO, playbackTime: 600, isPaused: true })
    expect(await isRepeatPausedPing({ userId: USER, sessionId: 's1', playbackTime: 600.4 })).toBe(true)
    // A seek while paused is a new position, not a repeat.
    expect(await isRepeatPausedPing({ userId: USER, sessionId: 's1', playbackTime: 300 })).toBe(false)
    // Unknown session: nothing to compare with.
    expect(await isRepeatPausedPing({ userId: USER, sessionId: 'other', playbackTime: 600 })).toBe(false)
  })
})

describe('POST /api/authenticated/sync/updatePlayback', () => {
  it('rejects a progress write without a position, and an unknown kind', async () => {
    expect((await post({ videoId: VIDEO, mediaMetadata: TV_META, isPaused: false })).status).toBe(400)
    expect((await post({ videoId: VIDEO, playbackTime: 5, kind: 'heartbeat' })).status).toBe(400)
  })

  it('a keep-alive without a position is accepted and writes no history', async () => {
    await post({ videoId: VIDEO, playbackTime: 1500, sessionId: 's1', isPaused: false, mediaMetadata: TV_META })
    expect(history.playbackTime).toBe(1500)
    invalidate.mockClear()

    const res = await post({ videoId: VIDEO, kind: 'keepalive', sessionId: 's1', isPaused: true, mediaMetadata: TV_META })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.kind).toBe('keepalive')
    expect(history.playbackTime).toBe(1500)
    expect(presence.playbackTime).toBe(1500)
    expect(presence.isPaused).toBe(true)
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('the idle paused device no longer overwrites the active one', async () => {
    // TV app (old build, no kind): plays to 600, pauses, then pings every 180 s.
    await post({ videoId: VIDEO, playbackTime: 600, sessionId: 'tv', isPaused: false, mediaMetadata: TV_META })
    await post({ videoId: VIDEO, playbackTime: 600, sessionId: 'tv', isPaused: true, mediaMetadata: TV_META })
    expect(history.playbackTime).toBe(600)

    // Web: watches on to 1500 and exits with a final flush (no sessionId).
    await post({ videoId: VIDEO, playbackTime: 1500, kind: 'final', isPaused: true, mediaMetadata: TV_META })
    expect(history.playbackTime).toBe(1500)

    // The TV's next paused ping repeats 600 → reclassified as a keep-alive.
    const res = await post({ videoId: VIDEO, playbackTime: 600, sessionId: 'tv', isPaused: true, mediaMetadata: TV_META })
    expect((await res.json()).kind).toBe('keepalive')
    expect(history.playbackTime).toBe(1500)
    expect(history.lastWriter).toBe('client')

    // A genuine rewind on the paused TV (remote seek) is a new position.
    await post({ videoId: VIDEO, playbackTime: 300, sessionId: 'tv', isPaused: true, mediaMetadata: TV_META })
    expect(history.playbackTime).toBe(300)
  })

  it('a declared progress write is believed even when it repeats a paused position', async () => {
    await post({ videoId: VIDEO, playbackTime: 600, sessionId: 'tv', isPaused: true, mediaMetadata: TV_META })
    await post({ videoId: VIDEO, playbackTime: 1500, kind: 'final', isPaused: true, mediaMetadata: TV_META })
    await post({ videoId: VIDEO, playbackTime: 600, kind: 'progress', sessionId: 'tv', isPaused: true, mediaMetadata: TV_META })
    expect(history.playbackTime).toBe(600)
  })

  it('a final write carries no session and refreshes no presence', async () => {
    await post({ videoId: VIDEO, playbackTime: 900, kind: 'final', isPaused: true, mediaMetadata: TV_META })
    expect(history.playbackTime).toBe(900)
    expect(presence).toBeNull()
  })
})
