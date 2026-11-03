/**
 * @jest-environment node
 *
 * Every read that sends library titles to a viewer is held to the viewer's
 * library scope (src/lib/roles/libraryScope.ts), the way every admin page
 * calls adminGate.page() (roleGates.test.js):
 *
 * - Outside the sync, nothing calls the visibility fragments
 *   (visibleMovieFilter and co.) directly: those are the same for everyone,
 *   and a viewer's read uses library*Filter(access), visible AND in scope.
 * - Every file outside the sync and the admin surfaces that reads a Flat*
 *   collection uses a scope primitive (library*Filter, scope*Filter,
 *   scopeMatcher), or is listed below with the reason it needs none.
 * - The shared readers refuse to run without a LibraryAccess: a read that
 *   lost its viewer fails, it never widens to the whole library.
 *
 * A new reader fails the second check until it filters by the scope, or
 * until it is listed here with a reason someone can check.
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const SRC = path.join(ROOT, 'src')

/** Where the scope doesn't apply: the sync writes the library, admins see all of it. */
const EXEMPT_DIRS = [
  'src/utils/sync/',
  'src/utils/admin/',
  'src/components/Admin/',
  'src/app/(styled)/admin/',
  'src/app/api/authenticated/admin/',
  'src/app/api/authenticated/[...admin]/',
]

/** Files that read Flat* collections for no viewer, or only what was already scoped. */
const NO_VIEWER = {
  'src/utils/mediaActivity.js':
    'the now-playing feed for the service key of the media-activity routes (the owner’s own displays); no viewer session',
  'src/utils/jit/overrides.js': 'reads only the JIT serve override of a document already resolved for the viewer',
  'src/utils/jit/transcoderAdmin.js': 'admin transcoder discovery: the jitUrl bases, no titles',
  'src/utils/watchHistory/mediaIdResolver.js':
    'maps a stream URL to its mediaId and runtime for the watch-history write path; sends no title',
  'src/utils/notifications/utils/MediaDataEnricher.js':
    'enriches notifications the route has already cut to the reader’s scope (notifications/scope.js)',
  'src/lib/arr/catalog.ts':
    'Radarr/Sonarr requests (arr.request, given by admins) check what the library holds; open question in the library-scopes work',
}

// Called, or handed on as a function (search's per-type table)
const SCOPE_PRIMITIVE = /\b(library(Movie|Show|Episode)Filter|scope(Movie|Show|Episode)Filter|scopeMatcher|(movie|show)ScopeFragment)\b/
const FLAT_COLLECTION = /['"`]Flat(Movies|TVShows|Seasons|Episodes)['"`]/
const VISIBILITY_CALL = /\bvisible(Movie|Show|Episode)Filter\s*\(/

const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.(js|jsx|ts|tsx|mjs)$/.test(entry.name) ? [full] : []
  })
}

const files = sourceFiles(SRC).map((file) => ({
  rel: path.relative(ROOT, file).split(path.sep).join('/'),
  code: stripComments(fs.readFileSync(file, 'utf8')),
}))
const exempt = (rel) => EXEMPT_DIRS.some((dir) => rel.startsWith(dir))

describe('the static guard', () => {
  it('finds the readers it is meant to watch', () => {
    const readers = files.filter(({ code }) => FLAT_COLLECTION.test(code)).map(({ rel }) => rel)
    expect(readers).toEqual(
      expect.arrayContaining([
        'src/utils/flatDatabaseUtils.js',
        'src/utils/watchlist/database.js',
        'src/app/api/authenticated/search/route.js',
      ])
    )
  })

  it('nothing outside the sync calls a visibility fragment directly: viewer reads use library*Filter(access)', () => {
    const direct = files
      .filter(({ rel, code }) => !rel.startsWith('src/utils/sync/') && rel !== 'src/utils/mediaVisibility.js' && VISIBILITY_CALL.test(code))
      .map(({ rel }) => rel)
    expect(direct).toEqual([])
  })

  it('every Flat* reader outside the sync and the admin surfaces filters by the viewer’s scope, or says why not', () => {
    const unscoped = files
      .filter(({ rel, code }) => !exempt(rel) && !(rel in NO_VIEWER) && FLAT_COLLECTION.test(code) && !SCOPE_PRIMITIVE.test(code))
      .map(({ rel }) => rel)
    expect(unscoped).toEqual([])
  })

  it('every listed exception still exists and still reads a Flat* collection', () => {
    for (const rel of Object.keys(NO_VIEWER)) {
      const file = files.find((entry) => entry.rel === rel)
      expect(file && FLAT_COLLECTION.test(file.code) ? rel : `${rel} (gone, or reads nothing)`).toBe(rel)
    }
  })
})

