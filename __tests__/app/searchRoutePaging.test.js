/**
 * @jest-environment node
 *
 * POST /api/authenticated/search pages its results. A typed query used to send
 * every match at once ("the": 336 results, 3.8 MB), movies before shows, and
 * ran the typed text as a regular expression, so "(" answered 500. The query
 * is now matched literally; movies and shows are ranked together (best match
 * first, then A-Z) and paged in the database; `types` limits them to movies
 * or shows; the response carries `total` and `hasNextPage`. Checked against
 * MongoDB 8.3 with seeded titles when written: each title once across the
 * pages, hidden titles left out, ranks and filters as below.
 */

const mockAggregate = jest.fn()
jest.mock('@src/lib/mongodb', () => ({
  __esModule: true,
  default: Promise.resolve({
    db: () => ({
      collection: (name) => ({ aggregate: (pipeline, options) => ({ toArray: () => mockAggregate(name, pipeline, options) }) }),
    }),
  }),
}))
jest.mock('@src/utils/routeAuth', () => ({
  __esModule: true,
  default: jest.fn(async () => ({ id: 'user-1' })),
  isAuthenticatedAndApproved: jest.fn(async () => ({ id: 'user-1' })),
}))
const mockRecentlyAdded = jest.fn()
jest.mock('@src/utils/flatDatabaseUtils', () => ({
  addCustomUrlToFlatMedia: jest.fn(async (items, type) => items.map((item) => ({ ...item, type, url: `/list/${type}/${item.originalTitle}` }))),
  getFlatRecentlyAddedMedia: (...args) => mockRecentlyAdded(...args),
}))
jest.mock('@src/utils/auth_utils', () => ({
  ...jest.requireActual('@src/utils/auth_utils'),
  sanitizeRecord: jest.fn(async (record) => record),
}))

const { POST } = require('@src/app/api/authenticated/search/route')
const { SEARCH_LIMIT_DEFAULT, SEARCH_LIMIT_MAX, matchRanks } = require('@src/utils/search/searchQuery')
const { TITLE_COLLATION } = require('@src/utils/mediaListUtils/listOrder')

const post = (body) =>
  POST(new Request('https://cinema.example/api/authenticated/search', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }))

const page = (items, total) => [{ items, total: total === null ? [] : [{ count: total }] }]
const call = (n = 0) => {
  const [collection, pipeline, options] = mockAggregate.mock.calls[n]
  return { collection, pipeline, options }
}
const stage = (pipeline, name) => pipeline.find((s) => name in s)?.[name]

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'error').mockImplementation(() => {})
  mockAggregate.mockResolvedValue(page([], 0))
})
afterEach(() => jest.restoreAllMocks())

it('matches the typed text literally, trimmed, in movies and shows', async () => {
  await post({ query: '  (a+b).* ' })

  const { collection, pipeline } = call()
  const escaped = '\\(a\\+b\\)\\.\\*'
  expect(collection).toBe('FlatMovies')
  expect(pipeline[0].$match.$and[0]).toEqual({ title: { $regex: escaped, $options: 'i' } })
  const shows = stage(pipeline, '$unionWith')
  expect(shows.coll).toBe('FlatTVShows')
  expect(shows.pipeline[0].$match.$and[0]).toEqual({ title: { $regex: escaped, $options: 'i' } })
  const branches = pipeline.find((s) => s.$addFields?.matchRank).$addFields.matchRank.$switch.branches
  expect(branches.map((b) => b.case.$regexMatch.regex)).toEqual(matchRanks(escaped))
})

it('ranks the best match first, then A-Z as the lists sort titles, then _id', async () => {
  await post({ query: 'the' })

  const { pipeline, options } = call()
  expect(stage(pipeline, '$sort')).toEqual({ matchRank: 1, title: 1, _id: 1 })
  expect(options).toEqual({ collation: TITLE_COLLATION })
})

it('names the ranks from an exact title to a later word', () => {
  const ranks = matchRanks('star').map((regex) => new RegExp(regex, 'i'))
  const rank = (title) => {
    const index = ranks.findIndex((r) => r.test(title))
    return index === -1 ? ranks.length : index
  }

  expect(['Star', 'The Star', 'Star Wars', 'Stardust', 'Lone Star', 'The Last Starfighter', 'Mustard'].map(rank)).toEqual([
    0, 0, 1, 2, 3, 4, 5,
  ])
})

