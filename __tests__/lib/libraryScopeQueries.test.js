/**
 * @jest-environment node
 *
 * The list, count, search, genre and recommendation readers, run against a
 * database that records every query and answers with representative rows (so
 * the follow-on reads run too): with the whole library they send the
 * queries they always did (no scope in them), and with a restricted access
 * every query they send to the library's collections carries the scope. A
 * reader whose scope filter was dropped fails here, not just one that forgot
 * to take an access.
 */

// The database: records every query, and answers each with one representative
// row of its collection, so the follow-on reads (a show's seasons, a season's
// episodes, the joins behind recently watched) run and are recorded too. The
// rows' own ids are not the scope's, so a query carries the scope only if it
// was put there.
const mockCalls = []
const mockRows = () => {
  const { ObjectId } = require('mongodb')
  const id = (n) => new ObjectId(`bbbbbbbbbbbbbbbbbbbbbbb${n}`)
  const show = { _id: id(2), title: 'Show', originalTitle: 'Show', posterURL: '/s.jpg', metadata: { genres: [{ id: 18, name: 'Drama' }], trailer_url: 'https://yt/s', first_air_date: '2001-01-01' } }
  const season = { _id: id(3), showId: id(2), seasonNumber: 1, posterURL: '/se.jpg' }
  const episode = {
    _id: id(4), showId: id(2), seasonId: id(3), seasonNumber: 1, episodeNumber: 1, title: 'Pilot',
    videoURL: 'https://f/e.mp4', normalizedVideoId: 'nid-e', mediaId: 'mid:e', duration: 1,
    initialDiscoveryDate: new Date('2026-01-01'), mediaLastModified: new Date('2026-01-01'),
  }
  const movie = {
    _id: id(1), title: 'Film', originalTitle: 'Film (2001)', videoURL: 'https://f/m.mp4', normalizedVideoId: 'nid-m',
    mediaId: 'mid:m', duration: 1, posterURL: '/m.jpg', initialDiscoveryDate: new Date('2026-01-01'),
    metadata: { genres: [{ id: 18, name: 'Drama' }], trailer_url: 'https://yt/m', release_date: '2001-01-01' },
  }
  return { FlatMovies: movie, FlatTVShows: show, FlatSeasons: season, FlatEpisodes: episode }
}
function mockCollection(name) {
  const record = (op, query) => mockCalls.push({ name, op, query })
  const row = () => mockRows()[name]
  const rows = () => (row() ? [row()] : [])
  const cursor = {
    sort: () => cursor,
    skip: () => cursor,
    limit: () => cursor,
    project: () => cursor,
    collation: () => cursor,
    toArray: async () => rows(),
  }
  const aggregated = (pipeline) => {
    const text = JSON.stringify(pipeline)
    if (text.includes('$facet')) return [{ items: rows(), total: [{ count: 1 }] }]
    if (text.includes('"$showId"')) {
      const episode = mockRows().FlatEpisodes
      return [{ _id: episode.showId, showId: episode.showId, episodeId: episode._id, initialDiscoveryDate: new Date(), mediaLastModified: new Date() }]
    }
    if (text.includes('$unwind')) return [{ _id: 'Drama', count: 1, uniqueGenres: 1 }]
    return [{ _id: null, count: 1, totalDuration: 1 }]
  }
  return {
    find: (filter) => {
      record('find', filter)
      return cursor
    },
    findOne: async (filter) => {
      record('findOne', filter)
      return row() ?? null
    },
    countDocuments: async (filter) => {
      record('count', filter)
      return 1
    },
    aggregate: (pipeline) => {
      record('aggregate', pipeline)
      return { toArray: async () => aggregated(pipeline) }
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
jest.mock('@src/lib/userQueries', () => ({ userQueries: { exists: async () => true } }))
// The user's watch rows: a movie, an episode, and a show's trailer by its id
const mockWatchRows = () => [
  { _id: 'w1', videoId: 'https://f/m.mp4', normalizedVideoId: 'nid-m', mediaType: 'movie', mediaId: 'bbbbbbbbbbbbbbbbbbbbbbb1', lastUpdated: new Date() },
  { _id: 'w2', videoId: 'https://f/e.mp4', normalizedVideoId: 'nid-e', mediaType: 'tv', mediaId: 'mid:e', lastUpdated: new Date() },
  { _id: 'w3', videoId: 'https://yt/s', mediaType: 'tv', showId: 'bbbbbbbbbbbbbbbbbbbbbbb2', seasonNumber: 1, episodeNumber: 1, lastUpdated: new Date() },
]
jest.mock('@src/utils/watchHistory/database', () => ({
  findPlaybackForUser: async () => mockWatchRows(),
  countPlaybackForUser: async () => 3,
  getAllPlaybackEntries: async () => [],
}))
jest.mock('@src/utils/watchHistory/mediaIdResolver', () => ({ resolveMediaIdForNid: async () => null }))

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
  ['recently watched, with its joins', (access) => db.getFlatRecentlyWatchedForUser({ access, userId: '64b7f0c2a1b2c3d4e5f60718', limit: 10 })],
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
