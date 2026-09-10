/**
 * The list-page join end to end with production-shaped rows: the lookup map
 * as createWatchHistoryLookupMap builds it, the item as the movie list
 * projection returns it, through addWatchHistoryToItems.
 */

const ROW = {
  userId: '6578feca7317f7b672cebb5e',
  videoId:
    'https://transcoder.adamdrumm.com/stream/bW92aWVzL1RoZSBEZWF0aCBvZiBSb2JpbiBIb29kL1RoZS5EZWF0aC5vZi5Sb2Jpbi5Ib29kLjIwMjYuMTA4MHAuUmVtdXguQVZDLkRUUy1IRC5NQS41LjEtcGxheUJELm1rdg/master.m3u8',
  normalizedVideoId: 'be3c43b80607eb92',
  playbackTime: 6472.6572265625,
  lastUpdated: new Date('2026-09-09T05:55:37.539Z'),
  mediaType: 'movie',
  mediaId: 'mid:561b3c99f9fb2854',
  isValid: true,
}
const DOC = {
  _id: '6a5fb4ece53d98b4b0903144',
  title: 'The Death of Robin Hood',
  originalTitle: 'The Death of Robin Hood',
  videoURL:
    'https://personalserver.adamdrumm.com/movies/The%20Death%20of%20Robin%20Hood/The.Death.of.Robin.Hood.2026.1080p.Remux.AVC.DTS-HD.MA.5.1-playBD.mkv',
  duration: 7314724,
  normalizedVideoId: 'be3c43b80607eb92',
  mediaId: 'mid:561b3c99f9fb2854',
}

const collection = {
  find: jest.fn(() => ({ toArray: async () => [ROW] })),
}
jest.mock('@src/lib/mongodb', () => ({
  __esModule: true,
  default: Promise.resolve({ db: () => ({ collection: () => collection }) }),
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
jest.mock('@src/lib/logger', () => ({
  __esModule: true,
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}))

const { addWatchHistoryToItems, createWatchHistoryLookupMap } = require('@src/utils/watchHistoryUtils')
const { resolveWatchEntry, buildWatchHistoryObject } = require('@src/utils/watchHistory/resolve')

describe('list-page join with production shapes', () => {
  it('a movie watched through the transcoder shows progress on the list card', async () => {
    const [movie] = await addWatchHistoryToItems([DOC], ROW.userId)
    expect(movie.watchHistory).toMatchObject({
      playbackTime: ROW.playbackTime,
      isWatched: true,
      completed: false,
      normalizedVideoId: 'be3c43b80607eb92',
      mediaId: 'mid:561b3c99f9fb2854',
    })
    expect(movie.watchHistory.progressPercent).toBeCloseTo(88.5, 0)
  })

  it('the same map through the mediaListData path (resolve + build)', async () => {
    const map = await createWatchHistoryLookupMap(ROW.userId)
    expect(map.size).toBeGreaterThan(0)
    const entry = resolveWatchEntry(DOC, map)
    expect(entry?.playbackTime).toBe(ROW.playbackTime)
    // A list item without mediaId (older projection) still resolves by nid / URL
    expect(resolveWatchEntry({ videoURL: DOC.videoURL, duration: DOC.duration }, map)?.playbackTime).toBe(ROW.playbackTime)
    expect(buildWatchHistoryObject(DOC, entry).progressPercent).toBeGreaterThan(80)
  })
})
