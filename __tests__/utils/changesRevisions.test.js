/**
 * @jest-environment node
 *
 * The counters behind /api/authenticated/changes: a stamp moves when any
 * revision in it is bumped, and a bump made during a request lands only after
 * the response, once that request's cache-tag expiries have been applied.
 */
const mockAfter = jest.fn()
jest.mock('next/server', () => ({ after: (callback) => mockAfter(callback) }))

const {
  REVISION,
  bumpRevision,
  bumpRevisionAfterResponse,
  homeRowsRevision,
  stamp,
  watchHistoryRevision,
} = require('@src/utils/changes/revisions')

beforeEach(() => mockAfter.mockReset())

it('moves a stamp when any of its revisions is bumped, and no other', () => {
  const library = stamp(REVISION.LIBRARY)
  const playlistRow = stamp(REVISION.PLAYLISTS, REVISION.LIBRARY)
  const homeRows = stamp(homeRowsRevision('u1'), REVISION.PLAYLISTS)

  bumpRevision(REVISION.PLAYLISTS)

  expect(stamp(REVISION.LIBRARY)).toBe(library)
  expect(stamp(REVISION.PLAYLISTS, REVISION.LIBRARY)).not.toBe(playlistRow)
  expect(stamp(homeRowsRevision('u1'), REVISION.PLAYLISTS)).not.toBe(homeRows)
})

it("keeps one person's revisions apart from another's", () => {
  const mine = stamp(watchHistoryRevision('u1'))
  const theirs = stamp(watchHistoryRevision('u2'))

  bumpRevision(watchHistoryRevision('u2'))

  expect(stamp(watchHistoryRevision('u1'))).toBe(mine)
  expect(stamp(watchHistoryRevision('u2'))).not.toBe(theirs)
})

it('starts every stamp with the boot id, so a restart changes them all', () => {
  const [boot] = stamp(REVISION.LIBRARY).split('.')
  expect(boot).toMatch(/^[0-9a-f]{8}$/)
  expect(stamp(REVISION.PLAYLISTS).startsWith(`${boot}.`)).toBe(true)
})

it('bumps after the response when a request is in progress', () => {
  const before = stamp(REVISION.LIBRARY)

  bumpRevisionAfterResponse(REVISION.LIBRARY)

  expect(mockAfter).toHaveBeenCalledTimes(1)
  expect(stamp(REVISION.LIBRARY)).toBe(before)
  mockAfter.mock.calls[0][0]()
  expect(stamp(REVISION.LIBRARY)).not.toBe(before)
})

it('bumps at once outside a request, where after() throws', () => {
  mockAfter.mockImplementation(() => {
    throw new Error('`after` was called outside a request scope')
  })
  const before = stamp(REVISION.LIBRARY)

  bumpRevisionAfterResponse(REVISION.LIBRARY)

  expect(stamp(REVISION.LIBRARY)).not.toBe(before)
})
