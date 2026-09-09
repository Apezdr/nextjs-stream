/**
 * One read precedence for every surface, and a quality-swap merge that keeps
 * the row.
 *
 * The web player used to look a row up by URL and hash only, the web list
 * pages by the raw URL string only, and the media API by mediaId first. The
 * same title therefore resumed on the TV app and read as unwatched (or lost
 * its row entirely) on the web after a file was replaced. The resolver here
 * is what every surface now calls.
 */

const { ObjectId } = require('mongodb')

// The driver ships bson as untransformed ESM, which jest cannot parse.
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

jest.mock('@src/lib/logger', () => ({
  __esModule: true,
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}))

const { generateNormalizedVideoId } = require('@src/utils/videoIdentity')
const {
  candidateKeysForItem,
  resolveWatchEntry,
  buildWatchHistoryObject,
} = require('@src/utils/watchHistory/resolve')
const { computeWatchProgress, WATCH_COMPLETION_PERCENT } = require('@src/utils/watchHistory/progress')

const RAW = 'https://personalserver.example.com/movies/Nosferatu/Nosferatu.2024.REPACK.mp4'
// base64url of "movies/Nosferatu/Nosferatu.2024.REPACK.mp4"
const KEY = Buffer.from('movies/Nosferatu/Nosferatu.2024.REPACK.mp4').toString('base64url')
const JIT = `https://transcoder.example.com/stream/${KEY}/master.m3u8`

describe('resolveWatchEntry', () => {
  it('a row written through the transcoder resolves for an item served raw, and vice versa', () => {
    expect(generateNormalizedVideoId(RAW)).toBe(generateNormalizedVideoId(JIT))

    const rowNid = generateNormalizedVideoId(JIT)
    const map = new Map([[rowNid, { playbackTime: 1200, normalizedVideoId: rowNid }], [JIT, { playbackTime: 1200 }]])

    // Web list page item: raw catalog URL, nothing else
    expect(resolveWatchEntry({ videoURL: RAW }, map)?.playbackTime).toBe(1200)
    // Media API item after the JIT swap: videoURL is the manifest, rawVideoURL the file
    expect(resolveWatchEntry({ videoURL: JIT, rawVideoURL: RAW }, map)?.playbackTime).toBe(1200)
    // Recently-watched TV record: the URL sits on the nested episode
    expect(resolveWatchEntry({ type: 'tv', episode: { videoURL: RAW } }, map)?.playbackTime).toBe(1200)
  })

  it('the durable mediaId arm survives a quality swap the hash cannot', () => {
    const oldNid = generateNormalizedVideoId(RAW)
    const newRaw = RAW.replace('REPACK', 'BDRemux')
    const map = new Map([
      [oldNid, { playbackTime: 7456, normalizedVideoId: oldNid, mediaId: 'mid:944495dc51b94a3a' }],
      ['mid:944495dc51b94a3a', { playbackTime: 7456, normalizedVideoId: oldNid, mediaId: 'mid:944495dc51b94a3a' }],
    ])
    const swapped = { videoURL: newRaw, normalizedVideoId: generateNormalizedVideoId(newRaw), mediaId: 'mid:944495dc51b94a3a' }

    expect(candidateKeysForItem(swapped)[0]).toBe('mid:944495dc51b94a3a')
    expect(resolveWatchEntry(swapped, map)?.playbackTime).toBe(7456)
    // Legacy hex mediaIds are not identity keys
    expect(candidateKeysForItem({ mediaId: '6a5581150a9eb1faa465f93b', videoURL: newRaw })[0]).not.toBe('6a5581150a9eb1faa465f93b')
  })

  it('returns null for items with nothing to key on, and for an empty map', () => {
    expect(resolveWatchEntry({ title: 'A show' }, new Map([['x', {}]]))).toBeNull()
    expect(resolveWatchEntry({ videoURL: RAW }, new Map())).toBeNull()
  })
})

describe('buildWatchHistoryObject', () => {
  it('emits one shape whether or not a row matched', () => {
    const miss = buildWatchHistoryObject({ duration: 7_200_000, normalizedVideoId: 'abc' }, null)
    expect(miss).toEqual({
      playbackTime: 0,
      lastWatched: null,
      isWatched: false,
      completed: false,
      progressPercent: 0,
      normalizedVideoId: 'abc',
      mediaId: null,
    })

    const hit = buildWatchHistoryObject(
      { duration: 7_200_000, mediaId: 'mid:1' },
      { playbackTime: 3600, lastWatched: '2026-09-08T00:00:00.000Z', normalizedVideoId: 'abc', showId: 's', seasonNumber: 0, episodeNumber: 3 }
    )
    expect(hit).toMatchObject({
      playbackTime: 3600,
      isWatched: true,
      completed: false,
      progressPercent: 50,
      mediaId: 'mid:1',
      showId: 's',
      seasonNumber: 0,
      episodeNumber: 3,
    })
  })

  it('completion is one threshold for every client', () => {
    expect(WATCH_COMPLETION_PERCENT).toBe(95)
    expect(computeWatchProgress(6900, 7_200_000)).toEqual({ progressPercent: 95.8, completed: true })
    expect(computeWatchProgress(6600, 7_200_000)).toEqual({ progressPercent: 91.7, completed: false })
    expect(computeWatchProgress(100, null)).toEqual({ progressPercent: 0, completed: false })
    // TMDB minutes as the last resort
    const done = buildWatchHistoryObject({ metadata: { runtime: 100 } }, { playbackTime: 5900 })
    expect(done.completed).toBe(true)
  })
})