// The readers, called without a LibraryAccess. A database they reached would
// throw something else: the refusal has to come first.
jest.mock('@src/lib/mongodb', () => {
  const unreachable = () => {
    throw new Error('the database was reached')
  }
  return { __esModule: true, default: Promise.resolve({ db: unreachable }), mongoClient: { db: unreachable } }
})
jest.mock('@src/lib/cachedAuth', () => ({ getSession: jest.fn(async () => ({ user: { id: 'u1' } })) }))
jest.mock('@src/lib/cachedAuth.js', () => ({ getSession: jest.fn(async () => ({ user: { id: 'u1' } })) }))
jest.mock('@src/lib/userQueries', () => ({ userQueries: { exists: jest.fn(async () => true) } }))
jest.mock('@src/utils/tmdb/backendClient', () => ({ fetchTmdbFromBackend: jest.fn() }))

describe('the readers refuse to run without the viewer’s access', () => {
  const REFUSAL = 'needs the viewer’s LibraryAccess'
  const VALID_ID = '64b7f0c2a1b2c3d4e5f60718'
  beforeAll(() => jest.spyOn(console, 'error').mockImplementation(() => {}))

  const db = require('@src/utils/flatDatabaseUtils')
  const movies = require('@src/utils/mediaListUtils/movieListQueries')
  const tv = require('@src/utils/mediaListUtils/tvListQueries')
  const { getCreditsCatalog } = require('@src/utils/credits/catalog')
  const { getFlatRecommendations } = require('@src/utils/flatRecommendations')
  const { getUserWatchlist, getMinimalCardDataForPlaylist, findTMDBIdByMediaId } = require('@src/utils/watchlist/database')
  const { batchResolveMedia } = require('@src/utils/watchlist/mediaResolver')
  const { findLibraryTitlesByTmdbId } = require('@src/utils/media/libraryByTmdbId')

  it.each([
    ['getFlatPosters', () => db.getFlatPosters('movie', false, 1, 15, {}, {})],
    ['getFlatRecentlyWatchedForUser', () => db.getFlatRecentlyWatchedForUser({ userId: VALID_ID })],
    ['getFlatRecentlyAddedMedia', () => db.getFlatRecentlyAddedMedia({})],
    ['queryBannerMovies', () => db.queryBannerMovies()],
    ['fetchFlatRandomBannerMedia', () => db.fetchFlatRandomBannerMedia()],
    ['getFlatRequestedMedia', () => db.getFlatRequestedMedia({ type: 'movie', title: 'x' })],
    ['getFlatAvailableMoviesCount', () => db.getFlatAvailableMoviesCount()],
    ['getFlatAvailableTVShowsCount', () => db.getFlatAvailableTVShowsCount()],
    ['getFlatTVList', () => db.getFlatTVList({})],
    ['getVisibleEpisodeCountBySeason', () => db.getVisibleEpisodeCountBySeason(VALID_ID)],
    ['getFlatTVSeasonWithEpisodes', () => db.getFlatTVSeasonWithEpisodes({ showTitle: 'x', seasonNumber: 1 })],
    ['getFlatShowEpisodesForProgress', () => db.getFlatShowEpisodesForProgress(VALID_ID)],
    ['getFlatAvailableGenres', () => db.getFlatAvailableGenres({})],
    ['getFlatContentByGenres', () => db.getFlatContentByGenres({ genres: ['x'] })],
    ['getFlatGenreStatistics', () => db.getFlatGenreStatistics({})],
    ['getFlatMoviesByCollectionId', () => db.getFlatMoviesByCollectionId(1)],
    ['getFilteredMovieList', () => movies.getFilteredMovieList({})],
    ['getFilteredMovieCount', () => movies.getFilteredMovieCount({})],
    ['getMovieFilterOptions', () => movies.getMovieFilterOptions()],
    ['getFilteredTVList', () => tv.getFilteredTVList({})],
    ['getFilteredTVCount', () => tv.getFilteredTVCount({})],
    ['getTVFilterOptions', () => tv.getTVFilterOptions()],
    ['getCreditsCatalog', () => getCreditsCatalog()],
    ['getFlatRecommendations', () => getFlatRecommendations(VALID_ID)],
    ['getUserWatchlist', () => getUserWatchlist({ userId: VALID_ID })],
    ['getMinimalCardDataForPlaylist', () => getMinimalCardDataForPlaylist([{ tmdbId: 1, mediaType: 'movie' }], null, true, {})],
    ['findTMDBIdByMediaId', () => findTMDBIdByMediaId(VALID_ID, 'movie')],
    ['batchResolveMedia', () => batchResolveMedia([{ tmdbId: 1, mediaType: 'movie' }], {})],
    ['findLibraryTitlesByTmdbId', () => findLibraryTitlesByTmdbId([{ tmdbId: 1, mediaType: 'movie' }])],
  ])('%s', async (_name, call) => {
    await expect(Promise.resolve().then(call)).rejects.toThrow(REFUSAL)
  })
})
