/**
 * @jest-environment node
 *
 * POST /api/authenticated/media/in-library answers which TMDB titles the
 * library holds, by the rule an added watchlist item resolves with: a
 * web-visible movie or show with that TMDB id in metadata.id. The watchlist
 * search used to guess it from the first page of the library search, so a
 * library title further down was offered as TMDB-only. (The client also asked
 * a /media/find-by-tmdb route that never existed.)
 */

const mockFind = jest.fn()
jest.mock('@src/lib/mongodb', () => ({
  __esModule: true,
  default: Promise.resolve({
    db: () => ({ collection: (name) => ({ find: (query, options) => ({ toArray: () => mockFind(name, query, options) }) }) }),
  }),
}))
jest.mock('@src/utils/routeAuth', () => ({ isAuthenticatedAndApproved: jest.fn(async () => ({ id: 'user-1' })) }))

const { POST } = require('@src/app/api/authenticated/media/in-library/route')
const { visibleMovieFilter, visibleShowFilter } = require('@src/utils/mediaVisibility')

const post = (body) =>
  POST(new Request('https://cinema.example/api/authenticated/media/in-library', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }))

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'error').mockImplementation(() => {})
  mockFind.mockImplementation(async (name) =>
    name === 'FlatMovies'
      ? [{ _id: { toString: () => 'm1' }, title: 'A Film', originalTitle: 'A Film', posterURL: 'https://files.example/p.jpg', metadata: { id: 603 } }]
      : [{ _id: { toString: () => 's1' }, title: 'A Show', originalTitle: 'A Show', metadata: { id: 603, poster_path: '/s.jpg' } }]
  )
})
afterEach(() => jest.restoreAllMocks())

it('looks up each kind by TMDB id among the visible titles, and answers the matches', async () => {
  const response = await post({ items: [{ tmdbId: 603, mediaType: 'movie' }, { tmdbId: 11, mediaType: 'movie' }, { tmdbId: 603, mediaType: 'tv' }] })

  expect(response.status).toBe(200)
  const calls = Object.fromEntries(mockFind.mock.calls.map(([name, query]) => [name, query]))
  expect(calls.FlatMovies).toEqual({ $and: [{ 'metadata.id': { $in: [603, 11] } }, visibleMovieFilter()] })
  expect(calls.FlatTVShows).toEqual({ $and: [{ 'metadata.id': { $in: [603] } }, visibleShowFilter()] })

  const { items } = await response.json()
  expect(items).toEqual([
    { tmdbId: 603, mediaType: 'movie', id: 'm1', title: 'A Film', posterURL: 'https://files.example/p.jpg', link: 'A%20Film' },
    { tmdbId: 603, mediaType: 'tv', id: 's1', title: 'A Show', posterURL: expect.stringContaining('/s.jpg'), link: 'A%20Show' },
  ])
})

it('asks only the collections it needs, and nothing for an empty list', async () => {
  await post({ items: [{ tmdbId: 1, mediaType: 'tv' }] })
  expect(mockFind.mock.calls.map(([name]) => name)).toEqual(['FlatTVShows'])

  mockFind.mockClear()
  expect(await (await post({ items: [] })).json()).toEqual({ items: [] })
  expect(mockFind).not.toHaveBeenCalled()
})

it('refuses anything but a list of TMDB ids and kinds, at most 100', async () => {
  const bad = [
    {},
    { items: 'x' },
    { items: [{ tmdbId: '603', mediaType: 'movie' }] },
    { items: [{ tmdbId: 0, mediaType: 'movie' }] },
    { items: [{ tmdbId: 1, mediaType: 'person' }] },
    { items: [null] },
    { items: Array.from({ length: 101 }, (_, i) => ({ tmdbId: i + 1, mediaType: 'movie' })) },
  ]
  for (const body of bad) expect((await post(body)).status).toBe(400)
  expect((await post('not json')).status).toBe(400)
  expect(mockFind).not.toHaveBeenCalled()
})

it('answers 500 when the database fails', async () => {
  mockFind.mockRejectedValueOnce(new Error('down'))

  expect((await post({ items: [{ tmdbId: 1, mediaType: 'movie' }] })).status).toBe(500)
})