it('searches only movies or only shows when asked', async () => {
  await post({ query: 'star', types: ['movie'] })
  await post({ query: 'star', types: ['tv'] })

  expect(call(0).collection).toBe('FlatMovies')
  expect(stage(call(0).pipeline, '$unionWith')).toBeUndefined()
  expect(call(1).collection).toBe('FlatTVShows')
  expect(stage(call(1).pipeline, '$unionWith')).toBeUndefined()
  expect(call(1).pipeline.find((s) => s.$addFields?.searchType).$addFields.searchType).toBe('tv')
})

it('refuses types that name nothing known', async () => {
  for (const types of [[], ['music'], 'movie', [1]]) {
    expect((await post({ query: 'star', types })).status).toBe(400)
  }
  expect(mockAggregate).not.toHaveBeenCalled()
})

it('pages with page and limit, 30 by default and at most 50', async () => {
  expect([SEARCH_LIMIT_DEFAULT, SEARCH_LIMIT_MAX]).toEqual([30, 50])

  await post({ query: 'the' })
  await post({ query: 'the', page: 2, limit: 50 })
  await post({ query: 'the', page: -3, limit: 500 })
  await post({ query: 'the', page: 'x', limit: 'y' })

  const windows = mockAggregate.mock.calls.map(([, pipeline]) => stage(pipeline, '$facet').items.slice(0, 2))
  expect(windows).toEqual([
    [{ $skip: 0 }, { $limit: 30 }],
    [{ $skip: 100 }, { $limit: 50 }],
    [{ $skip: 0 }, { $limit: 50 }],
    [{ $skip: 0 }, { $limit: 30 }],
  ])
})

it('answers results, total and whether another page follows', async () => {
  const items = [
    { _id: 'm1', title: 'The A', originalTitle: 'The A', searchType: 'movie' },
    { _id: 's1', title: 'The B', originalTitle: 'The B', searchType: 'tv' },
  ]
  mockAggregate.mockResolvedValueOnce(page(items, 131)).mockResolvedValueOnce(page(items, 131))

  const middle = await (await post({ query: 'the', page: 3 })).json()
  const last = await (await post({ query: 'the', page: 4 })).json()

  expect(middle.total).toBe(131)
  expect(middle.hasNextPage).toBe(true)
  expect(last.hasNextPage).toBe(false)
  expect(middle.results.map((r) => [r._id, r.type, r.url])).toEqual([
    ['m1', 'movie', '/list/movie/The A'],
    ['s1', 'tv', '/list/tv/The B'],
  ])
  expect(middle.results[0].searchType).toBeUndefined()
})

it('answers an empty page when nothing matches', async () => {
  mockAggregate.mockResolvedValueOnce(page([], null))

  expect(await (await post({ query: 'zzz' })).json()).toEqual({ results: [], total: 0, hasNextPage: false })
})

it('pages Recently Added for the empty query, filtered like a search', async () => {
  mockRecentlyAdded.mockImplementation(async ({ countOnly }) => (countOnly ? 100 : [{ _id: 'r1' }]))

  const body = await (await post({ query: '   ', page: 1, limit: 50, isTVdevice: true })).json()
  await post({ query: '', types: ['tv'] })

  expect(mockAggregate).not.toHaveBeenCalled()
  expect(mockRecentlyAdded).toHaveBeenCalledWith({ page: 1, limit: 50, shouldExposeAdditionalData: true, types: ['movie', 'tv'] })
  expect(mockRecentlyAdded).toHaveBeenCalledWith({ countOnly: true, types: ['movie', 'tv'] })
  expect(mockRecentlyAdded).toHaveBeenCalledWith({ countOnly: true, types: ['tv'] })
  expect(body).toEqual({ results: [{ _id: 'r1' }], total: 100, hasNextPage: false })
})

it('refuses a query that is not a string, and a body that is not JSON', async () => {
  expect((await post({ query: { $ne: '' } })).status).toBe(400)
  expect((await post('not json')).status).toBe(400)
  expect(mockAggregate).not.toHaveBeenCalled()
})

it('answers 500 when the database fails', async () => {
  mockAggregate.mockRejectedValueOnce(new Error('down'))

  const response = await post({ query: 'the' })
  expect(response.status).toBe(500)
  expect(await response.json()).toEqual({ error: 'Internal Server Error' })
})
