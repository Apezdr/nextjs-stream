/**
 * @jest-environment node
 *
 * POST /api/authenticated/search pages its results. A typed query used to send
 * every match at once ("the": 336 results, 3.8 MB) and ran the typed text as a
 * regular expression, so "(" answered 500. The query is now matched literally,
 * movies and shows are ordered in the database and paged, and the response
 * carries `total` and `hasNextPage`. Checked against MongoDB 8.3 with seeded
 * titles when written: each title once across the pages, hidden titles left
 * out, titles that start with the query first, then A-Z.
 */

const mockAggregate = jest.fn()
jest.mock('@src/lib/mongodb', () => ({
  __esModule: true,
  default: Promise.resolve({
    db: () => ({ collection: () => ({ aggregate: (pipeline) => ({ toArray: () => mockAggregate(pipeline) }) }) }),
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

const { POST, SEARCH_LIMIT_DEFAULT, SEARCH_LIMIT_MAX } = require('@src/app/api/authenticated/search/route')

const post = (body) =>
  POST(new Request('https://cinema.example/api/authenticated/search', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }))

const page = (items, total) => [{ items, total: total === null ? [] : [{ count: total }] }]
const stage = (pipeline, name) => pipeline.find((s) => name in s)?.[name]
const facet = (pipeline) => stage(pipeline, '$facet').items

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'error').mockImplementation(() => {})
  mockAggregate.mockResolvedValue(page([], 0))
})
afterEach(() => jest.restoreAllMocks())

it('matches the typed text literally, trimmed, in the match and the ranking', async () => {
  await post({ query: '  (a+b).* ' })

  const pipeline = mockAggregate.mock.calls[0][0]
  const escaped = '\\(a\\+b\\)\\.\\*'
  expect(pipeline[0].$match.$and[0]).toEqual({ title: { $regex: escaped, $options: 'i' } })
  const shows = stage(pipeline, '$unionWith')
  expect(shows.coll).toBe('FlatTVShows')
  expect(shows.pipeline[0].$match.$and[0]).toEqual({ title: { $regex: escaped, $options: 'i' } })
  const ranking = pipeline.find((s) => s.$addFields?.startsWithQuery).$addFields.startsWithQuery
  expect(ranking).toEqual({ $regexMatch: { input: '$title', regex: `^${escaped}`, options: 'i' } })
})

it('orders in the database: prefix matches first, then title, then _id', async () => {
  await post({ query: 'the' })

  expect(stage(mockAggregate.mock.calls[0][0], '$sort')).toEqual({ startsWithQuery: -1, sortTitle: 1, _id: 1 })
})

it('pages with page and limit, 30 by default and at most 50', async () => {
  expect([SEARCH_LIMIT_DEFAULT, SEARCH_LIMIT_MAX]).toEqual([30, 50])

  await post({ query: 'the' })
  await post({ query: 'the', page: 2, limit: 50 })
  await post({ query: 'the', page: -3, limit: 500 })
  await post({ query: 'the', page: 'x', limit: 'y' })

  const windows = mockAggregate.mock.calls.map(([pipeline]) => facet(pipeline).slice(0, 2))
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

it('pages Recently Added for the empty query', async () => {
  mockRecentlyAdded.mockImplementation(async ({ countOnly }) => (countOnly ? 100 : [{ _id: 'r1' }]))

  const body = await (await post({ query: '   ', page: 1, limit: 50, isTVdevice: true })).json()

  expect(mockAggregate).not.toHaveBeenCalled()
  expect(mockRecentlyAdded).toHaveBeenCalledWith({ page: 1, limit: 50, shouldExposeAdditionalData: true })
  expect(mockRecentlyAdded).toHaveBeenCalledWith({ countOnly: true })
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
