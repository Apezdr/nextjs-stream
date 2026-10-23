/**
 * @jest-environment node
 *
 * A successful playlist or watchlist write moves the playlists stamp in
 * /api/authenticated/changes; a refused or failed one doesn't, so polling
 * clients don't refetch playlist rows for nothing.
 */
jest.mock('next/server', () => ({ after: (callback) => callback() }))
jest.mock('@src/utils/routeAuth', () => ({ isAuthenticatedAndApproved: jest.fn(async () => ({ id: 'u1' })) }))
const mockUpdatePlaylistSorting = jest.fn()
jest.mock('@src/utils/watchlist/', () => ({
  validateObjectId: () => true,
  updatePlaylistSorting: (...args) => mockUpdatePlaylistSorting(...args),
}))
jest.mock('@src/utils/watchlist/database', () => ({ ensureDefaultPlaylist: jest.fn(), getPlaylistById: jest.fn() }))

const { PUT } = require('@src/app/api/authenticated/watchlist/route')
const { REVISION, stamp } = require('@src/utils/changes/revisions')

const sortPlaylist = (body) =>
  PUT(new Request('https://cinema.example/api/authenticated/watchlist?action=update-playlist-sorting', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))

const playlistId = '68eda138767b1e172b9d7a01'

it('moves the playlists stamp after a successful write', async () => {
  mockUpdatePlaylistSorting.mockResolvedValueOnce(true)
  const before = stamp(REVISION.PLAYLISTS)

  const response = await sortPlaylist({ playlistId, sortBy: 'title', sortOrder: 'asc' })

  expect(response.status).toBe(200)
  expect(stamp(REVISION.PLAYLISTS)).not.toBe(before)
})

it('leaves it alone when the write is refused or fails', async () => {
  const before = stamp(REVISION.PLAYLISTS)

  const refused = await sortPlaylist({ playlistId, sortBy: 'nonsense', sortOrder: 'asc' })
  mockUpdatePlaylistSorting.mockResolvedValueOnce(false)
  const failed = await sortPlaylist({ playlistId, sortBy: 'title', sortOrder: 'asc' })

  expect(refused.status).toBe(400)
  expect(failed.ok).toBe(false)
  expect(stamp(REVISION.PLAYLISTS)).toBe(before)
})
