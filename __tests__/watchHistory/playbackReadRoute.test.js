/**
 * @jest-environment node
 *
 * GET /api/authenticated/sync/playback: the caller's position in one title,
 * over an in-memory Media database, through the real gate.
 *
 * The route used to load every row of the user to find one, and a details
 * page asks every 15 s. It now finds the row by index, and takes the title by
 * its durable id as well as by its URL. What every caller read before is
 * pinned first; then the new arm, the completion flag and its runtime, the
 * rows the sync flagged, who gets in (the TV and phone apps sign in with a
 * Bearer token), and that a failed read is never "no row".
 */
const fs = require('fs')
const path = require('path')
const { createMemoryMongo } = require('../helpers/memoryMongo')

const mockMongo = createMemoryMongo()
jest.mock('@src/lib/mongodb', () => ({ __esModule: true, default: Promise.resolve(mockMongo.client) }))

// The real gate (src/lib/roles/gates.ts) and the real session lookup
// (src/lib/cachedAuth.js) run. What is faked is better-auth itself, which Jest
// can't load, and the request's headers, which Next hands a route.
let mockRequestHeaders = new Headers()
jest.mock('next/headers', () => ({ headers: async () => mockRequestHeaders }))
jest.mock('next/cache', () => ({ cacheLife: jest.fn() }))
jest.mock('next/navigation', () => ({ redirect: jest.fn() }))
const mockGetSession = jest.fn()
jest.mock('@src/lib/auth', () => ({ auth: { api: { getSession: (...args) => mockGetSession(...args) } } }))
jest.mock('@src/lib/requestCaller', () => ({ recordUserCaller: jest.fn(), recordKeyCaller: jest.fn() }))
jest.mock('@src/lib/authSessionStore', () => ({ rememberSession: jest.fn(async () => {}) }))
jest.mock('@src/utils/webhookServer', () => ({ validateWebhookId: jest.fn() }))

const mockAccessFor = jest.fn()
jest.mock('@src/lib/roles/libraryAccess', () => ({ libraryAccessFor: (...args) => mockAccessFor(...args) }))
const mockLog = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
jest.mock('@src/lib/logger', () => ({ __esModule: true, createLogger: () => mockLog }))

const { GET } = require('@src/app/api/authenticated/sync/playback/route')
const { generateNormalizedVideoId } = require('@src/utils/videoIdentity')
const { _resetMediaIdResolverCacheForTests } = require('@src/utils/watchHistory/mediaIdResolver')
const { FULL_LIBRARY } = require('@src/lib/roles/libraryScope')

const USER = '507f1f77bcf86cd799439011'
const OTHER = '507f1f77bcf86cd7994390aa'
const COOKIE = 'nextjs-stream.session_token=tok.sig'
const BASE = 'https://app.example/api/authenticated/sync/playback'

// One movie, as the catalog holds it now, and the file it had before a
// quality swap (same folder, so the same durable id; another file, so another hash)
const MOVIE_URL = 'https://files.example/movies/Family%20Film%20(2001)/family.film.1080p.mp4'
const MOVIE_NID = generateNormalizedVideoId(MOVIE_URL)
const MOVIE_MID = 'mid:familyfilm'
const OLD_URL = 'https://files.example/movies/Family%20Film%20(2001)/family.film.720p.mp4'
const OLD_NID = generateNormalizedVideoId(OLD_URL)
const TWO_HOURS_MS = 2 * 60 * 60 * 1000

const col = (name) => mockMongo.collection('Media', name)
const catalogMovie = (overrides = {}) => ({
  _id: 'm-family',
  originalTitle: 'Family Film (2001)',
  videoURL: MOVIE_URL,
  normalizedVideoId: MOVIE_NID,
  mediaId: MOVIE_MID,
  duration: TWO_HOURS_MS,
  metadata: { rating: 'G' },
  ...overrides,
})
/** A WatchHistory row as the writers leave it. */
const row = (overrides = {}) => ({
  _id: `row-${col('WatchHistory').docs.length + 1}`,
  userId: USER,
  videoId: MOVIE_URL,
  normalizedVideoId: MOVIE_NID,
  mediaId: MOVIE_MID,
  playbackTime: 1800,
  lastUpdated: new Date('2026-11-10T20:00:00.000Z'),
  deviceInfo: { type: 'tv', userAgent: 'TestApp/1.0' },
  ipAddress: '203.0.113.5',
  lastWriter: 'client',
  ...overrides,
})
const seed = (...rows) => col('WatchHistory').docs.push(...rows)

