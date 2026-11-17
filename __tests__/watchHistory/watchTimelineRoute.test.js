/**
 * @jest-environment node
 *
 * GET /api/authenticated/horizontal-list/timeline: the caller's Watch History
 * counted by calendar day, over an in-memory Media database, and the list
 * positions horizontal-list hands out when asked.
 *
 * The date strip under the Watch History row turns a date into a page with
 * these counts alone, so the cases here are the ones that would send it to
 * the wrong page: a day counted in the wrong time zone, a row the list leaves
 * out but the count keeps, another user's rows, and a card that cannot say
 * where in the list it sits.
 */

const { createMemoryMongo } = require('../helpers/memoryMongo')

const mockMongo = createMemoryMongo()
jest.mock('@src/lib/mongodb', () => ({ __esModule: true, default: Promise.resolve(mockMongo.client) }))

const mockGate = jest.fn()
jest.mock('@src/lib/roles/gates', () => ({ approvedGate: { route: (...args) => mockGate(...args) } }))
const mockLog = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
jest.mock('@src/lib/logger', () => ({ __esModule: true, createLogger: () => mockLog }))
// The proxy's own collaborators (it is only asked what it does to Cache-Control)
jest.mock('@src/lib/auth', () => ({ auth: { api: { getSession: jest.fn() } } }))
jest.mock('@src/utils/config', () => ({ getAllServers: () => [] }))

// horizontal-list's collaborators: the list itself is handed in by each test
const mockRecentlyWatched = jest.fn()
jest.mock('@src/utils/flatDatabaseUtils', () => ({
  getFlatRecentlyWatchedForUser: (...args) => mockRecentlyWatched(...args),
  generateNormalizedVideoId: jest.fn(),
}))
jest.mock('@src/utils/flatRecommendations', () => ({ getFlatRecommendations: jest.fn() }))
jest.mock('@src/utils/watchHistoryUtils', () => ({ addWatchHistoryToItemsBounded: jest.fn(async (items) => items) }))
jest.mock('@src/utils/watchlist', () => ({}))
jest.mock('@src/utils/backendAuth', () => ({ getBackendAuthHeaders: jest.fn(async () => ({})) }))
jest.mock('@src/utils/cache/horizontalListData', () => ({}))
jest.mock('@src/utils/auth_utils', () => ({
  // As the real one: a new object with the card's fields only, or null
  sanitizeCardItems: (items) => items.map((item) => (item.broken ? null : { id: item.id, title: item.title })).filter(Boolean),
  sanitizeCardData: (item) => (item.broken ? null : { id: item.id, title: item.title }),
}))

const { GET } = require('@src/app/api/authenticated/horizontal-list/timeline/route')
const { GET: getList } = require('@src/app/api/authenticated/horizontal-list/route')
const { isTimeZone } = require('@src/utils/watchHistory/timeline')
const { NextRequest } = require('next/server')
const { proxy } = require('@src/proxy')

const USER = '507f1f77bcf86cd799439011'
const OTHER = '507f1f77bcf86cd7994390aa'
const URL_TIMELINE = 'https://app.example/api/authenticated/horizontal-list/timeline'

const history = () => mockMongo.collection('Media', 'WatchHistory')
let nextRow = 1
const watched = (iso, overrides = {}) => {
  history().docs.push({ _id: `row-${nextRow++}`, userId: USER, lastUpdated: iso, ...overrides })
}
const get = (query = 'tz=UTC', headers = {}) => GET(new Request(`${URL_TIMELINE}?${query}`, { headers }))

beforeEach(() => {
  jest.clearAllMocks()
  history().docs.length = 0
  mockGate.mockImplementation(async () => ({ id: USER }))
})

describe('the days', () => {
  it('counts titles by day, newest day first', async () => {
    watched('2026-11-16T15:00:00.000Z')
    watched('2026-11-14T09:00:00.000Z')
    watched('2026-11-16T18:30:00.000Z')
    watched('2026-11-16T02:00:00.000Z')

    const response = await get('tz=UTC')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      timeZone: 'UTC',
      total: 4,
      days: [['2026-11-16', 3], ['2026-11-14', 1]],
    })
  })

  it('counts a day in the caller’s time zone, not the server’s', async () => {
    // 03:06 UTC on the 17th is 10:06 pm on the 16th in New York
    watched('2026-11-17T03:06:00.000Z')
    watched('2026-11-16T20:00:00.000Z')

    expect((await (await get('tz=America/New_York')).json()).days).toEqual([['2026-11-16', 2]])
    expect((await (await get('tz=UTC')).json()).days).toEqual([['2026-11-17', 1], ['2026-11-16', 1]])
  })

  it('leaves out rows the list leaves out, and keeps rows that were never checked', async () => {
    watched('2026-11-16T15:00:00.000Z', { isValid: false })
    watched('2026-11-16T16:00:00.000Z', { isValid: true })
    watched('2026-11-15T16:00:00.000Z')

    expect(await (await get()).json()).toMatchObject({ total: 2, days: [['2026-11-16', 1], ['2026-11-15', 1]] })
  })

  it('counts a row with no date in the total only: it sorts after every day', async () => {
    watched('2026-11-16T15:00:00.000Z')
    watched(null)

    expect(await (await get()).json()).toMatchObject({ total: 2, days: [['2026-11-16', 1]] })
  })

  it('counts the caller’s rows only', async () => {
    watched('2026-11-16T15:00:00.000Z')
    watched('2026-11-16T16:00:00.000Z', { userId: OTHER })

    expect((await (await get()).json()).total).toBe(1)
  })

  it('answers an account with no history with no days', async () => {
    expect(await (await get()).json()).toEqual({ timeZone: 'UTC', total: 0, days: [] })
  })
})

