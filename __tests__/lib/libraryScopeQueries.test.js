/**
 * @jest-environment node
 *
 * The list, count, search, genre and recommendation readers, run against a
 * database that records every query: with the whole library they send the
 * queries they always did (no scope in them), and with a restricted access
 * every query they send to the library's collections carries the scope. A
 * reader whose scope filter was dropped fails here, not just one that forgot
 * to take an access.
 */

const mockCalls = []
function mockCollection(name) {
  const record = (op, query) => mockCalls.push({ name, op, query })
  const cursor = {
    sort: () => cursor,
    skip: () => cursor,
    limit: () => cursor,
    project: () => cursor,
    collation: () => cursor,
    toArray: async () => [],
  }
  return {
    find: (filter) => {
      record('find', filter)
      return cursor
    },
    findOne: async (filter) => {
      record('findOne', filter)
      return null
    },
    countDocuments: async (filter) => {
      record('count', filter)
      return 0
    },
    aggregate: (pipeline) => {
      record('aggregate', pipeline)
      return { toArray: async () => [] }
    },
    distinct: async (field, filter) => {
      record('distinct', filter)
      return []
    },
  }
}
jest.mock('@src/lib/mongodb', () => ({
  __esModule: true,
  default: Promise.resolve({ db: () => ({ collection: (name) => mockCollection(name) }) }),
}))
const mockViewer = { access: null }
jest.mock('@src/lib/roles/gates', () => ({ approvedGate: { route: async () => ({ id: '64b7f0c2a1b2c3d4e5f60718' }) } }))
jest.mock('@src/lib/roles/libraryAccess', () => ({ libraryAccessFor: async () => mockViewer.access }))
jest.mock('@src/utils/watchHistory/database', () => ({
  findPlaybackForUser: async () => [{ videoId: 'https://f/watched.mp4', mediaType: 'movie' }],
  getAllPlaybackEntries: async () => [],
}))

const { FULL_LIBRARY } = require('@src/lib/roles/libraryScope')
const db = require('@src/utils/flatDatabaseUtils')
const movies = require('@src/utils/mediaListUtils/movieListQueries')
const tv = require('@src/utils/mediaListUtils/tvListQueries')
const recommendations = require('@src/utils/flatRecommendations')
const { POST: search } = require('@src/app/api/authenticated/search/route')

// A restricted access whose every part is recognisable in a query
const MOVIE_PICK = 'Scope Marker Movie (2001)'
const SHOW_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const SCOPED = {
  id: 'scope-test',
  scope: { movieRatingCap: 'PG', tvRatingCap: null, titles: [{ mediaType: 'movie', originalTitle: MOVIE_PICK, access: 'play' }] },
  showIds: [SHOW_ID],
}
const LIBRARY = ['FlatMovies', 'FlatTVShows', 'FlatSeasons', 'FlatEpisodes']
const marks = (query, name) => {
  const text = JSON.stringify(query)
  return name === 'FlatMovies' ? text.includes(MOVIE_PICK) : text.includes(SHOW_ID)
}

async function queriesOf(run, access) {
  mockCalls.length = 0
  mockViewer.access = access
  await run(access)
  return mockCalls.filter((call) => LIBRARY.includes(call.name))
}

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

const searchFor = (query, types) =>
  search(new Request('https://x/api/authenticated/search', { method: 'POST', body: JSON.stringify({ query, types }) }))

describe.each([
  ['movie posters (rows)', (access) => db.getFlatPosters('movie', false, 1, 15, {}, { access })],
  ['show posters (rows)', (access) => db.getFlatPosters('tv', false, 1, 15, {}, { access })],
  ['the TV list window', (access) => db.getFlatTVList({ access, limit: 10 })],
  ['recently added', (access) => db.getFlatRecentlyAddedMedia({ access, limit: 10 })],
  ['the movie count', (access) => db.getFlatAvailableMoviesCount(access)],
  ['the show and episode counts', (access) => db.getFlatAvailableTVShowsCount(access)],
  ['the banner', (access) => db.queryBannerMovies(access)],
  ['the movie list page', (access) => movies.getFilteredMovieList({ access, genres: ['Drama'] })],
  ['the movie list count', (access) => movies.getFilteredMovieCount({ access })],
  ['the movie list filters', (access) => movies.getMovieFilterOptions(access)],
  ['the TV list page', (access) => tv.getFilteredTVList({ access })],
  ['the TV list count', (access) => tv.getFilteredTVCount({ access })],
  ['the TV list filters', (access) => tv.getTVFilterOptions(access)],
  ['the genres', (access) => db.getFlatAvailableGenres({ access, type: 'all' })],
  ['the content of a genre', (access) => db.getFlatContentByGenres({ access, genres: ['Drama'], type: 'all' })],
  ['the genre count', (access) => db.getFlatContentByGenres({ access, genres: ['Drama'], countOnly: true })],
  ['random recommendations', (access) => recommendations.getFlatRandomRecommendations(0, 10, false, null, access)],
  ['search', () => searchFor('heat', ['movie', 'tv'])],
  ['search with no query (recently added)', () => searchFor('', ['movie', 'tv'])],
])('%s', (_name, run) => {
  it('sends the queries it always did for the whole library, with no scope in them', async () => {
    const queries = await queriesOf(run, FULL_LIBRARY)
    expect(queries.length).toBeGreaterThan(0)
    expect(queries.filter((call) => marks(call.query, call.name))).toEqual([])
  })

  it('holds every query it sends to the library to a restricted scope', async () => {
    const queries = await queriesOf(run, SCOPED)
    expect(queries.length).toBeGreaterThan(0)
    expect(queries.filter((call) => !marks(call.query, call.name)).map(({ name, op }) => `${name}.${op}`)).toEqual([])
  })
})

it('genre recommendations look for unwatched titles in the scope only', async () => {
  const queries = await queriesOf(
    (access) => recommendations.getFlatGenreBasedRecommendations('64b7f0c2a1b2c3d4e5f60718', 0, 10, false, null, access),
    SCOPED
  )
  // The user's own watched titles, read for their genre profile, are never sent:
  // the candidates are what reaches them, and those are scoped
  const candidates = queries.filter((call) => call.op === 'find' && JSON.stringify(call.query).includes('$nin'))
  expect(candidates.every((call) => marks(call.query, call.name))).toBe(true)
})
