/**
 * @jest-environment node
 *
 * The places that change what a list shows must move its stamp in
 * /api/authenticated/changes, and library edits must expire the cached list
 * windows outright, so the refetch a stamp triggers reads the new rows.
 */
jest.mock('next/server', () => ({ after: (callback) => callback() }))
const mockRevalidateTag = jest.fn()
jest.mock('next/cache', () => ({
  revalidateTag: (...args) => mockRevalidateTag(...args),
  updateTag: jest.fn(),
}))

const {
  invalidateMovieDetailsCache,
  invalidateTVShowDetailsCache,
  invalidateSeasonDetailsCache,
  invalidateEpisodeDetailsCache,
  invalidateUserWatchHistoryCache,
} = require('@src/utils/cache/invalidation')
const { invalidateHomeRows } = require('@src/utils/watchlist/homeRowsCache')
const { REVISION, homeRowsRevision, stamp, watchHistoryRevision } = require('@src/utils/changes/revisions')

beforeEach(() => {
  mockRevalidateTag.mockReset()
  jest.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => console.log.mockRestore())

describe.each([
  ['a movie', () => invalidateMovieDetailsCache('Heat')],
  ['a show', () => invalidateTVShowDetailsCache('Severance')],
  ['a season', () => invalidateSeasonDetailsCache('Severance', 2)],
  ['an episode', () => invalidateEpisodeDetailsCache('Severance', 2, 1)],
])('an admin edit of %s', (_, edit) => {
  it('expires the list windows outright and moves the library stamp', async () => {
    const before = stamp(REVISION.LIBRARY)

    await edit()

    expect(mockRevalidateTag).toHaveBeenCalledWith('media-library', { expire: 0 })
    expect(mockRevalidateTag).not.toHaveBeenCalledWith('media-library', 'max')
    expect(stamp(REVISION.LIBRARY)).not.toBe(before)
  })
})

it('a playback write moves that person\'s watch-history stamp', async () => {
  const before = stamp(watchHistoryRevision('u1'))
  await invalidateUserWatchHistoryCache('u1')
  expect(stamp(watchHistoryRevision('u1'))).not.toBe(before)
})

it("a home-rows edit moves each affected person's home-rows stamp", () => {
  const before = [stamp(homeRowsRevision('u1')), stamp(homeRowsRevision('u2'))]
  invalidateHomeRows(['u1', 'u2', 'u1'])
  expect(stamp(homeRowsRevision('u1'))).not.toBe(before[0])
  expect(stamp(homeRowsRevision('u2'))).not.toBe(before[1])
})