describe('quality-swap merge', () => {
  let rows
  const collection = {
    findOne: jest.fn(async (filter) => rows.find((r) => r.normalizedVideoId === filter.normalizedVideoId) || null),
    updateOne: jest.fn(async (filter, update, options = {}) => {
      if (filter._id) {
        const row = rows.find((r) => r._id === filter._id)
        Object.assign(row, update.$set)
        return { matchedCount: 1, modifiedCount: 1 }
      }
      const existing = rows.find((r) => r.normalizedVideoId === filter.normalizedVideoId)
      if (existing) {
        Object.assign(existing, update.$set)
        return { matchedCount: 1, modifiedCount: 1 }
      }
      if (!options.upsert) return { matchedCount: 0, modifiedCount: 0 }
      // The partial unique index on {userId, mediaId}
      if (update.$set.mediaId && rows.some((r) => r.mediaId === update.$set.mediaId)) {
        const err = new Error('E11000 duplicate key error collection: Media.WatchHistory index: userId_mediaId_unique')
        err.code = 11000
        err.keyPattern = { userId: 1, mediaId: 1 }
        throw err
      }
      rows.push({ _id: `id${rows.length + 1}`, normalizedVideoId: filter.normalizedVideoId, ...update.$set })
      return { matchedCount: 0, upsertedCount: 1 }
    }),
    find: jest.fn((filter) => ({
      sort: () => ({
        toArray: async () =>
          rows
            .filter((r) => r.mediaId === filter.mediaId && r.normalizedVideoId !== filter.normalizedVideoId.$ne)
            .sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated)),
      }),
    })),
    deleteMany: jest.fn(async (filter) => {
      const ids = filter._id.$in
      rows = rows.filter((r) => !ids.includes(r._id))
      return { deletedCount: ids.length }
    }),
    countDocuments: jest.fn(async () => 0),
  }

  jest.doMock('@src/lib/mongodb', () => ({
    __esModule: true,
    default: Promise.resolve({ db: () => ({ collection: () => collection }) }),
  }))
  jest.doMock('@src/utils/watchHistory/mediaIdResolver', () => ({
    __esModule: true,
    resolveMediaIdForNid: jest.fn(async () => ({ mediaId: 'mid:swap', mediaType: 'movie', durationMs: null })),
  }))

  const { upsertPlayback } = require('@src/utils/watchHistory/database')
  const USER = new ObjectId()
  const oldNid = generateNormalizedVideoId(RAW)
  const newRaw = RAW.replace('REPACK', 'BDRemux')
  const newNid = generateNormalizedVideoId(newRaw)

  beforeEach(() => {
    rows = [
      { _id: 'old', userId: USER, normalizedVideoId: oldNid, videoId: RAW, mediaId: 'mid:swap', playbackTime: 7456, lastUpdated: new Date('2026-09-01') },
    ]
    jest.clearAllMocks()
  })

  it('re-keys the existing row to the new file instead of deleting it', async () => {
    await upsertPlayback({ userId: USER, videoId: newRaw, playbackTime: 7460, metadata: {} })

    expect(rows).toHaveLength(1)
    expect(rows[0]._id).toBe('old')
    expect(rows[0].normalizedVideoId).toBe(newNid)
    expect(rows[0].videoId).toBe(newRaw)
    expect(rows[0].playbackTime).toBe(7460)
  })

  it('a player booting on the new file does not erase the old resume point', async () => {
    await upsertPlayback({ userId: USER, videoId: newRaw, playbackTime: 0.8, metadata: {} })

    expect(rows).toHaveLength(1)
    expect(rows[0].normalizedVideoId).toBe(newNid)
    expect(rows[0].playbackTime).toBe(7456)
  })

  it('pre-backfill duplicates collapse to the newest row', async () => {
    rows.push({ _id: 'older', userId: USER, normalizedVideoId: 'stale', videoId: 'x', mediaId: 'mid:swap', playbackTime: 10, lastUpdated: new Date('2026-01-01') })
    await upsertPlayback({ userId: USER, videoId: newRaw, playbackTime: 7500, metadata: {} })

    expect(rows.map((r) => r._id)).toEqual(['old'])
    expect(rows[0].playbackTime).toBe(7500)
  })
})
