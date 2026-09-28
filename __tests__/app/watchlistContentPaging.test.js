/**
 * @jest-environment node
 */
/**
 * The TV app's watchlist pages carry the item either side of them. They were
 * asked for as `page: currentPage ± 1, limit: 1`, which skips currentPage ± 1
 * items rather than whole pages, so both were the wrong item.
 */

jest.mock('@src/utils/routeAuth', () => ({
  isAuthenticatedAndApproved: jest.fn(async () => ({ id: 'user-1' })),
  isAdmin: jest.fn(async () => false),
}))
jest.mock('@src/utils/backendAuth', () => ({ getBackendAuthHeaders: jest.fn(async () => ({})) }))
jest.mock('@src/utils/auth_utils', () => ({ sanitizeCardItems: (items) => items }))
jest.mock('@src/utils/watchHistoryUtils', () => ({ addWatchHistoryToItems: jest.fn(async (items) => items) }))

const TOTAL = 60
const mockGetUserWatchlist = jest.fn(async ({ countOnly, offset, page = 0, limit }) => {
  if (countOnly) return TOTAL
  const start = offset ?? page * limit
  return Array.from({ length: Math.min(limit, TOTAL - start) }, (_, i) => ({ id: `item-${start + i}`, title: `Item ${start + i}` }))
})
jest.mock('@src/utils/watchlist/database', () => ({
  getUserWatchlist: (...args) => mockGetUserWatchlist(...args),
  getUserPlaylists: jest.fn(),
  getPlaylistById: jest.fn(async () => ({ id: 'playlist-1', name: 'Films', sortBy: 'title', sortOrder: 'asc' })),
  getPlaylistVisibility: jest.fn(async () => null),
  getMinimalCardDataForPlaylist: jest.fn(async (items) => items),
  ensureDefaultPlaylist: jest.fn(),
}))

const { GET } = require('@src/app/api/authenticated/watchlist-content/route')

const getPage = (page) =>
  GET(new Request(`https://cinema.example/api/authenticated/watchlist-content?action=content&playlistId=playlist-1&page=${page}&limit=20`))

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => jest.restoreAllMocks())

it('carries the last item of the previous page and the first of the next', async () => {
  const body = await (await getPage(1)).json()

  expect(body.currentItems.map((item) => item.id)).toEqual(Array.from({ length: 20 }, (_, i) => `item-${20 + i}`))
  expect(body.previousItem.id).toBe('item-19')
  expect(body.nextItem.id).toBe('item-40')
  // Asked for in the playlist's own order, not a reversed one
  const neighbours = mockGetUserWatchlist.mock.calls.map(([args]) => args).filter((args) => args.limit === 1)
  expect(neighbours.map(({ offset, sortOrder }) => ({ offset, sortOrder }))).toEqual([
    { offset: 19, sortOrder: undefined },
    { offset: 40, sortOrder: undefined },
  ])
})

it('has no previous item on the first page and no next item on the last', async () => {
  const first = await (await getPage(0)).json()
  expect(first.previousItem).toBeNull()
  expect(first.nextItem.id).toBe('item-20')

  const last = await (await getPage(2)).json()
  expect(last.previousItem.id).toBe('item-39')
  expect(last.nextItem).toBeNull()
})
