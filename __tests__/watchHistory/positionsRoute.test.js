/**
 * @jest-environment node
 *
 * GET /api/authenticated/sync/positions: the caller's recent positions as one
 * snapshot, over an in-memory Media database.
 *
 * It replaces a poll that loaded the user's whole history into the server and
 * sent whole rows (video URLs, devices, addresses) to the browser. So the
 * cases here are what the snapshot must not hold (old rows, rows the sync
 * flagged, titles outside the viewer's library, anything but four fields),
 * that the cut happens in MongoDB, that a poll gets a 304, and that a browser
 * whose session became someone else's gets nothing.
 */

const { createMemoryMongo } = require('../helpers/memoryMongo')

const mockMongo = createMemoryMongo()
jest.mock('@src/lib/mongodb', () => ({ __esModule: true, default: Promise.resolve(mockMongo.client) }))

const mockGate = jest.fn()
jest.mock('@src/lib/roles/gates', () => ({ approvedGate: { route: (...args) => mockGate(...args) } }))
const mockAccessFor = jest.fn()
jest.mock('@src/lib/roles/libraryAccess', () => ({ libraryAccessFor: (...args) => mockAccessFor(...args) }))
const mockLog = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
jest.mock('@src/lib/logger', () => ({ __esModule: true, createLogger: () => mockLog }))
// The proxy's own collaborators (it is only asked what it does to Cache-Control)
jest.mock('@src/lib/auth', () => ({ auth: { api: { getSession: jest.fn() } } }))
jest.mock('@src/utils/config', () => ({ getAllServers: () => [] }))

const { GET } = require('@src/app/api/authenticated/sync/positions/route')
const { POSITIONS_LIMIT, POSITIONS_WINDOW_DAYS } = require('@src/utils/watchHistory/positions')
const { FULL_LIBRARY } = require('@src/lib/roles/libraryScope')
const { PLAYBACK_USER_HEADER } = require('@src/lib/playbackUser')
const { NextRequest } = require('next/server')
const { proxy } = require('@src/proxy')

const USER = '507f1f77bcf86cd799439011'
const OTHER = '507f1f77bcf86cd7994390aa'
const COOKIE = 'nextjs-stream.session_token=tok.sig'
const URL_POSITIONS = 'https://app.example/api/authenticated/sync/positions'
const SHOW_IN = '64b7f0c2a1b2c3d4e5f60701'
const SHOW_OUT = '64b7f0c2a1b2c3d4e5f60702'
const DAY_MS = 24 * 60 * 60 * 1000

// Movies rated PG or lower, and one show
const KIDS = {
  id: 'scope-kids',
  scope: { movieRatingCap: 'PG', tvRatingCap: 'TV-Y7', titles: [] },
  showIds: [SHOW_IN],
}

const col = (name) => mockMongo.collection('Media', name)
const daysAgo = (days) => new Date(Date.now() - days * DAY_MS)

/** A WatchHistory row as the writers leave it: more than a snapshot may carry. */
function row(overrides = {}) {
  return {
    _id: `row-${col('WatchHistory').docs.length + 1}`,
    userId: USER,
    videoId: 'https://files.example/movies/Family%20Film/family.mp4',
    normalizedVideoId: 'nid-family',
    mediaId: 'mid:family',
    playbackTime: 600,
    lastUpdated: daysAgo(1),
    isPaused: true,
    mediaType: 'movie',
    deviceInfo: { type: 'tv', userAgent: 'TestApp/1.0' },
    ipAddress: '203.0.113.5',
    localIp: '192.168.1.20',
    lastWriter: 'client',
    ...overrides,
  }
}
const seed = (...rows) => col('WatchHistory').docs.push(...rows)

// A browser's request: its cookie, and the user its page was rendered for
const browser = (userId = USER, headers = {}) => ({ cookie: COOKIE, [PLAYBACK_USER_HEADER]: userId, ...headers })
const get = (headers = browser()) => GET(new Request(URL_POSITIONS, { headers }))
const rowsOf = async (headers) => (await (await get(headers)).json()).rows

beforeEach(() => {
  jest.clearAllMocks()
  for (const name of ['WatchHistory', 'FlatMovies', 'FlatEpisodes']) col(name).docs.length = 0
  mockGate.mockResolvedValue({ id: USER })
  mockAccessFor.mockResolvedValue(FULL_LIBRARY)
})