describe('the request', () => {
  it('refuses a request that names no time zone, or one that is not a zone', async () => {
    for (const query of ['', 'tz=', 'tz=Mars/Olympus_Mons', `tz=${'x'.repeat(80)}`]) {
      const response = await get(query)
      expect(response.status).toBe(400)
      expect(response.headers.get('cache-control')).toBe('no-store, private')
    }
    expect(isTimeZone('America/New_York')).toBe(true)
    expect(isTimeZone(null)).toBe(false)
  })

  it('answers whatever the gate answers when the caller is not let in', async () => {
    mockGate.mockImplementation(async () => new Response(null, { status: 401 }))

    expect((await get()).status).toBe(401)
  })

  it('says so when the history cannot be read, and never "nothing watched"', async () => {
    jest.spyOn(history(), 'find').mockImplementationOnce(() => { throw new Error('mongo is down') })

    const response = await get()

    expect(response.status).toBe(500)
    expect(response.headers.get('cache-control')).toBe('no-store, private')
    expect(await response.json()).toEqual({ error: 'Failed to read watch history' })
  })

  it('answers a poll that already holds these days with a 304', async () => {
    watched('2026-11-16T15:00:00.000Z')
    const first = await get()
    expect(first.headers.get('cache-control')).toBe('private, no-cache')

    const again = await get('tz=UTC', { 'If-None-Match': first.headers.get('etag') })
    expect(again.status).toBe(304)
    expect(again.headers.get('cache-control')).toBe('private, no-cache')

    watched('2026-11-16T16:00:00.000Z')
    expect((await get('tz=UTC', { 'If-None-Match': first.headers.get('etag') })).status).toBe(200)
  })

  it('the proxy leaves the route’s Cache-Control alone, where its default is no-store', async () => {
    const passed = await proxy(new NextRequest(`${URL_TIMELINE}?tz=UTC`, { headers: { cookie: 'nextjs-stream.session_token=tok.sig' } }))

    expect(passed.headers.get('x-middleware-next')).toBe('1')
    expect(passed.headers.get('cache-control')).toBeNull()
  })
})

describe('list positions on horizontal-list', () => {
  const list = (query) => getList(new Request(`https://app.example/api/authenticated/horizontal-list?type=recentlyWatched&${query}`))
  // Page 1 of 3 per page: the row before it, its three rows, the row after.
  // The row at position 4 is no longer in the library, so the window lacks it.
  const window = () => [
    { id: 'a', title: 'A', __listPosition: 2 },
    { id: 'b', title: 'B', __listPosition: 3 },
    { id: 'c', title: 'C', __listPosition: 5 },
    { id: 'd', title: 'D', __listPosition: 6 },
  ]

  it('puts each card’s place in the whole list on it when asked', async () => {
    mockRecentlyWatched.mockImplementation(async () => window())

    const body = await (await list('page=1&limit=3&positions=true')).json()

    expect(body.previousItem).toEqual({ id: 'a', title: 'A', listPosition: 2 })
    expect(body.currentItems).toEqual([
      { id: 'b', title: 'B', listPosition: 3 },
      { id: 'c', title: 'C', listPosition: 5 },
    ])
    expect(body.nextItem).toEqual({ id: 'd', title: 'D', listPosition: 6 })
  })

  it('keeps each place with its own card when a row cannot be made into one', async () => {
    mockRecentlyWatched.mockImplementation(async () => [
      { id: 'b', title: 'B', __listPosition: 3 },
      { id: 'x', title: 'X', __listPosition: 4, broken: true },
      { id: 'c', title: 'C', __listPosition: 5 },
    ])

    const body = await (await list('page=1&limit=3&positions=true')).json()

    expect(body.currentItems).toEqual([
      { id: 'b', title: 'B', listPosition: 3 },
      { id: 'c', title: 'C', listPosition: 5 },
    ])
  })

  it('sends no positions to a caller that did not ask: the other apps’ pages are unchanged', async () => {
    mockRecentlyWatched.mockImplementation(async () => window())

    const body = await (await list('page=1&limit=3')).json()

    expect(body.currentItems).toEqual([{ id: 'b', title: 'B' }, { id: 'c', title: 'C' }])
    expect(body.previousItem).toEqual({ id: 'a', title: 'A' })
    expect(JSON.stringify(body)).not.toContain('listPosition')
  })
})
