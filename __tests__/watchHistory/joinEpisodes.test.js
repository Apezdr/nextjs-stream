/**
 * The show/season pages' watch-history join: no viewer → empty objects,
 * durable ids → the bounded query, legacy docs → the full lookup map through
 * the one resolver; and the primitive-only shape handed to client islands.
 */

jest.mock('@src/utils/watchHistoryUtils', () => ({
  createWatchHistoryLookupMap: jest.fn(),
  addWatchHistoryToItemsBounded: jest.fn(),
}))

const { createWatchHistoryLookupMap, addWatchHistoryToItemsBounded } = require('@src/utils/watchHistoryUtils')
const { joinEpisodeWatchHistory, plainWatchHistory } = require('@src/utils/watchHistory/joinEpisodes')

const durable = { _id: 'e1', mediaId: 'mid:abc:s01e01', normalizedVideoId: 'n1', videoURL: 'https://files.example.com/S01E01.mp4', duration: 3_841_000 }
const legacy = { _id: 'e2', mediaId: null, normalizedVideoId: null, videoURL: 'https://files.example.com/S01E02.mp4', duration: 2_940_000 }

beforeEach(() => {
  createWatchHistoryLookupMap.mockReset()
  addWatchHistoryToItemsBounded.mockReset()
})

describe('joinEpisodeWatchHistory', () => {
  it('gives every episode an empty object when there is no viewer, without touching the database', async () => {
    const out = await joinEpisodeWatchHistory([durable, legacy], null)
    expect(out.map((e) => e.watchHistory.completed)).toEqual([false, false])
    expect(out[0].watchHistory.playbackTime).toBe(0)
    expect(out[0].watchHistory.mediaId).toBe('mid:abc:s01e01')
    expect(createWatchHistoryLookupMap).not.toHaveBeenCalled()
    expect(addWatchHistoryToItemsBounded).not.toHaveBeenCalled()
  })

  it('uses the bounded query when every episode carries a durable identity', async () => {
    addWatchHistoryToItemsBounded.mockResolvedValue([{ ...durable, watchHistory: { playbackTime: 509, completed: false, progressPercent: 13.3 } }])
    const out = await joinEpisodeWatchHistory([durable], 'u1')
    expect(addWatchHistoryToItemsBounded).toHaveBeenCalledWith([durable], 'u1')
    expect(createWatchHistoryLookupMap).not.toHaveBeenCalled()
    expect(out[0].watchHistory.playbackTime).toBe(509)
  })

  it('falls back to the full lookup map for legacy docs and resolves them through the raw URL', async () => {
    createWatchHistoryLookupMap.mockResolvedValue(new Map([[legacy.videoURL, { playbackTime: 2900, lastUpdated: '2026-08-01T20:00:00.000Z' }]]))
    const out = await joinEpisodeWatchHistory([durable, legacy], 'u1')
    expect(createWatchHistoryLookupMap).toHaveBeenCalledWith('u1')
    expect(addWatchHistoryToItemsBounded).not.toHaveBeenCalled()
    expect(out[0].watchHistory.playbackTime).toBe(0)
    expect(out[1].watchHistory.playbackTime).toBe(2900)
    expect(out[1].watchHistory.completed).toBe(true)
  })

  it('returns an empty list for an empty show', async () => {
    expect(await joinEpisodeWatchHistory([], 'u1')).toEqual([])
    expect(await joinEpisodeWatchHistory(undefined, null)).toEqual([])
  })
})

describe('plainWatchHistory', () => {
  it('keeps the rendering fields as primitives and drops the rest', () => {
    const plain = plainWatchHistory({
      playbackTime: 509,
      lastWatched: new Date('2026-09-01T20:00:00.000Z'),
      isWatched: true,
      completed: false,
      progressPercent: 13.3,
      normalizedVideoId: 'n1',
      mediaId: 'mid:abc:s01e01',
      showId: { toHexString: () => 'not serialisable' },
    })
    expect(plain).toEqual({
      playbackTime: 509,
      lastWatched: '2026-09-01T20:00:00.000Z',
      isWatched: true,
      completed: false,
      progressPercent: 13.3,
      normalizedVideoId: 'n1',
      mediaId: 'mid:abc:s01e01',
    })
  })

  it('reads a missing or malformed object as nothing watched', () => {
    expect(plainWatchHistory(null).completed).toBe(false)
    expect(plainWatchHistory({ lastWatched: 'nope', playbackTime: 'x' })).toMatchObject({ playbackTime: 0, lastWatched: null })
  })
})
