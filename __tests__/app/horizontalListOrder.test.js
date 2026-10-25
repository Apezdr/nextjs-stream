/**
 * @jest-environment node
 *
 * horizontal-list's Movies and TV lists are ordered in the database before
 * paging: the route hands `sort` and `sortOrder` to the cached window and
 * leaves the page in the order it came. It used to reorder only the page in
 * hand, so page 2 of an A-Z list didn't follow page 1.
 */

jest.mock('@src/utils/routeAuth', () => ({ isAuthenticatedAndApproved: jest.fn(async () => ({ id: 'user-1' })) }))
jest.mock('@src/utils/flatDatabaseUtils', () => ({ getFlatRecentlyWatchedForUser: jest.fn() }))
jest.mock('@src/utils/flatRecommendations', () => ({ getFlatRecommendations: jest.fn() }))
jest.mock('@src/utils/watchHistoryUtils', () => ({ addWatchHistoryToItemsBounded: jest.fn(async (items) => items) }))
jest.mock('@src/utils/watchlist', () => ({}))
jest.mock('@src/utils/backendAuth', () => ({ getBackendAuthHeaders: jest.fn(async () => ({})) }))
jest.mock('@src/utils/auth_utils', () => ({
  sanitizeCardItems: (items) => items.map((item) => ({ ...item })),
  sanitizeCardData: (item) => ({ ...item }),
}))

const mockMovieWindow = jest.fn()
const mockTVWindow = jest.fn()
jest.mock('@src/utils/cache/horizontalListData', () => ({
  getCachedMovieWindow: (...args) => mockMovieWindow(...args),
  getCachedTVWindow: (...args) => mockTVWindow(...args),
  getCachedRecentlyAddedWindow: jest.fn(),
  getCachedAllMediaWindow: jest.fn(),
}))

const { GET } = require('@src/app/api/authenticated/horizontal-list/route')

const get = (query) => GET(new Request(`https://cinema.example/api/authenticated/horizontal-list?${query}`))
// A window the database ordered Z first: the route must not reorder it
const rows = (type) => ['Zulu', 'Alpha', 'Mike'].map((title, i) => ({ id: `${type}-${i}`, title, type, metadata: {} }))

beforeEach(() => {
  jest.clearAllMocks()
  mockMovieWindow.mockImplementation(async () => rows('movie'))
  mockTVWindow.mockImplementation(async () => rows('tv'))
})

it('asks the cached movie window for the list order', async () => {
  const response = await get('type=movie&sort=title&sortOrder=asc&page=1&limit=20')

  expect(response.status).toBe(200)
  expect(mockMovieWindow).toHaveBeenCalledWith(19, 22, {}, 'title', 'asc')
})

it('asks the cached TV window for the list order', async () => {
  await get('type=tv&sort=date&sortOrder=desc&page=0&limit=20')

  expect(mockTVWindow).toHaveBeenCalledWith(0, 21, 'date', 'desc')
})

it('keeps the order the database gave, not a page-local sort', async () => {
  const body = await (await get('type=movie&sort=title&sortOrder=asc&page=0&limit=3')).json()

  expect(body.currentItems.map((item) => item.title)).toEqual(['Zulu', 'Alpha', 'Mike'])
})

it('still refuses a sort it does not know', async () => {
  const response = await get('type=movie&sort=popularity&page=0&limit=20')

  expect(response.status).toBe(400)
  expect(mockMovieWindow).not.toHaveBeenCalled()
})
