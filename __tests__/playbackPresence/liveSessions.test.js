/**
 * @jest-environment node
 *
 * One live-session model (plans/media-activity-presence.md).
 *
 * The bug this replaces: readers kept a playing row live for 15 s, but the TV
 * app checks in every 30 s while playing, so every playing TV session blinked
 * out of "Watching" for half of each interval. Now the writer stamps each row
 * with its own expiry from one contract, and every reader asks only whether
 * that expiry has passed.
 */

let rows = []
const findCalls = []

function matches(doc, filter) {
  return Object.entries(filter).every(([key, value]) => String(doc[key]) === String(value))
}

const presenceCollection = {
  createIndex: jest.fn(async () => {}),
  findOneAndUpdate: jest.fn(async (filter, update, options = {}) => {
    const index = rows.findIndex((row) => matches(row, filter))
    if (index >= 0) {
      const before = rows[index]
      rows[index] = { ...before, ...update.$set }
      return { value: before, lastErrorObject: { n: 1, updatedExisting: true }, ok: 1 }
    }
    if (options.upsert) {
      rows.push({ _id: `row${rows.length + 1}`, userId: filter.userId, sessionId: filter.sessionId, ...update.$set })
      return { value: null, lastErrorObject: { n: 1, updatedExisting: false }, ok: 1 }
    }
    return { value: null, lastErrorObject: { n: 0, updatedExisting: false }, ok: 1 }
  }),
  find: jest.fn((query) => {
    findCalls.push(query)
    return {
      limit: () => ({
        toArray: async () =>
          rows.filter((row) => row.staleAfter && new Date(row.staleAfter) > query.staleAfter.$gt),
      }),
    }
  }),
}

jest.mock('@src/lib/mongodb', () => ({
  __esModule: true,
  default: Promise.resolve({ db: () => ({ collection: () => presenceCollection }) }),
}))

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

const mockLog = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
jest.mock('@src/lib/logger', () => ({
  __esModule: true,
  createLogger: () => mockLog,
}))

const mockResolve = jest.fn()
jest.mock('@src/utils/watchHistory/mediaIdResolver', () => ({
  __esModule: true,
  resolveMediaIdForNid: (...args) => mockResolve(...args),
}))

jest.mock('@src/utils/flatDatabaseUtils', () => ({
  __esModule: true,
  generateNormalizedVideoId: (videoId) => `nid:${videoId}`,
}))

jest.mock('@src/utils/deviceDetection', () => ({
  __esModule: true,
  detectBrowserType: (ua) => (ua.includes('Chrome') ? 'chrome' : 'unknown'),
  getDeviceTypeLabel: (type) => ({ tv: 'TV', desktop: 'Desktop', mobile: 'Mobile' })[type] || 'Unknown',
}))

const { ObjectId } = require('mongodb')
const { MAX_CHECK_IN_INTERVAL_MS, staleAfterFor, presenceStateFor } = require('@src/utils/playbackPresence/contract')
const { upsertPresenceHeartbeat } = require('@src/utils/playbackPresence/database')
const { toLiveSession, rankSessions, livePosition } = require('@src/utils/playbackPresence/session')
const { findLiveSessions } = require('@src/utils/playbackPresence/live')

const USER = '507f1f77bcf86cd799439011'
const SHOW = new ObjectId('64b000000000000000000001')
const TV_UA = 'NextJSStreamTVApp/1.0.0 (android; tv; NVIDIA SHIELD Android TV)'

beforeEach(() => {
  rows = []
  findCalls.length = 0
  jest.clearAllMocks()
  jest.useRealTimers()
  mockResolve.mockResolvedValue({ mediaId: 'mid:episode1', mediaType: 'tv', durationMs: 2_700_000, showId: SHOW })
})

describe('the contract', () => {
  it('keeps a row live for twice the longest check-in interval of its state', () => {
    const now = new Date('2026-11-08T12:00:00Z')
    expect(MAX_CHECK_IN_INTERVAL_MS).toEqual({ playing: 30_000, paused: 180_000 })
    expect(staleAfterFor('playing', now).toISOString()).toBe('2026-11-08T12:01:00.000Z')
    expect(staleAfterFor('paused', now).toISOString()).toBe('2026-11-08T12:06:00.000Z')
    expect(presenceStateFor(true)).toBe('paused')
    expect(presenceStateFor(false)).toBe('playing')
    expect(() => staleAfterFor('buffering', now)).toThrow('Unknown presence state')
  })
})

