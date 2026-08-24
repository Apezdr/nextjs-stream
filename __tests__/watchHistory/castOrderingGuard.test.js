/**
 * The ordering guard on cast-reported positions.
 *
 * Two writers share a WatchHistory row: the player in the browser, writing
 * every second, and the Cast receiver, writing every fifteen once the browser
 * is gone. Without a guard, a cast report that was already in flight lands
 * after a local resume and drags the row back to where the TV was — which is
 * how a user finishes a film, opens their laptop, and finds Continue Watching
 * pointing at the middle of it.
 *
 * These cases are the ones the guard exists to separate.
 */

let store = null

/** Just enough query engine for the guard's shape. */
function matches(doc, filter) {
  if (!doc) return false
  return Object.entries(filter).every(([key, value]) => {
    if (key === '$or') return value.some((clause) => matches(doc, clause))
    if (value && typeof value === 'object' && !(value instanceof Date) && !value.toHexString) {
      if ('$lte' in value) return doc[key] <= value.$lte
      if ('$lt' in value) return doc[key] < value.$lt
      if ('$ne' in value) return doc[key] !== value.$ne
    }
    if (key === 'userId') return String(doc.userId) === String(value)
    return doc[key] === value
  })
}

const collection = {
  updateOne: jest.fn(async (filter, update, options = {}) => {
    if (matches(store, filter)) {
      store = { ...store, ...update.$set }
      return { matchedCount: 1, modifiedCount: 1 }
    }
    if (options.upsert) {
      store = { userId: filter.userId, normalizedVideoId: filter.normalizedVideoId, ...update.$set }
      return { matchedCount: 0, upsertedCount: 1 }
    }
    return { matchedCount: 0, modifiedCount: 0 }
  }),
  countDocuments: jest.fn(async (filter) => (matches(store, filter) ? 1 : 0)),
  deleteMany: jest.fn(async () => ({ deletedCount: 0 })),
}

jest.mock('@src/lib/mongodb', () => ({
  __esModule: true,
  default: Promise.resolve({ db: () => ({ collection: () => collection }) }),
}))

jest.mock('@src/utils/watchHistory/mediaIdResolver', () => ({
  __esModule: true,
  resolveMediaIdForNid: jest.fn(async () => ({ mediaId: 'mid:abc123' })),
}))

jest.mock('@src/lib/logger', () => ({
  __esModule: true,
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}))

// The driver ships bson as untransformed ESM, which jest cannot parse. Only
// ObjectId is needed here, and only for its identity semantics.
jest.mock('mongodb', () => ({
  __esModule: true,
  ObjectId: class ObjectId {
    constructor(value) {
      this.value = String(value)
    }
    toHexString() {
      return this.value
    }
    toString() {
      return this.value
    }
  },
}))

const { ObjectId } = require('mongodb')
const { upsertPlaybackFromCast } = require('@src/utils/watchHistory/database')

const USER = new ObjectId('507f1f77bcf86cd799439011')
const NID = 'a1b2c3d4e5f60718'
const VIDEO = 'https://example.com/movies/Film/Film.mp4'

function seed(doc) {
  store = { userId: USER, normalizedVideoId: NID, videoId: VIDEO, ...doc }
}

function report(playbackTime) {
  return upsertPlaybackFromCast({
    userId: USER,
    videoId: VIDEO,
    normalizedVideoId: NID,
    playbackTime,
    metadata: { mediaType: 'movie' },
  })
}

describe('upsertPlaybackFromCast — ordering guard', () => {
  beforeEach(() => {
    store = null
    jest.clearAllMocks()
  })

  it('creates the row when nothing has been recorded for the title yet', async () => {
    await expect(report(300)).resolves.toBe(true)
    expect(store.playbackTime).toBe(300)
    expect(store.lastWriter).toBe('cast')
  })

  it('moves a row it already owns forward', async () => {
    seed({ playbackTime: 600, lastWriter: 'cast', lastUpdated: new Date() })
    await expect(report(610)).resolves.toBe(true)
    expect(store.playbackTime).toBe(610)
  })

  it('lets the TV remote rewind a row it owns', async () => {
    seed({ playbackTime: 600, lastWriter: 'cast', lastUpdated: new Date() })
    await expect(report(300)).resolves.toBe(true)
    expect(store.playbackTime).toBe(300)
  })

  it('takes over a row a client wrote a moment ago, because the position moved forward', async () => {
    seed({ playbackTime: 598, lastWriter: 'client', lastUpdated: new Date() })
    await expect(report(600)).resolves.toBe(true)
    expect(store.playbackTime).toBe(600)
    expect(store.lastWriter).toBe('cast')
  })

  it('drops a late report that would drag a fresh local resume backwards', async () => {
    // The user stopped casting and resumed locally at 20 minutes; a cast report
    // from before the handoff arrives afterwards.
    seed({ playbackTime: 1200, lastWriter: 'client', lastUpdated: new Date() })
    await expect(report(600)).resolves.toBe(false)
    expect(store.playbackTime).toBe(1200)
    expect(store.lastWriter).toBe('client')
  })

  it('does not resurrect a rejected report by upserting it', async () => {
    seed({ playbackTime: 1200, lastWriter: 'client', lastUpdated: new Date() })
    await report(600)
    expect(collection.updateOne).toHaveBeenCalledTimes(1)
    expect(collection.updateOne.mock.calls[0][2]).toEqual({ upsert: false })
  })

  it('takes a stale row that no live client has touched in a minute', async () => {
    seed({
      playbackTime: 1200,
      lastWriter: 'client',
      lastUpdated: new Date(Date.now() - 10 * 60 * 1000),
    })
    await expect(report(600)).resolves.toBe(true)
    expect(store.playbackTime).toBe(600)
  })

  it('stamps the durable media identity and the cast session', async () => {
    await upsertPlaybackFromCast({
      userId: USER,
      videoId: VIDEO,
      normalizedVideoId: NID,
      playbackTime: 300,
      metadata: { mediaType: 'tv', showId: 'show-1', seasonNumber: 2, episodeNumber: 7 },
      castSessionId: 'session-abc',
    })
    expect(store.mediaId).toBe('mid:abc123')
    expect(store.castSessionId).toBe('session-abc')
    expect(store.showId).toBe('show-1')
    expect(store.seasonNumber).toBe(2)
  })

  it('never writes a client-supplied mediaId over the resolved one', async () => {
    await upsertPlaybackFromCast({
      userId: USER,
      videoId: VIDEO,
      normalizedVideoId: NID,
      playbackTime: 300,
      metadata: { mediaType: 'movie', mediaId: 'attacker-supplied' },
    })
    expect(store.mediaId).toBe('mid:abc123')
  })
})