describe('the snapshot', () => {
  it('answers whose rows these are, the server’s time, and the rows: four fields each, newest first', async () => {
    seed(
      row({ normalizedVideoId: 'nid-a', mediaId: 'mid:a', playbackTime: 100, lastUpdated: daysAgo(3) }),
      row({ normalizedVideoId: 'nid-b', mediaId: 'mid:b', playbackTime: 200, lastUpdated: daysAgo(1) }),
      row({ normalizedVideoId: 'nid-c', mediaId: 'mid:c', playbackTime: 300, lastUpdated: daysAgo(2) })
    )
    const before = Date.now()
    const response = await get()

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(Object.keys(body).sort()).toEqual(['asOf', 'rows', 'userId'])
    expect(body.userId).toBe(USER)
    expect(new Date(body.asOf).getTime()).toBeGreaterThanOrEqual(before)
    expect(new Date(body.asOf).getTime()).toBeLessThanOrEqual(Date.now())
    expect(body.rows.map((r) => r.normalizedVideoId)).toEqual(['nid-b', 'nid-c', 'nid-a'])
    // No video URL, device or address leaves the server
    for (const r of body.rows) expect(Object.keys(r).sort()).toEqual(['lastUpdated', 'mediaId', 'normalizedVideoId', 'playbackTime'])
    expect(body.rows[0]).toEqual({
      mediaId: 'mid:b',
      normalizedVideoId: 'nid-b',
      playbackTime: 200,
      lastUpdated: col('WatchHistory').docs[1].lastUpdated.toISOString(),
    })
  })

  it('is only ever the caller’s own', async () => {
    seed(row({ normalizedVideoId: 'nid-mine' }), row({ userId: OTHER, normalizedVideoId: 'nid-theirs' }))

    expect((await rowsOf()).map((r) => r.normalizedVideoId)).toEqual(['nid-mine'])
  })

  it('names a title by its durable id only: an id a client once sent names nothing', async () => {
    seed(
      row({ normalizedVideoId: 'nid-legacy', mediaId: '64b7f0c2a1b2c3d4e5f60799' }),
      row({ normalizedVideoId: 'nid-bare', mediaId: undefined })
    )

    expect((await rowsOf()).map((r) => [r.normalizedVideoId, r.mediaId]).sort()).toEqual([
      ['nid-bare', null],
      ['nid-legacy', null],
    ])
  })

  it('answers 500 when the history cannot be read, never an empty snapshot', async () => {
    seed(row())
    jest.spyOn(col('WatchHistory'), 'find').mockImplementationOnce(() => {
      throw new Error('connection closed')
    })

    const response = await get()

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to read positions' })
    expect(response.headers.get('etag')).toBeNull()
    expect(response.headers.get('cache-control')).toBe('no-store, private')
  })
})

describe('the window, cut in MongoDB', () => {
  it(`leaves out a row last written more than ${POSITIONS_WINDOW_DAYS} days ago`, async () => {
    seed(
      row({ normalizedVideoId: 'nid-recent', lastUpdated: daysAgo(POSITIONS_WINDOW_DAYS - 1) }),
      row({ normalizedVideoId: 'nid-old', lastUpdated: daysAgo(POSITIONS_WINDOW_DAYS + 1) })
    )

    expect((await rowsOf()).map((r) => r.normalizedVideoId)).toEqual(['nid-recent'])
  })

  it(`holds the ${POSITIONS_LIMIT} most recent rows of a longer history`, async () => {
    const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000)
    for (let i = 0; i < POSITIONS_LIMIT + 5; i++) seed(row({ normalizedVideoId: `nid-${i}`, mediaId: `mid:${i}`, lastUpdated: minutesAgo(i) }))

    const rows = await rowsOf()

    expect(rows).toHaveLength(POSITIONS_LIMIT)
    expect(rows[0].normalizedVideoId).toBe('nid-0')
    expect(rows.at(-1).normalizedVideoId).toBe(`nid-${POSITIONS_LIMIT - 1}`)
  })

  it('sends the floor, the flag, the order, the limit and the projection to MongoDB: no row is cut in memory', async () => {
    const find = jest.spyOn(col('WatchHistory'), 'find')
    const cursor = { sort: jest.fn(() => cursor), limit: jest.fn(() => cursor), toArray: jest.fn(async () => []) }
    find.mockImplementationOnce(() => cursor)
    const before = Date.now()

    await get()

    const [filter, options] = find.mock.calls[0]
    expect(Object.keys(filter).sort()).toEqual(['isValid', 'lastUpdated', 'userId'])
    expect(String(filter.userId)).toBe(USER)
    expect(filter.isValid).toEqual({ $ne: false })
    const floor = filter.lastUpdated.$gte.getTime()
    expect(floor).toBeGreaterThanOrEqual(before - POSITIONS_WINDOW_DAYS * DAY_MS)
    expect(floor).toBeLessThanOrEqual(Date.now() - POSITIONS_WINDOW_DAYS * DAY_MS)
    // The {userId, lastUpdated: -1} index serves the floor and the order
    expect(cursor.sort).toHaveBeenCalledWith({ lastUpdated: -1 })
    expect(cursor.limit).toHaveBeenCalledWith(POSITIONS_LIMIT)
    // videoId is read for the scope check only
    expect(options.projection).toEqual({ _id: 0, videoId: 1, normalizedVideoId: 1, mediaId: 1, playbackTime: 1, lastUpdated: 1 })
  })
})

