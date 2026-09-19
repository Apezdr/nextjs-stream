/**
 * The resume floor on client-reported positions.
 *
 * Every player passes through ~0 on its way somewhere: on mount before the
 * saved position is seeked, after a source swap, when a Cast provider forces
 * the element back to zero. A heartbeat landing in that window reports the
 * player booting, not a viewing position — and a blind write turns a two-hour
 * resume point into "1.7 seconds".
 *
 * The web player refuses to send those. The RN apps guard on `> 0`, which lets
 * 0.5s through, so the floor has to live at the write chokepoint they share.
 */

let store = null

/** Just enough query engine for the shapes these paths use. */
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
  findOne: jest.fn(async (filter) => (matches(store, filter) ? store : null)),
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

const { ObjectId } = require('mongodb')
const { upsertPlayback, MIN_PERSISTED_POSITION_S } = require('@src/utils/watchHistory/database')

const USER = new ObjectId()
const VIDEO = 'https://transcoder.example.com/stream/bW92aWVzL1gvWC5ta3Y/master.m3u8'

const beat = (playbackTime) =>
  upsertPlayback({ userId: USER, videoId: VIDEO, playbackTime, metadata: {} })

beforeEach(() => {
  store = null
  jest.clearAllMocks()
})

describe('the resume floor', () => {
  it('a booting player does not destroy an established resume point', async () => {
    await beat(4200)
    await beat(0.55) // the exact shape production carried on TV devices

    expect(store.playbackTime).toBe(4200)
  })

  it('still refreshes liveness while withholding the position', async () => {
    await beat(4200)
    const before = store.lastUpdated

    await new Promise((r) => setTimeout(r, 2))
    await upsertPlayback({
      userId: USER,
      videoId: VIDEO,
      playbackTime: 1.2,
      metadata: {},
      isPaused: true,
      deviceInfo: { type: 'tv' },
    })

    expect(store.playbackTime).toBe(4200)
    expect(store.isPaused).toBe(true)
    expect(store.deviceInfo).toEqual({ type: 'tv' })
    expect(new Date(store.lastUpdated).getTime()).toBeGreaterThan(new Date(before).getTime())
  })

  it('lets a real position through, forwards or backwards', async () => {
    await beat(4200)
    await beat(90) // a deliberate rewind is a real position — never blocked
    expect(store.playbackTime).toBe(90)

    await beat(120)
    expect(store.playbackTime).toBe(120)
  })

  it('creates a first row even below the floor — there is nothing to protect', async () => {
    await beat(0.4)
    expect(store.playbackTime).toBe(0.4)
  })

  it('does not defend a stored position that is itself below the floor', async () => {
    await beat(1.5)
    await beat(0.4)
    expect(store.playbackTime).toBe(0.4)
  })

  it('accepts exactly the threshold as a real position', async () => {
    await beat(4200)
    await beat(MIN_PERSISTED_POSITION_S)
    expect(store.playbackTime).toBe(MIN_PERSISTED_POSITION_S)
  })

  it('costs one extra read only on the sub-threshold path', async () => {
    await beat(4200)
    expect(collection.findOne).not.toHaveBeenCalled()

    await beat(1)
    expect(collection.findOne).toHaveBeenCalledTimes(1)
  })
})