const signedIn = (user = { id: USER, approved: true }) => ({ user, session: { token: 'tok', userId: user.id } })

async function get(query, headers = { cookie: COOKIE }) {
  mockRequestHeaders = new Headers(headers)
  return GET(new Request(`${BASE}?${new URLSearchParams(query)}`, { headers }))
}
const read = async (query, headers) => (await get(query, headers)).json()

/** Every read of the user's history the route made: the filter, less the user. */
const historyReads = (find) => find.mock.calls.map(([{ userId, ...identity }]) => [String(userId), identity])

beforeEach(() => {
  jest.clearAllMocks()
  _resetMediaIdResolverCacheForTests()
  for (const name of ['WatchHistory', 'FlatMovies', 'FlatEpisodes']) col(name).docs.length = 0
  col('FlatMovies').docs.push(catalogMovie())
  mockGetSession.mockResolvedValue(signedIn())
  mockAccessFor.mockResolvedValue(FULL_LIBRARY)
})

describe('asked by videoId, as every caller asks today', () => {
  it('a row answers with the fields callers read, unchanged, and what is new beside them', async () => {
    seed(row())
    const before = Date.now()

    const response = await get({ videoId: MOVIE_URL })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json')
    const body = await response.json()
    // useWatchPosition, fetchServerResume and markWatched read these six
    expect(body).toMatchObject({
      videoId: MOVIE_URL,
      playbackTime: 1800,
      lastUpdated: '2026-11-10T20:00:00.000Z',
      completed: false,
      progressPercent: 25,
      found: true,
    })
    // New: the row's keys, and the server's clock at the read
    expect(body.mediaId).toBe(MOVIE_MID)
    expect(body.normalizedVideoId).toBe(MOVIE_NID)
    expect(new Date(body.asOf).getTime()).toBeGreaterThanOrEqual(before)
    expect(new Date(body.asOf).getTime()).toBeLessThanOrEqual(Date.now())
    expect(Object.keys(body).sort()).toEqual(
      ['asOf', 'completed', 'found', 'lastUpdated', 'mediaId', 'normalizedVideoId', 'playbackTime', 'progressPercent', 'videoId']
    )
  })

  it('no row answers found:false with a zero position, the same shape', async () => {
    const body = await read({ videoId: MOVIE_URL })

    expect(body).toEqual({
      videoId: MOVIE_URL,
      playbackTime: 0,
      lastUpdated: null,
      completed: false,
      progressPercent: 0,
      found: false,
      mediaId: null,
      normalizedVideoId: MOVIE_NID,
      asOf: expect.any(String),
    })
  })

  it('finds a row written through another transport: the hash is the title’s, not the URL’s', async () => {
    seed(row())
    const viaTranscoder = `https://transcoder.example/stream/${Buffer.from('movies/Family Film (2001)/family.film.1080p.mp4').toString('base64url')}/master.m3u8`

    expect(await read({ videoId: viaTranscoder })).toMatchObject({ found: true, playbackTime: 1800 })
  })

  it('after a quality swap, finds the row left under the old file by the title’s durable id', async () => {
    seed(row({ videoId: OLD_URL, normalizedVideoId: OLD_NID }))

    expect(await read({ videoId: MOVIE_URL })).toMatchObject({
      found: true,
      playbackTime: 1800,
      videoId: OLD_URL,
      normalizedVideoId: OLD_NID,
      mediaId: MOVIE_MID,
    })
  })

  it('finds a row from before URLs were hashed as they are now, by its URL; a row under today’s hash wins over it', async () => {
    seed(row({ normalizedVideoId: 'legacyhash0000001', mediaId: undefined, playbackTime: 900 }))
    expect(await read({ videoId: MOVIE_URL })).toMatchObject({ found: true, playbackTime: 900, mediaId: null })

    seed(row({ playbackTime: 2400 }))
    expect(await read({ videoId: MOVIE_URL })).toMatchObject({ found: true, playbackTime: 2400 })
  })

  it('is the caller’s own row, never another user’s for the same title', async () => {
    seed(row({ userId: OTHER, playbackTime: 4000 }))

    expect(await read({ videoId: MOVIE_URL })).toMatchObject({ found: false, playbackTime: 0 })
  })

  it('needs a title: 400 with neither parameter', async () => {
    for (const query of [{}, { videoId: '' }]) {
      const response = await get(query)
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'videoId or mediaId parameter required' })
    }
  })
})