describe('rows the sync flagged (isValid:false)', () => {
  it('are left out, as the lists leave them out; a row never checked, or checked and good, stays', async () => {
    seed(
      row({ normalizedVideoId: 'nid-flagged', isValid: false }),
      row({ normalizedVideoId: 'nid-good', isValid: true }),
      row({ normalizedVideoId: 'nid-unchecked' }),
      row({ normalizedVideoId: 'nid-null', isValid: null })
    )

    expect((await rowsOf()).map((r) => r.normalizedVideoId).sort()).toEqual(['nid-good', 'nid-null', 'nid-unchecked'])
  })
})

describe('the viewer’s library scope', () => {
  beforeEach(() => {
    col('FlatMovies').docs.push(
      { _id: 'm-g', originalTitle: 'Family Film (2001)', metadata: { rating: 'G' }, videoURL: 'https://files.example/m-g.mp4', normalizedVideoId: 'nid-g', mediaId: 'mid:g' },
      { _id: 'm-r', originalTitle: 'Late Film (2001)', metadata: { rating: 'R' }, videoURL: 'https://files.example/m-r.mp4', normalizedVideoId: 'nid-r', mediaId: 'mid:r' }
    )
    col('FlatEpisodes').docs.push(
      { _id: 'e-in', showId: SHOW_IN, seasonNumber: 1, episodeNumber: 1, videoURL: 'https://files.example/e-in.mp4', normalizedVideoId: 'nid-e-in' },
      { _id: 'e-out', showId: SHOW_OUT, seasonNumber: 1, episodeNumber: 1, videoURL: 'https://files.example/e-out.mp4', normalizedVideoId: 'nid-e-out' }
    )
    seed(
      row({ videoId: 'https://files.example/m-g.mp4', normalizedVideoId: 'nid-g', mediaId: 'mid:g', lastUpdated: daysAgo(1) }),
      row({ videoId: 'https://files.example/m-r.mp4', normalizedVideoId: 'nid-r', mediaId: 'mid:r', lastUpdated: daysAgo(2) }),
      row({ videoId: 'https://files.example/e-in.mp4', normalizedVideoId: 'nid-e-in', mediaId: undefined, lastUpdated: daysAgo(3) }),
      row({ videoId: 'https://files.example/e-out.mp4', normalizedVideoId: 'nid-e-out', mediaId: undefined, lastUpdated: daysAgo(4) }),
      row({ videoId: 'https://files.example/removed.mp4', normalizedVideoId: 'nid-gone', mediaId: undefined, lastUpdated: daysAgo(5) })
    )
  })

  it('a scoped viewer gets the rows of titles in scope, and no other: not one above the cap, not one the library no longer has', async () => {
    mockAccessFor.mockResolvedValue(KIDS)

    expect((await rowsOf()).map((r) => r.normalizedVideoId)).toEqual(['nid-g', 'nid-e-in'])
    expect(mockAccessFor).toHaveBeenCalledWith({ id: USER })
  })

  it('the whole library gets every row in the window', async () => {
    expect((await rowsOf()).map((r) => r.normalizedVideoId)).toEqual(['nid-g', 'nid-r', 'nid-e-in', 'nid-e-out', 'nid-gone'])
  })
})

