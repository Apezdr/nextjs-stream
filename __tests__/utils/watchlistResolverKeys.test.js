/**
 * @jest-environment node
 *
 * batchResolveMedia keys its answers by type and TMDB id, so a movie and a
 * show sharing a TMDB number resolve to their own titles: one from the
 * library, the other from TMDB, neither overwriting the other.
 */

const mockLibrary = { movies: [], shows: [] }
const inLibrary = (documents, query) => {
  const ids = query.$and[0]['metadata.id'].$in
  return documents.filter((document) => ids.includes(document.metadata.id))
}
jest.mock('@src/lib/mongodb', () => ({
  __esModule: true,
  default: Promise.resolve({
    db: () => ({
      collection: (name) => ({
        find: (query) => ({
          toArray: async () => inLibrary(name === 'FlatMovies' ? mockLibrary.movies : mockLibrary.shows, query),
        }),
      }),
    }),
  }),
}))
const mockFetchTmdb = jest.fn()
jest.mock('@src/utils/tmdb/backendClient', () => ({
  fetchTmdbFromBackend: (...args) => mockFetchTmdb(...args),
}))

const { batchResolveMedia } = require('@src/utils/watchlist/mediaResolver')

beforeEach(() => {
  mockLibrary.movies = []
  mockLibrary.shows = []
  mockFetchTmdb.mockReset()
  jest.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => jest.restoreAllMocks())

test('the show from the library and the movie from TMDB, each under its own key', async () => {
  mockLibrary.shows = [{ _id: { toString: () => 'show-doc' }, title: 'Game of Thrones', originalTitle: 'Game of Thrones', metadata: { id: 1399 } }]
  mockFetchTmdb.mockResolvedValue({ data: { id: 1399, title: 'The Film' } })

  const resolved = await batchResolveMedia([
    { tmdbId: 1399, mediaType: 'movie' },
    { tmdbId: 1399, mediaType: 'tv' },
  ])

  expect(resolved.get('tv:1399')).toMatchObject({ mediaType: 'tv', title: 'Game of Thrones', isInternal: true })
  expect(resolved.get('movie:1399')).toMatchObject({ mediaType: 'movie', title: 'The Film', isExternal: true })
  // Only the movie needed TMDB; the show's library entry didn't hide it.
  expect(mockFetchTmdb).toHaveBeenCalledTimes(1)
  expect(mockFetchTmdb).toHaveBeenCalledWith('comprehensive/movie', expect.objectContaining({ tmdb_id: 1399 }), expect.anything())
})

test('precomputed availability is per type: a show in the library doesn’t make the movie available', async () => {
  mockLibrary.shows = [{ _id: { toString: () => 'show-doc' }, title: 'Game of Thrones', metadata: { id: 1399 } }]
  mockLibrary.movies = [{ _id: { toString: () => 'other' }, title: 'Should not be queried', metadata: { id: 1399 } }]
  mockFetchTmdb.mockResolvedValue({ data: { id: 1399, title: 'The Film' } })

  const resolved = await batchResolveMedia(
    [
      { tmdbId: 1399, mediaType: 'movie' },
      { tmdbId: 1399, mediaType: 'tv' },
    ],
    { precomputedAvailability: new Set(['tv:1399']) }
  )

  expect(resolved.get('movie:1399')).toMatchObject({ title: 'The Film', isExternal: true })
  expect(resolved.get('tv:1399')).toMatchObject({ title: 'Game of Thrones', isInternal: true })
})