describe('asked by mediaId', () => {
  it('finds the row by the durable id alone, with the catalog’s runtime for the flag', async () => {
    seed(row({ videoId: OLD_URL, normalizedVideoId: OLD_NID, playbackTime: 3600 }))

    expect(await read({ mediaId: MOVIE_MID })).toMatchObject({
      found: true,
      playbackTime: 3600,
      progressPercent: 50,
      completed: false,
      mediaId: MOVIE_MID,
      videoId: OLD_URL,
    })
  })

  it('finds a row under the title’s current file that was never stamped with the id', async () => {
    seed(row({ mediaId: undefined, playbackTime: 700 }))

    expect(await read({ mediaId: MOVIE_MID })).toMatchObject({ found: true, playbackTime: 700, normalizedVideoId: MOVIE_NID })
  })

  it('no row answers found:false, echoing what was asked', async () => {
    expect(await read({ mediaId: MOVIE_MID })).toEqual({
      videoId: null,
      playbackTime: 0,
      lastUpdated: null,
      completed: false,
      progressPercent: 0,
      found: false,
      mediaId: MOVIE_MID,
      normalizedVideoId: null,
      asOf: expect.any(String),
    })
  })

  it('with a videoId too: the URL’s row first, then the id’s', async () => {
    seed(row({ videoId: OLD_URL, normalizedVideoId: OLD_NID, playbackTime: 500 }))
    expect(await read({ mediaId: MOVIE_MID, videoId: MOVIE_URL })).toMatchObject({ found: true, playbackTime: 500 })

    // A URL the catalog no longer knows (the page is older than the swap): the id still finds it
    const gone = 'https://files.example/movies/Family%20Film%20(2001)/family.film.480p.mp4'
    expect(await read({ mediaId: MOVIE_MID, videoId: gone })).toMatchObject({ found: true, playbackTime: 500, progressPercent: 6.9 })
  })

  it('refuses an id that is not a durable one (400): a document id names no title here', async () => {
    seed(row())
    for (const mediaId of ['64b7f0c2a1b2c3d4e5f60799', 'family']) {
      const response = await get({ mediaId })
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'mediaId must be a durable id (mid:…)' })
    }
  })

  // Two titles can play from one file, and the catalog names only one of them
  // for its hash. The position is the file's: the other title's page gets it
  // too, as it does on a list, instead of a refusal it could not resume from.
  it('an id and a URL the catalog gives to another title: the file’s row answers', async () => {
    seed(row())
    const find = jest.spyOn(col('WatchHistory'), 'find')

    const response = await get({ mediaId: 'mid:anotherfilm', videoId: MOVIE_URL })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ found: true, playbackTime: 1800, progressPercent: 25 })
    expect(historyReads(find)).toEqual([[USER, { normalizedVideoId: MOVIE_NID }]])
  })

  it('the same, with the row left under the file before a quality swap: one read by both ids', async () => {
    seed(row({ videoId: OLD_URL, normalizedVideoId: OLD_NID, playbackTime: 900 }))
    const find = jest.spyOn(col('WatchHistory'), 'find')

    expect(await read({ mediaId: 'mid:anotherfilm', videoId: MOVIE_URL })).toMatchObject({ found: true, playbackTime: 900 })
    expect(historyReads(find)).toEqual([
      [USER, { normalizedVideoId: MOVIE_NID }],
      [USER, { mediaId: { $in: ['mid:anotherfilm', MOVIE_MID] } }],
    ])
  })
})

describe('the reads', () => {
  it('a row under the URL’s hash is one read, by {userId, normalizedVideoId}', async () => {
    seed(row())
    const find = jest.spyOn(col('WatchHistory'), 'find')

    await read({ videoId: MOVIE_URL })

    expect(historyReads(find)).toEqual([[USER, { normalizedVideoId: MOVIE_NID }]])
    // Not the device or the addresses
    expect(find.mock.calls[0][1].projection).toEqual({ _id: 0, videoId: 1, normalizedVideoId: 1, mediaId: 1, playbackTime: 1, lastUpdated: 1 })
  })

  it('a quality-swapped row is two: the hash, then {userId, mediaId}', async () => {
    seed(row({ videoId: OLD_URL, normalizedVideoId: OLD_NID }))
    const find = jest.spyOn(col('WatchHistory'), 'find')

    await read({ videoId: MOVIE_URL })

    expect(historyReads(find)).toEqual([
      [USER, { normalizedVideoId: MOVIE_NID }],
      [USER, { mediaId: MOVIE_MID }],
    ])
  })

  it('no read ever asks for the user’s whole history', async () => {
    seed(row({ normalizedVideoId: 'nid-another', mediaId: 'mid:another', videoId: 'https://files.example/another.mp4' }))
    const find = jest.spyOn(col('WatchHistory'), 'find')

    for (const query of [{ videoId: MOVIE_URL }, { mediaId: MOVIE_MID }, { videoId: MOVIE_URL, mediaId: MOVIE_MID }]) {
      expect(await read(query)).toMatchObject({ found: false })
    }

    expect(find.mock.calls.length).toBeGreaterThan(0)
    for (const [, identity] of historyReads(find)) {
      expect(Object.keys(identity)).toHaveLength(1)
      expect(['normalizedVideoId', 'mediaId', 'videoId']).toContain(Object.keys(identity)[0])
    }
  })
})

