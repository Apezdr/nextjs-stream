/**
 * @jest-environment node
 *
 * The start threshold at the write chokepoint every client shares.
 *
 * Opening the wrong title and backing out at once put it in Continue Watching
 * on every device: the player starts before the first frame is on screen, so
 * Back sends a `final` write 2 to 5 s in, and the server created a row from it.
 * Now no row is born under WATCH_START_THRESHOLD_S. It is a rule about
 * creating: a row that exists takes a write at any position, as before.
 *
 * The cases are the hand-off's table, row for row.
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
  // Quality-swap siblings; this file has one title and one file, so never any.
  find: jest.fn(() => ({ sort: () => ({ toArray: async () => [] }) })),
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

const mockLogInfo = jest.fn()
jest.mock('@src/lib/logger', () => ({
  __esModule: true,
  createLogger: () => ({ debug: jest.fn(), info: (...args) => mockLogInfo(...args), warn: jest.fn(), error: jest.fn() }),
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

const { WATCH_START_THRESHOLD_S } = require('@src/utils/watchHistory/database')
const { generateNormalizedVideoId } = require('@src/utils/flatDatabaseUtils')
const { POST } = require('../../src/app/api/authenticated/sync/updatePlayback/route')

const USER_ID = '507f1f77bcf86cd799439011'
const VIDEO = 'https://transcoder.example.com/stream/dHYvWC9TMDFFMDEubWt2/master.m3u8'
const NID = generateNormalizedVideoId(VIDEO)
const TV_META = { mediaType: 'tv', mediaId: 'abc', showId: 'show1', seasonNumber: 3, episodeNumber: 5 }

const post = (body) =>
  POST(new Request('http://localhost/api/authenticated/sync/updatePlayback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'user-agent': 'test' },
    body: JSON.stringify({ videoId: VIDEO, mediaMetadata: TV_META, ...body }),
  }))

const seedRow = (playbackTime) => {
  history = { userId: USER_ID, normalizedVideoId: NID, videoId: VIDEO, playbackTime }
}

/** The write's log line, the one SigNoz is queried by. */
const writeLog = () => mockLogInfo.mock.calls.find(([, msg]) => msg === 'Updating playback status')?.[0]

beforeEach(() => {
  history = null
  presence = null
  jest.clearAllMocks()
})

describe('the start threshold', () => {
  it('is 8 s of media time', () => {
    expect(WATCH_START_THRESHOLD_S).toBe(8)
  })

  it('final on exit, no row, 4.1 s: ignored, no row, and the answer is unchanged', async () => {
    const res = await post({ playbackTime: 4.1, kind: 'final', isPaused: true })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      message: 'Playback status updated successfully',
      acknowledged: true,
      kind: 'final',
    })
    expect(history).toBeNull()
    expect(invalidate).not.toHaveBeenCalled()
    expect(writeLog()).toMatchObject({ playbackTime: 4.1, kind: 'final', outcome: 'held' })
  })

  it('progress on pause, no row, 6.5 s: ignored, presence still refreshed', async () => {
    const res = await post({ playbackTime: 6.5, kind: 'progress', isPaused: true, sessionId: 'tv' })

    expect(res.status).toBe(200)
    expect(history).toBeNull()
    expect(presence).toMatchObject({ sessionId: 'tv', playbackTime: 6.5, isPaused: true })
    expect(writeLog().outcome).toBe('held')
  })

  it('progress, no row, 8.0 s: row created', async () => {
    await post({ playbackTime: 8, kind: 'progress', isPaused: false, sessionId: 'tv' })

    expect(history.playbackTime).toBe(8)
    expect(invalidate).toHaveBeenCalledWith(USER_ID)
    expect(writeLog().outcome).toBe('created')
  })

  it('final on exit, no row, 47 s: row created', async () => {
    await post({ playbackTime: 47, kind: 'final', isPaused: true })

    expect(history.playbackTime).toBe(47)
    expect(writeLog().outcome).toBe('created')
  })

  it('progress on pause, row at 1,240 s, 3.0 s (seeked to the start): row updated', async () => {
    seedRow(1240)
    await post({ playbackTime: 3, kind: 'progress', isPaused: true, sessionId: 'tv' })

    expect(history.playbackTime).toBe(3)
    expect(invalidate).toHaveBeenCalledWith(USER_ID)
    expect(writeLog().outcome).toBe('updated')
  })

  it('final on exit, row at 9 s, 7 s (resumed at 9 - 2 s and stopped): row updated', async () => {
    seedRow(9)
    await post({ playbackTime: 7, kind: 'final', isPaused: true })

    expect(history.playbackTime).toBe(7)
    expect(writeLog().outcome).toBe('updated')
  })

  it('holds a kind-less write from an old client the same way', async () => {
    await post({ playbackTime: 3, isPaused: false, sessionId: 'old' })

    expect(history).toBeNull()
    expect(writeLog()).toMatchObject({ kind: 'progress', outcome: 'held' })
  })

  it('never sends an upsert below the threshold, so no race can insert one', async () => {
    await post({ playbackTime: 1, kind: 'final', isPaused: true })

    const upserts = historyCollection.updateOne.mock.calls.filter(([, , options]) => options?.upsert)
    expect(upserts).toHaveLength(0)
    expect(history).toBeNull()
  })
})
