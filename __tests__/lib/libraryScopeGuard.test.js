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
 * - Read by read: every Flat* collection that a file outside the sync and the
 *   admin surfaces names in code has a scope primitive (library*Filter,
 *   scope*Filter, scopeMatcher and its inScope checks) near it, or a
 *   `// library-scope: <why>` note saying where its scope is applied (the
 *   caller checks the show, the query was built above). A file that reads for
 *   no viewer at all is listed below, with why.
 * - No 'use cache' function takes a LibraryAccess: across a cache boundary
 *   only its id goes (the cache key), resolved again inside.
 * - The shared readers refuse to run without a LibraryAccess: a read that
 *   lost its viewer fails, it never widens to the whole library.
 *
 * What the readers do with a restricted access, query by query, is in
 * libraryScopeQueries.test.js.
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

/** Files that read Flat* collections for no viewer, or only what was already scoped, and why. */
const NO_VIEWER = {
  'src/utils/mediaActivity.js':
    'the now-playing feed for the service key of the media-activity routes (the owner’s own displays); no viewer session',
  'src/utils/jit/overrides.js': 'reads only the JIT serve override of a document already resolved for the viewer',
  'src/utils/jit/transcoderAdmin.js': 'admin transcoder discovery: the jitUrl bases, no titles',
  'src/utils/watchHistory/mediaIdResolver.js':
    'maps a stream URL to its mediaId and runtime for the watch-history write path; sends no title',
  'src/utils/notifications/utils/MediaDataEnricher.js':
    'enriches notifications the reader’s scope already cut (notificationDatabase.js, notifications/scope.js)',
  'src/lib/arr/catalog.ts':
    'owner’s decision: a Radarr/Sonarr request (arr.request or arr.manage, given by an admin) sees whether the ' +
    'library already holds a title and which title holds its folder, whatever the requester’s library scope',
}

// Named near the read: called, or handed on as a function (search's per-type table)
const SCOPE_NEAR =
  /\b(library(Movie|Show|Episode)Filter|scope(Movie|Show|Episode)Filter|scopeMatcher|(movie|show)ScopeFragment)\b|\binScope\.|library-scope:/
const FLAT_COLLECTION = /['"`]Flat(Movies|TVShows|Seasons|Episodes)['"`]/
const VISIBILITY_CALL = /\bvisible(Movie|Show|Episode)Filter\s*\(/
/** How far around a read its scope may be applied: a query built a little above, a filter just below. */
const BEFORE = 30
const AFTER = 12

const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const isCommentLine = (line) => /^\s*(\*|\/\/|\/\*)/.test(line)

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.(js|jsx|ts|tsx|mjs)$/.test(entry.name) ? [full] : []
  })
}

const files = sourceFiles(SRC).map((file) => {
  const raw = fs.readFileSync(file, 'utf8')
  return { rel: path.relative(ROOT, file).split(path.sep).join('/'), raw, code: stripComments(raw) }
})
const exempt = (rel) => EXEMPT_DIRS.some((dir) => rel.startsWith(dir))

/** file:line of each Flat* read in code with no scope primitive or note around it. */
function unscopedReads({ rel, raw }) {
  const lines = raw.split('\n')
  return lines.flatMap((line, index) => {
    if (isCommentLine(line) || !FLAT_COLLECTION.test(line)) return []
    const around = lines.slice(Math.max(0, index - BEFORE), index + AFTER + 1).join('\n')
    return SCOPE_NEAR.test(around) ? [] : [`${rel}:${index + 1}`]
  })
}

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
      .filter(
        ({ rel, code }) =>
          !rel.startsWith('src/utils/sync/') && rel !== 'src/utils/mediaVisibility.js' && VISIBILITY_CALL.test(code)
      )
      .map(({ rel }) => rel)
    expect(direct).toEqual([])
  })

  it('every Flat* read outside the sync and the admin surfaces is held to the scope where it is made, or says where', () => {
    const unscoped = files.filter(({ rel }) => !exempt(rel) && !(rel in NO_VIEWER)).flatMap(unscopedReads)
    expect(unscoped).toEqual([])
  })

  it('catches a read whose filter was dropped, even in a file that filters elsewhere', () => {
    const filler = Array.from({ length: BEFORE + 5 }, (_, n) => `const filler${n} = ${n}`)
    const raw = [
      "const kept = await db.collection('FlatMovies').find(libraryMovieFilter(access)).toArray()",
      ...filler,
      "const dropped = await db.collection('FlatMovies').find({}).toArray()",
    ].join('\n')
    expect(unscopedReads({ rel: 'x.js', raw })).toEqual([`x.js:${filler.length + 2}`])
  })

  it('every listed exception still exists and still reads a Flat* collection', () => {
    for (const rel of Object.keys(NO_VIEWER)) {
      const file = files.find((entry) => entry.rel === rel)
      expect(file && FLAT_COLLECTION.test(file.code) ? rel : `${rel} (gone, or reads nothing)`).toBe(rel)
    }
  })

  it('no \'use cache\' function takes a LibraryAccess: it is handed the scope id', () => {
    const signature = /(?:function\s*\w*\s*\(([^)]*)\)|\(([^)]*)\)\s*=>)\s*\{\s*['"]use cache['"]/g
    const offenders = []
    for (const { rel, code } of files) {
      for (const match of code.matchAll(signature)) {
        if (/\baccess\b/.test(match[1] ?? match[2] ?? '')) offenders.push(rel)
      }
    }
    expect(offenders).toEqual([])
    // and the check sees one when there is one
    const sample = "async function Cached({ title, access }) {\n  'use cache'\n}"
    expect([...sample.matchAll(signature)].map((match) => match[1])).toEqual(['{ title, access }'])
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
  const watchlist = require('@src/utils/watchlist/database')
  const { batchResolveMedia } = require('@src/utils/watchlist/mediaResolver')
  const { findLibraryTitlesByTmdbId } = require('@src/utils/media/libraryByTmdbId')
  const notifications = require('@src/utils/notifications/notificationDatabase')

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
    ['getUserWatchlist', () => watchlist.getUserWatchlist({ userId: VALID_ID })],
    ['getUserPlaylists', () => watchlist.getUserPlaylists(VALID_ID)],
    ['getPlaylistById', () => watchlist.getPlaylistById(VALID_ID, { user: { id: VALID_ID } })],
    ['getMinimalCardDataForPlaylist', () => watchlist.getMinimalCardDataForPlaylist([{ tmdbId: 1, mediaType: 'movie' }], null, true, {})],
    ['findLibraryTitleIdentity', () => watchlist.findLibraryTitleIdentity(VALID_ID, 'movie')],
    ['batchResolveMedia', () => batchResolveMedia([{ tmdbId: 1, mediaType: 'movie' }], {})],
    ['findLibraryTitlesByTmdbId', () => findLibraryTitlesByTmdbId([{ tmdbId: 1, mediaType: 'movie' }])],
    ['getUserNotifications', () => notifications.getUserNotifications(VALID_ID, {})],
    ['getUnreadNotificationCount', () => notifications.getUnreadNotificationCount(VALID_ID)],
  ])('%s', async (_name, call) => {
    await expect(Promise.resolve().then(call)).rejects.toThrow(REFUSAL)
  })
})