describe('the ETag', () => {
  beforeEach(() => seed(row({ normalizedVideoId: 'nid-a', playbackTime: 100 })))

  it('is weak, and a poll that holds it gets a 304 with no body, in the forms proxies rewrite it to', async () => {
    const first = await get()
    const etag = first.headers.get('etag')
    expect(etag).toMatch(/^W\/"[0-9a-f]{32}"$/)

    const hash = etag.slice(3, -1)
    for (const held of [etag, `W/"${hash}-gzip"`, `"${hash}"`]) {
      const again = await get(browser(USER, { 'If-None-Match': held }))
      expect([held, again.status]).toEqual([held, 304])
      expect(await again.text()).toBe('')
      expect(again.headers.get('etag')).toBe(etag)
    }
  })

  it('covers the rows, not the time of the answer: two answers a moment apart share it', async () => {
    const first = await get()
    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = await get()

    expect((await second.json()).asOf).not.toBe((await first.json()).asOf)
    expect(second.headers.get('etag')).toBe(first.headers.get('etag'))
  })

  it('moves when a position moves, and the poll gets the new rows', async () => {
    const etag = (await get()).headers.get('etag')
    col('WatchHistory').docs[0].playbackTime = 130

    const again = await get(browser(USER, { 'If-None-Match': etag }))

    expect(again.status).toBe(200)
    expect(again.headers.get('etag')).not.toBe(etag)
    expect((await again.json()).rows[0].playbackTime).toBe(130)
  })

  it('is another user’s when the rows are: an ETag held from one account never answers 304 to the next', async () => {
    const etag = (await get()).headers.get('etag')
    // The same title at the same position at the same moment, on another account
    seed({ ...col('WatchHistory').docs[0], _id: 'row-other', userId: OTHER })
    mockGate.mockResolvedValue({ id: OTHER })

    const theirs = await get(browser(OTHER, { 'If-None-Match': etag }))

    expect(theirs.status).toBe(200)
    expect((await theirs.json()).userId).toBe(OTHER)
  })

  it('is revalidated on every use and never kept by a shared cache, on the 200 and the 304', async () => {
    const first = await get()
    expect(first.headers.get('cache-control')).toBe('private, no-cache')
    const again = await get(browser(USER, { 'If-None-Match': first.headers.get('etag') }))
    expect(again.headers.get('cache-control')).toBe('private, no-cache')
  })

  it('the proxy leaves the route’s Cache-Control alone, where its default is no-store', async () => {
    const passed = await proxy(new NextRequest(URL_POSITIONS, { headers: browser() }))
    expect(passed.headers.get('x-middleware-next')).toBe('1')
    expect(passed.headers.get('cache-control')).toBeNull()

    // The default, on a neighbour that does not cache
    const neighbour = await proxy(new NextRequest('https://app.example/api/authenticated/sync/playback?videoId=x', { headers: browser() }))
    expect(neighbour.headers.get('cache-control')).toBe('no-store, private')
  })
})

describe('the page’s user', () => {
  beforeEach(() => seed(row()))
  const find = () => jest.spyOn(col('WatchHistory'), 'find')

  it('a cookie request that names no user is refused (400) and reads nothing', async () => {
    const read = find()
    const response = await get({ cookie: COOKIE })

    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('PLAYBACK_USER_REQUIRED')
    expect(read).not.toHaveBeenCalled()
  })

  it('a cookie request from another account’s page is refused (409) and reads nothing', async () => {
    const read = find()
    // The page was rendered for USER; the cookie is OTHER's now
    mockGate.mockResolvedValue({ id: OTHER })
    const response = await get(browser(USER))

    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe('USER_MISMATCH')
    expect(read).not.toHaveBeenCalled()
    expect(mockLog.warn).toHaveBeenCalledWith(
      { userId: OTHER, expectedUserId: USER, path: '/api/authenticated/sync/positions' },
      expect.any(String)
    )
  })

  it('a Bearer client is exempt: its token is its identity, and it sends no header', async () => {
    const response = await get({ authorization: 'Bearer device-token' })

    expect(response.status).toBe(200)
    expect((await response.json()).rows).toHaveLength(1)
  })

  it('a signed-out or unapproved caller gets the gate’s answer, before the check', async () => {
    for (const status of [401, 403]) {
      mockGate.mockResolvedValue(new Response('{}', { status }))
      expect((await get({ cookie: COOKIE })).status).toBe(status)
    }
  })
})