describe('upsertPresenceHeartbeat', () => {
  const heartbeat = (overrides = {}) =>
    upsertPresenceHeartbeat({
      userId: USER,
      sessionId: 'tv-1',
      videoId: '/tv/show/s01e01.mkv',
      playbackTime: 600,
      isPaused: false,
      metadata: { mediaType: 'tv', mediaId: 'client-value', showId: 'route-id', seasonNumber: 1, episodeNumber: 1 },
      deviceInfo: { type: 'tv', userAgent: TV_UA },
      ...overrides,
    })

  it('stamps state, expiry and position time, with identity from the catalog', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-08T12:00:00Z') })
    expect(await heartbeat()).toBe(true)

    const [row] = rows
    expect(row.state).toBe('playing')
    expect(row.staleAfter.toISOString()).toBe('2026-11-08T12:01:00.000Z')
    expect(row.positionAt.toISOString()).toBe('2026-11-08T12:00:00.000Z')
    expect(row.mediaId).toBe('mid:episode1')
    // The client's route id never lands; the catalog's show does.
    expect(row.showId).toBe(SHOW)
    expect(row).not.toHaveProperty('isPaused')
  })

  it('a paused keep-alive extends the paused expiry and keeps the position and its time', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-08T12:00:00Z') })
    await heartbeat({ isPaused: true })
    jest.setSystemTime(new Date('2026-11-08T12:03:00Z'))
    expect(await heartbeat({ playbackTime: undefined, isPaused: true })).toBe(true)

    const [row] = rows
    expect(row.state).toBe('paused')
    expect(row.staleAfter.toISOString()).toBe('2026-11-08T12:09:00.000Z')
    expect(row.playbackTime).toBe(600)
    expect(row.positionAt.toISOString()).toBe('2026-11-08T12:00:00.000Z')
  })

  it('a keep-alive for an unknown session writes nothing', async () => {
    expect(await heartbeat({ playbackTime: undefined, isPaused: true })).toBe(false)
    expect(rows).toHaveLength(0)
  })

  it('logs a heartbeat that arrives after its row went stale', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-08T12:00:00Z') })
    await heartbeat()
    jest.setSystemTime(new Date('2026-11-08T12:00:30Z'))
    await heartbeat({ playbackTime: 630 })
    expect(mockLog.warn).not.toHaveBeenCalled()

    // 70 s of silence while playing: past the 60 s expiry.
    jest.setSystemTime(new Date('2026-11-08T12:01:40Z'))
    await heartbeat({ playbackTime: 700 })
    expect(mockLog.warn).toHaveBeenCalledTimes(1)
    expect(mockLog.warn.mock.calls[0][0]).toMatchObject({
      sessionId: 'tv-1',
      deviceType: 'tv',
      state: 'playing',
      gapMs: 70_000,
    })
  })
})

describe('the LiveSession shape', () => {
  const row = {
    _id: 'row1',
    userId: USER,
    sessionId: 'web-1',
    videoId: '/movies/a.mp4',
    normalizedVideoId: 'nid1',
    mediaId: 'mid:a',
    mediaType: 'movie',
    state: 'playing',
    playbackTime: 100,
    positionAt: new Date('2026-11-08T12:00:00Z'),
    lastHeartbeat: new Date('2026-11-08T12:00:00Z'),
    staleAfter: new Date('2026-11-08T12:01:00Z'),
    deviceInfo: { type: 'desktop', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0' },
  }

  it('carries state, position and a readable device', () => {
    expect(toLiveSession(row)).toMatchObject({
      id: 'row1',
      userId: USER,
      mediaId: 'mid:a',
      state: 'playing',
      position: 100,
      positionAt: '2026-11-08T12:00:00.000Z',
      staleAfter: '2026-11-08T12:01:00.000Z',
      device: { type: 'desktop', label: 'Chrome · Desktop', platform: 'Windows' },
    })
  })

  it('refuses a row written outside the contract', () => {
    expect(toLiveSession({ ...row, state: undefined })).toBeNull()
  })

  it('moves a playing position on with the clock; a paused one stays put', () => {
    const playing = toLiveSession(row)
    const at = new Date('2026-11-08T12:00:20Z').getTime()
    expect(livePosition(playing, at)).toBe(120)
    expect(livePosition({ ...playing, state: 'paused' }, at)).toBe(100)
  })
})

describe('rankSessions', () => {
  const session = (id, state, lastHeartbeat) => ({ id, state, lastHeartbeat })

  it('puts a playing device ahead of a paused one whose keep-alive landed later', () => {
    const tvPlaying = session('tv', 'playing', '2026-11-08T12:00:00Z')
    const phoneKeepAlive = session('phone', 'paused', '2026-11-08T12:00:25Z')
    expect(rankSessions([phoneKeepAlive, tvPlaying]).map((s) => s.id)).toEqual(['tv', 'phone'])
  })

  it('within a state, the newest heartbeat comes first', () => {
    const older = session('a', 'paused', '2026-11-08T12:00:00Z')
    const newer = session('b', 'paused', '2026-11-08T12:01:00Z')
    expect(rankSessions([older, newer]).map((s) => s.id)).toEqual(['b', 'a'])
  })
})

describe('findLiveSessions', () => {
  it('a TV session checking in every 30 s stays live the whole time', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-08T12:00:00Z') })
    await upsertPresenceHeartbeat({ userId: USER, sessionId: 'tv-1', videoId: '/tv/a.mkv', playbackTime: 600 })

    // Sampled every 2 s up to the next check-in: never out, as it was under the old 15 s window.
    for (let second = 0; second <= 30; second += 2) {
      const now = new Date(Date.UTC(2026, 10, 8, 12, 0, second))
      const live = await findLiveSessions({}, { now })
      expect(live.map((s) => s.sessionId)).toEqual(['tv-1'])
    }

    // An unclean end: no further check-ins. Gone once the row expires.
    expect(await findLiveSessions({}, { now: new Date('2026-11-08T12:01:01Z') })).toEqual([])
  })

  it('skips rows from before the contract (no staleAfter)', async () => {
    rows = [{ _id: 'old', userId: USER, sessionId: 'x', isPaused: false, lastHeartbeat: new Date() }]
    expect(await findLiveSessions()).toEqual([])
  })

  it('filters on the given identities, and an empty list matches nothing', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-08T12:00:00Z') })
    await upsertPresenceHeartbeat({ userId: USER, sessionId: 'tv-1', videoId: '/tv/a.mkv', playbackTime: 600 })

    await findLiveSessions({ mediaIds: ['mid:episode1'], showIds: [String(SHOW)] })
    expect(findCalls[0]).toMatchObject({ mediaId: { $in: ['mid:episode1'] } })
    expect(String(findCalls[0].showId.$in[0])).toBe(String(SHOW))

    expect(await findLiveSessions({ userIds: [] })).toEqual([])
    expect(findCalls).toHaveLength(1)
  })
})
