/**
 * @jest-environment node
 *
 * batchResolveMedia keys its answers by type and TMDB id, so a movie and a
 * show sharing a TMDB number resolve to their own titles: one from the
 * library, the other from TMDB, neither overwriting the other.
 */

const mockLibrary = { movies: [], shows: [] }
const mockLibraryQueries = []
// Titles are asked for by TMDB id, by library id, or (both kinds on one list) either
const asked = (document, condition) =>
  condition.$or
    ? condition.$or.some((arm) => asked(document, arm))
    : condition['metadata.id']
      ? condition['metadata.id'].$in.includes(document.metadata?.id)
      : condition.mediaId.$in.includes(document.mediaId)
const inLibrary = (documents, query) => {
  mockLibraryQueries.push(query.$and[0])
  return documents.filter((document) => asked(document, query.$and[0]))
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
const { FULL_LIBRARY } = require('@src/lib/roles/libraryScope')

beforeEach(() => {
  mockLibrary.movies = []
  mockLibrary.shows = []
  mockLibraryQueries.length = 0
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
  ], { access: FULL_LIBRARY })

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
    { access: FULL_LIBRARY, precomputedAvailability: new Set(['tv:1399']) }
  )

  expect(resolved.get('movie:1399')).toMatchObject({ title: 'The Film', isExternal: true })
  expect(resolved.get('tv:1399')).toMatchObject({ title: 'Game of Thrones', isInternal: true })
})

describe('a library title with no TMDB id', () => {
  const SINTEL = 'mid:e31a15704f374ca9'
  const sintel = {
    _id: { toString: () => 'sintel-doc' },
    mediaId: SINTEL,
    title: 'Sintel',
    originalTitle: 'Sintel',
    posterURL: 'https://files.example/media/movies/Sintel/poster.jpg',
    posterBlurhash: 'iVBORw0KGgo',
    metadata: { release_date: '2010-09-30' },
  }

  test('resolves from the library under its library id, with no TMDB lookup', async () => {
    mockLibrary.movies = [sintel]

    const resolved = await batchResolveMedia([{ libraryMediaId: SINTEL, mediaType: 'movie' }], { access: FULL_LIBRARY })

    expect(mockLibraryQueries).toEqual([{ mediaId: { $in: [SINTEL] } }])
    expect(resolved.get(`movie:${SINTEL}`)).toMatchObject({
      tmdbId: null,
      libraryMediaId: SINTEL,
      mediaType: 'movie',
      currentMediaId: 'sintel-doc',
      title: 'Sintel',
      releaseDate: '2010-09-30',
      posterBlurhash: 'iVBORw0KGgo',
      isInternal: true,
      url: '/list/movie/Sintel',
    })
    expect(resolved.size).toBe(1)
    expect(mockFetchTmdb).not.toHaveBeenCalled()
  })

  test('that has left the library resolves to the placeholder that says so, never to TMDB', async () => {
    const resolved = await batchResolveMedia([{ libraryMediaId: SINTEL, mediaType: 'movie' }], { access: FULL_LIBRARY })

    expect(resolved.get(`movie:${SINTEL}`)).toMatchObject({
      libraryMissing: true,
      libraryMediaId: SINTEL,
      tmdbId: null,
      title: 'No longer in the library',
      isAvailable: false,
      url: null,
    })
    expect(mockFetchTmdb).not.toHaveBeenCalled()
  })

  test('is the movie it was added as: a show under the same library id is another title', async () => {
    mockLibrary.shows = [{ ...sintel, _id: { toString: () => 'show-doc' }, title: 'A Show' }]

    const resolved = await batchResolveMedia([{ libraryMediaId: SINTEL, mediaType: 'movie' }], { access: FULL_LIBRARY })

    expect(resolved.get(`movie:${SINTEL}`)).toMatchObject({ libraryMissing: true })
    expect(resolved.has(`tv:${SINTEL}`)).toBe(false)
  })

  test('carries the TMDB id it has been given since, the item’s cue to move to the TMDB key', async () => {
    mockLibrary.movies = [{ ...sintel, metadata: { id: 45745, release_date: '2010-09-30' } }]

    const resolved = await batchResolveMedia([{ libraryMediaId: SINTEL, mediaType: 'movie' }], { access: FULL_LIBRARY })

    expect(resolved.get(`movie:${SINTEL}`)).toMatchObject({ tmdbId: 45745, libraryMediaId: SINTEL, isInternal: true })
  })

  test('sits on one list with TMDB titles: one library read for both kinds, TMDB only for the title it lacks', async () => {
    mockLibrary.movies = [sintel, { _id: { toString: () => 'matrix-doc' }, title: 'The Matrix', originalTitle: 'The Matrix (1999)', metadata: { id: 603 } }]
    mockFetchTmdb.mockResolvedValue({ data: { id: 920, title: 'Cars' } })

    const resolved = await batchResolveMedia(
      [
        { libraryMediaId: SINTEL, mediaType: 'movie' },
        { tmdbId: 603, mediaType: 'movie' },
        { tmdbId: 920, mediaType: 'movie' },
      ],
      { access: FULL_LIBRARY }
    )

    expect(mockLibraryQueries).toEqual([{ $or: [{ 'metadata.id': { $in: [603, 920] } }, { mediaId: { $in: [SINTEL] } }] }])
    expect(resolved.get(`movie:${SINTEL}`)).toMatchObject({ title: 'Sintel', isInternal: true })
    expect(resolved.get('movie:603')).toMatchObject({ title: 'The Matrix', isInternal: true })
    expect(resolved.get('movie:603')).not.toHaveProperty('libraryMediaId')
    expect(resolved.get('movie:920')).toMatchObject({ title: 'Cars', isExternal: true })
    expect(mockFetchTmdb).toHaveBeenCalledTimes(1)
  })

  test('precomputed availability decides it without a read: not listed means gone', async () => {
    mockLibrary.movies = [sintel]

    const resolved = await batchResolveMedia(
      [{ libraryMediaId: SINTEL, mediaType: 'movie' }],
      { access: FULL_LIBRARY, precomputedAvailability: new Set() }
    )

    expect(mockLibraryQueries).toEqual([])
    expect(resolved.get(`movie:${SINTEL}`)).toMatchObject({ libraryMissing: true })
  })
})