describe('completed, and the runtime behind it', () => {
  it('is true from 95% of the runtime, false below, and always a boolean', async () => {
    seed(row({ playbackTime: 0.95 * (TWO_HOURS_MS / 1000) }))
    expect(await read({ videoId: MOVIE_URL })).toMatchObject({ found: true, completed: true, progressPercent: 95 })

    col('WatchHistory').docs[0].playbackTime = 0.94 * (TWO_HOURS_MS / 1000)
    expect(await read({ videoId: MOVIE_URL })).toMatchObject({ found: true, completed: false, progressPercent: 94 })

    col('WatchHistory').docs.length = 0
    expect((await read({ videoId: MOVIE_URL })).completed).toBe(false)
  })

  it('falls back to the TMDB runtime when the file’s is unknown, as the list joins do', async () => {
    // No duration from the file server; TMDB says 100 minutes
    col('FlatMovies').docs[0] = catalogMovie({ duration: undefined, metadata: { rating: 'G', runtime: 100 } })
    seed(row({ playbackTime: 97 * 60 }))

    // The same answer by either key
    for (const query of [{ videoId: MOVIE_URL }, { mediaId: MOVIE_MID }]) {
      _resetMediaIdResolverCacheForTests()
      expect(await read(query)).toMatchObject({ found: true, completed: true, progressPercent: 97 })
    }
  })

  it('with no runtime at all, a position is not a percentage: 0, and not completed', async () => {
    col('FlatMovies').docs[0] = catalogMovie({ duration: undefined })
    seed(row({ playbackTime: 7000 }))

    expect(await read({ videoId: MOVIE_URL })).toMatchObject({ found: true, playbackTime: 7000, completed: false, progressPercent: 0 })
  })
})

describe('a row the sync flagged (isValid:false)', () => {
  it('is returned: this read has just matched it to a title, so the flag is stale', async () => {
    seed(row({ isValid: false, playbackTime: 2100 }))

    for (const query of [{ videoId: MOVIE_URL }, { mediaId: MOVIE_MID }]) {
      expect(await read(query)).toMatchObject({ found: true, playbackTime: 2100 })
    }
  })
})

describe('the viewer’s library scope', () => {
  // Movies rated PG or lower
  const KIDS = { id: 'scope-kids', scope: { movieRatingCap: 'PG', tvRatingCap: null, titles: [] }, showIds: [] }

  it('a title outside it has no position to give, by either key', async () => {
    col('FlatMovies').docs[0] = catalogMovie({ metadata: { rating: 'R' } })
    seed(row())
    mockAccessFor.mockResolvedValue(KIDS)

    expect(await read({ videoId: MOVIE_URL })).toMatchObject({ found: false, playbackTime: 0, completed: false, progressPercent: 0 })
    expect(await read({ mediaId: MOVIE_MID })).toMatchObject({ found: false, playbackTime: 0 })
  })

  it('a title inside it answers as for anyone', async () => {
    seed(row())
    mockAccessFor.mockResolvedValue(KIDS)

    expect(await read({ videoId: MOVIE_URL })).toMatchObject({ found: true, playbackTime: 1800 })
    expect(mockAccessFor).toHaveBeenCalledWith(expect.objectContaining({ id: USER }))
  })
})

describe('a read that fails', () => {
  it('answers 500, never "no row": a client that believed it would start at 0 and save over the position', async () => {
    seed(row())
    jest.spyOn(col('WatchHistory'), 'find').mockImplementationOnce(() => {
      throw new Error('connection closed')
    })

    const response = await get({ videoId: MOVIE_URL })

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body).toEqual({ error: 'Failed to read the playback position' })
    expect(body).not.toHaveProperty('found')
    // The user's id, never an email or the title
    expect(mockLog.error).toHaveBeenCalledWith({ err: expect.any(Error), userId: USER }, 'Failed to read the playback position')
  })
})

