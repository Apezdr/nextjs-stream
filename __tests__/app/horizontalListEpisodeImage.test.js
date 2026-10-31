/**
 * @jest-environment node
 *
 * Watch History episode cards show the episode's thumbnail as their poster;
 * the blurhash must be that image's, not the show poster's, and `thumbnail`
 * names the image only when it is the episode's own.
 */

jest.mock('@src/utils/routeAuth', () => ({ isAuthenticatedAndApproved: jest.fn(async () => ({ id: 'user-1' })) }))
const mockRecentlyWatched = jest.fn()
jest.mock('@src/utils/flatDatabaseUtils', () => ({ getFlatRecentlyWatchedForUser: (...args) => mockRecentlyWatched(...args) }))
jest.mock('@src/utils/flatRecommendations', () => ({ getFlatRecommendations: jest.fn() }))
jest.mock('@src/utils/watchHistoryUtils', () => ({ addWatchHistoryToItemsBounded: jest.fn(async (items) => items) }))
jest.mock('@src/utils/watchlist', () => ({}))
jest.mock('@src/utils/backendAuth', () => ({ getBackendAuthHeaders: jest.fn(async () => ({})) }))
jest.mock('@src/utils/auth_utils', () => ({
  sanitizeCardItems: (items) => items.map((item) => ({ ...item })),
  sanitizeCardData: (item) => ({ ...item }),
}))
jest.mock('@src/utils/cache/horizontalListData', () => ({
  getCachedMovieWindow: jest.fn(),
  getCachedTVWindow: jest.fn(),
  getCachedRecentlyAddedWindow: jest.fn(),
  getCachedAllMediaWindow: jest.fn(),
}))

const { GET } = require('@src/app/api/authenticated/horizontal-list/route')

const SHOW_POSTER = 'https://files.test/tv/Show/show_poster.jpg'
const THUMB = 'https://files.test/tv/Show/Season 1/01 - Thumbnail.jpg'

async function firstCard(item) {
  // Rows carry their place in the whole list (see splitWindowByPosition)
  mockRecentlyWatched.mockResolvedValue([{ ...item, __listPosition: 0 }])
  const response = await GET(new Request('https://cinema.example/api/authenticated/horizontal-list?type=recentlyWatched&page=0&limit=10'))
  const body = await response.json()
  return body.currentItems[0]
}

test("an episode's thumbnail brings its own blurhash onto the card", async () => {
  const card = await firstCard({
    id: 'e1',
    type: 'tv',
    title: 'Show',
    posterURL: SHOW_POSTER,
    posterBlurhash: 'SHOW-POSTER-BLUR',
    episodeData: { seasonNumber: 1, episodeNumber: 1, thumbnail: THUMB, thumbnailBlurhash: 'THUMB-BLUR' },
    metadata: {},
  })

  expect(card.posterURL).toBe(THUMB)
  expect(card.posterBlurhash).toBe('THUMB-BLUR')
  expect(card.thumbnail).toBe(THUMB)
})

test('an episode with no image of its own keeps the show poster, and claims no thumbnail', async () => {
  const card = await firstCard({
    id: 'e2',
    type: 'tv',
    title: 'Show',
    posterURL: SHOW_POSTER,
    posterBlurhash: 'SHOW-POSTER-BLUR',
    episode: { seasonNumber: 1, episodeNumber: 2, metadata: {} },
    metadata: {},
  })

  expect(card.posterURL).toBe(SHOW_POSTER)
  expect(card.posterBlurhash).toBe('SHOW-POSTER-BLUR')
  expect(card.thumbnail).toBeUndefined()
})
