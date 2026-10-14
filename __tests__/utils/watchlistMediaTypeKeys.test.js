/**
 * @jest-environment node
 *
 * TMDB ids repeat across media types: movie 1399 and show 1399 are different
 * titles. The watchlist's lookups used to key on the number alone, so with
 * both on one playlist a card could take the other title's library entry or
 * Coming Soon, and a movie arriving in the library deleted the show's Coming
 * Soon. Each title is now looked up as `${mediaType}:${tmdbId}`.
 */

const mockDb = { movies: [], shows: [], comingSoon: [] }

const inLibrary = (documents, query) => {
  const ids = query.$and[0]['metadata.id'].$in
  return documents.filter((document) => ids.includes(document.metadata.id))
}
const matches = (document, condition) =>
  Object.entries(condition).every(([field, value]) =>
    value && value.$in ? value.$in.includes(document[field]) : document[field] === value
  )
const mockCollections = {
  FlatMovies: { find: (query) => ({ toArray: async () => inLibrary(mockDb.movies, query) }) },
  FlatTVShows: { find: (query) => ({ toArray: async () => inLibrary(mockDb.shows, query) }) },
  ComingSoon: {
    createIndex: async () => {},
    find: (query) => ({
      toArray: async () =>
        query.$or ? mockDb.comingSoon.filter((doc) => query.$or.some((c) => matches(doc, c))) : mockDb.comingSoon,
    }),
    deleteMany: async (filter) => {
      const gone = mockDb.comingSoon.filter((doc) => filter.$or.some((c) => matches(doc, c)))
      mockDb.comingSoon = mockDb.comingSoon.filter((doc) => !gone.includes(doc))
      return { deletedCount: gone.length }
    },
  },
}

jest.mock('@src/lib/mongodb', () => ({
  __esModule: true,
  default: Promise.resolve({ db: () => ({ collection: (name) => mockCollections[name] }) }),
}))
jest.mock('@src/lib/cachedAuth.js', () => ({ getSession: jest.fn() }))
jest.mock('@src/lib/userQueries', () => ({ userQueries: {} }))

const mockBatchResolveMedia = jest.fn()
jest.mock('@src/utils/watchlist/mediaResolver.js', () => ({
  batchResolveMedia: (...args) => mockBatchResolveMedia(...args),
}))

const { bulkGetComingSoonStatus, cleanExpiredComingSoon, getMinimalCardDataForPlaylist } = require('@src/utils/watchlist/database')

// Game of Thrones is show 1399; movie 1399 is a different title.
const show = { _id: 'show-doc', type: 'tvShow', title: 'Game of Thrones', originalTitle: 'Game of Thrones', metadata: { id: 1399 } }
const watchlistItem = (mediaType, extra = {}) => ({
  _id: `w-${mediaType}`,
  tmdbId: 1399,
  mediaType,
  dateAdded: new Date('2026-10-01'),
  ...extra,
})

beforeEach(() => {
  jest.clearAllMocks()
  mockDb.movies = []
  mockDb.shows = []
  mockDb.comingSoon = []
  jest.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => jest.restoreAllMocks())

test('a movie and a show sharing a TMDB number each get their own card', async () => {
  mockDb.shows = [show]
  mockDb.comingSoon = [{ tmdbId: 1399, mediaType: 'movie', comingSoonDate: new Date('2026-12-25') }]
  mockBatchResolveMedia.mockResolvedValue(
    new Map([['movie:1399', { tmdbId: 1399, mediaType: 'movie', title: 'The Film', posterURL: '/film.jpg' }]])
  )

  const cards = await getMinimalCardDataForPlaylist([watchlistItem('movie'), watchlistItem('tv')])

  const film = cards.find((card) => card.watchlistId === 'w-movie')
  const series = cards.find((card) => card.watchlistId === 'w-tv')
  expect(film).toMatchObject({ isAvailable: false, title: 'The Film', comingSoon: true })
  expect(series).toMatchObject({ isAvailable: true, title: 'Game of Thrones', comingSoon: false, type: 'tv' })
  // Only the movie needed TMDB: the show is in the library.
  expect(mockBatchResolveMedia).toHaveBeenCalledWith([{ tmdbId: 1399, mediaType: 'movie' }], expect.anything())
})

test('custom order and date order follow each card’s own watchlist item', async () => {
  mockDb.shows = [show]
  mockBatchResolveMedia.mockResolvedValue(new Map([['movie:1399', { tmdbId: 1399, mediaType: 'movie', title: 'The Film' }]]))
  const items = [
    watchlistItem('movie', { dateAdded: new Date('2026-10-02') }),
    watchlistItem('tv', { dateAdded: new Date('2026-10-01') }),
  ]

  const custom = await getMinimalCardDataForPlaylist(items, { sortBy: 'custom', customOrder: ['w-tv', 'w-movie'] })
  expect(custom.map((card) => card.watchlistId)).toEqual(['w-tv', 'w-movie'])

  const newestFirst = await getMinimalCardDataForPlaylist(items, { sortBy: 'dateAdded', sortOrder: 'desc' })
  expect(newestFirst.map((card) => card.watchlistId)).toEqual(['w-movie', 'w-tv'])
})

test('Coming Soon lookups keep the two titles apart', async () => {
  mockDb.comingSoon = [{ tmdbId: 1399, mediaType: 'tv', notes: 'season 9' }]
  const statuses = await bulkGetComingSoonStatus([
    { tmdbId: 1399, mediaType: 'movie' },
    { tmdbId: 1399, mediaType: 'tv' },
  ])
  expect([...statuses.keys()]).toEqual(['tv:1399'])
})

test('a movie arriving clears its own Coming Soon, not the show’s that shares its number', async () => {
  mockDb.movies = [{ metadata: { id: 1399 } }]
  mockDb.comingSoon = [
    { tmdbId: 1399, mediaType: 'movie' },
    { tmdbId: 1399, mediaType: 'tv' },
  ]

  await expect(cleanExpiredComingSoon()).resolves.toBe(1)
  expect(mockDb.comingSoon).toEqual([{ tmdbId: 1399, mediaType: 'tv' }])
})
