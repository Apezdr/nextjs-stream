/**
 * @jest-environment node
 *
 * The web's server renders and a watch history that cannot be read
 * (src/utils/watchHistoryServerUtils.ts).
 *
 * The lookup map now throws on a failed read, so that a request about one
 * title can fail instead of answering "never played"
 * (__tests__/app/mediaRouteWatchHistory.test.js). The pages that read it
 * through these helpers keep what they always did, on purpose: a list page
 * renders without progress, a player page with a start position of 0. This
 * pins that, so the map's change alters no page.
 */

jest.mock('@src/utils/watchHistoryUtils', () => ({ createWatchHistoryLookupMap: jest.fn() }))

const { createWatchHistoryLookupMap } = require('@src/utils/watchHistoryUtils')
const {
  getCurrentUserWatchHistory,
  getResumePositionForMedia,
  getWatchDataForVideo,
  getWatchTimeForVideo,
  hasWatchedVideo,
} = require('@src/utils/watchHistoryServerUtils')

const MEDIA = { videoURL: 'https://files.example/movies/family.film.mp4', normalizedVideoId: 'nid-family', mediaId: 'mid:family', duration: 7_200_000 }

let logged
beforeEach(() => {
  createWatchHistoryLookupMap.mockReset()
  logged = jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => logged.mockRestore())

describe('when the history cannot be read', () => {
  beforeEach(() => createWatchHistoryLookupMap.mockRejectedValue(new Error('connection closed')))

  it('the list pages get an empty map, and the failure is logged', async () => {
    const map = await getCurrentUserWatchHistory('u1')

    expect(map).toBeInstanceOf(Map)
    expect(map.size).toBe(0)
    expect(logged).toHaveBeenCalledWith('[watchHistoryServerUtils] Error fetching watch history:', expect.any(Error))
  })

  it('a player page still renders, from a start position of 0', async () => {
    expect(await getResumePositionForMedia(MEDIA, 'u1')).toBe(0)
    expect(await getWatchDataForVideo(MEDIA, 'u1')).toBeNull()
    expect(await getWatchTimeForVideo(MEDIA, 'u1')).toBe(0)
    expect(await hasWatchedVideo(MEDIA, 'u1')).toBe(false)
  })
})

describe('when it can', () => {
  it('a player page starts where the row is', async () => {
    createWatchHistoryLookupMap.mockResolvedValue(new Map([['mid:family', { playbackTime: 1800, lastWatched: '2026-11-10T20:00:00.000Z', mediaId: 'mid:family' }]]))

    expect(await getResumePositionForMedia(MEDIA, 'u1')).toBe(1800)
  })

  it('a signed-out render reads nothing', async () => {
    expect((await getCurrentUserWatchHistory(null)).size).toBe(0)
    expect(createWatchHistoryLookupMap).not.toHaveBeenCalled()
  })
})