describe('who gets in', () => {
  beforeEach(() => seed(row()))

  it('a signed-out caller gets 401 AUTH_REQUIRED and nothing is read', async () => {
    mockGetSession.mockResolvedValue(null)
    const find = jest.spyOn(col('WatchHistory'), 'find')

    const response = await get({ videoId: MOVIE_URL }, {})

    expect(response.status).toBe(401)
    expect((await response.json()).code).toBe('AUTH_REQUIRED')
    expect(find).not.toHaveBeenCalled()
  })

  it('a signed-in account still waiting for approval gets 403 APPROVAL_PENDING, like every media route', async () => {
    mockGetSession.mockResolvedValue(signedIn({ id: USER, approved: false }))

    const response = await get({ videoId: MOVIE_URL })

    expect(response.status).toBe(403)
    expect((await response.json()).code).toBe('APPROVAL_PENDING')
  })

  it('a Bearer session (the TV and phone apps) passes: no cookie, no page user', async () => {
    // better-auth's bearer plugin resolves the token to its session (the guards below)
    mockGetSession.mockImplementation(async ({ headers }) =>
      headers.get('authorization') === 'Bearer device-token' ? signedIn() : null
    )
    const headers = { authorization: 'Bearer device-token', 'user-agent': 'TestApp/1.0 (android; tv)' }

    const response = await get({ videoId: MOVIE_URL }, headers)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ found: true, playbackTime: 1800 })
    // The gate asked better-auth with the request's own headers, the token among them
    expect(mockGetSession).toHaveBeenCalledTimes(1)
    expect(mockGetSession.mock.calls[0][0].headers.get('authorization')).toBe('Bearer device-token')

    // By the durable id too, and a wrong token is a signed-out caller
    expect(await read({ mediaId: MOVIE_MID }, headers)).toMatchObject({ found: true })
    expect((await get({ videoId: MOVIE_URL }, { authorization: 'Bearer wrong' })).status).toBe(401)
  })

  it('a browser tab from before this change still reads: the page’s user is not asked for here yet', async () => {
    // Such a tab sends its cookie and no X-Playback-User header
    const response = await get({ videoId: MOVIE_URL }, { cookie: COOKIE })

    expect(response.status).toBe(200)
    expect((await response.json()).found).toBe(true)
  })
})

describe('guards: why a Bearer token passes the gate', () => {
  const ROOT = path.join(__dirname, '..', '..')
  const source = (...segments) => fs.readFileSync(path.join(ROOT, ...segments), 'utf8')
  /** A file of an installed package, from this checkout's node_modules or the nearest one above it (a git worktree has none). */
  function installed(...segments) {
    for (let dir = ROOT; ; dir = path.dirname(dir)) {
      const file = path.join(dir, 'node_modules', ...segments)
      if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8')
      if (dir === path.dirname(dir)) throw new Error(`Not installed: ${segments.join('/')}`)
    }
  }

  it('the route’s gate is the approved gate, the one updatePlayback (which the apps write through) uses', () => {
    for (const route of ['playback', 'updatePlayback']) {
      expect([route, source('src', 'app', 'api', 'authenticated', 'sync', route, 'route.js')]).toEqual([
        route,
        expect.stringMatching(/await approvedGate\.route\(\)/),
      ])
    }
  })

  it('every gate reads the session from the request’s headers through better-auth', () => {
    expect(source('src', 'lib', 'roles', 'gates.ts')).toMatch(/const session = await getSession\(\)/)
    expect(source('src', 'lib', 'cachedAuth.js')).toMatch(/auth\.api\.getSession\(\{ headers: requestHeaders \}\)/)
  })

  it('auth.ts installs better-auth’s bearer plugin, which turns the token into the session cookie for that lookup', () => {
    expect(source('src', 'lib', 'auth.ts')).toMatch(/^\s+bearer\(\),$/m)
    // better-auth is ESM-only, which this Jest setup doesn't load, so its dist is read as text
    const plugin = installed('better-auth', 'dist', 'plugins', 'bearer', 'index.mjs')
    // It runs for a server-side call that passes only headers (no Request)
    expect(plugin).toContain('context.request?.headers.get("authorization") || context.headers?.get("authorization")')
    expect(plugin).toContain('setRequestCookie(headers, c.context.authCookies.sessionToken.name, decodedToken)')
  })
})
