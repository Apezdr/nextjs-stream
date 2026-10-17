/**
 * @jest-environment node
 *
 * The sync tick fetches each server's TV and movie payloads conditionally:
 * If-None-Match with the ETag of the payload last applied, plus
 * `Cache-Control: max-age=0` (Node's fetch otherwise adds no-cache to a
 * conditional request, and Express never answers 304 to that). When every
 * payload answers 304 nothing is downloaded; when any one changed, the
 * unchanged ones are fetched again without If-None-Match, because ownership
 * is decided across every server's payload. Callers that pass no validators
 * fetch exactly as before.
 */

let mockServers = []

jest.mock('@src/utils/config', () => ({
  getAllServers: () => mockServers,
  getSyncUrls: (id) => ({
    tv: `https://${id}.example/media/tv`,
    movies: `https://${id}.example/media/movies`,
  }),
  fileServerVersionTV: 1.0001,
  fileServerVersionMOVIES: 1.0001,
}))
jest.mock('@src/utils/webhookServer.js', () => ({
  getWebhookIdForServer: jest.fn(async () => 'webhook-id-for-tests'),
}))

const { fetchAllServerData } = require('@src/utils/fetchAllServerData')

const server = (id, priority) => ({
  id,
  priority,
  baseURL: `https://${id}.files.example`,
  prefixPath: '',
  syncEndpoint: `https://${id}.example`,
})

/** Payload bodies and ETags each URL serves. */
let served = {}

function serve(url, { etag, body }) {
  served[url] = { etag, body }
}

/** A fetch that honours If-None-Match exactly as the processor does. */
function fakeFetch(url, options = {}) {
  const entry = served[url]
  const headers = options.headers || {}
  if (!entry) {
    return Promise.resolve({ status: 404, ok: false, statusText: 'Not Found', headers: { get: () => null } })
  }
  if (headers['If-None-Match'] !== undefined && headers['If-None-Match'] === entry.etag) {
    return Promise.resolve({
      status: 304,
      ok: false,
      statusText: 'Not Modified',
      headers: { get: (name) => (name.toLowerCase() === 'etag' ? entry.etag : null) },
      text: jest.fn(async () => {
        throw new Error('a 304 has no body to read')
      }),
    })
  }
  return Promise.resolve({
    status: 200,
    ok: true,
    statusText: 'OK',
    headers: { get: (name) => (name.toLowerCase() === 'etag' ? entry.etag : null) },
    text: async () => JSON.stringify({ version: 1.0001, ...entry.body }),
  })
}

/** The headers sent with each request, in order, for one URL. */
const headersSentTo = (url) => global.fetch.mock.calls.filter(([u]) => u === url).map(([, o]) => o.headers)

beforeEach(() => {
  // fetchWithTimeout races each request against a 10 s timer it never
  // clears; fake setTimeout so those timers don't hold the test process open.
  // (setImmediate stays real: the parse step yields with it.)
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] })
  served = {}
  mockServers = [server('default', 1)]
  global.fetch = jest.fn(fakeFetch)
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
  serve('https://default.example/media/tv', { etag: 'W/"tv-1"', body: { 'Show A': { seasons: {} } } })
  serve('https://default.example/media/movies', { etag: '"movies-1"', body: { 'Movie A': { urls: {} } } })
})

afterEach(() => {
  jest.clearAllTimers()
  jest.useRealTimers()
  jest.restoreAllMocks()
})

describe('without validators (every caller but the sync tick)', () => {
  it('sends no conditional headers and returns both payloads with their ETags', async () => {
    const { fileServers, errors, notModified, statuses, etags } = await fetchAllServerData()

    for (const url of ['https://default.example/media/tv', 'https://default.example/media/movies']) {
      const [headers] = headersSentTo(url)
      expect(headers['If-None-Match']).toBeUndefined()
      expect(headers['Cache-Control']).toBeUndefined()
    }
    expect(errors).toEqual([])
    expect(notModified).toBe(false)
    expect(fileServers.default.tv).toEqual({ 'Show A': { seasons: {} } })
    expect(fileServers.default.movies).toEqual({ 'Movie A': { urls: {} } })
    expect(fileServers.default.config).toMatchObject({ priority: 1, baseURL: 'https://default.files.example' })
    expect(statuses).toEqual({ default: { tv: 200, movies: 200 } })
    expect(etags).toEqual({ default: { tv: 'W/"tv-1"', movies: '"movies-1"' } })
  })
})

describe('with validators', () => {
  it('sends each ETag verbatim with Cache-Control: max-age=0, and downloads nothing when every payload is unchanged', async () => {
    const result = await fetchAllServerData({
      validators: { default: { tv: 'W/"tv-1"', movies: '"movies-1"' } },
    })

    expect(headersSentTo('https://default.example/media/tv')).toEqual([
      expect.objectContaining({ 'If-None-Match': 'W/"tv-1"', 'Cache-Control': 'max-age=0' }),
    ])
    expect(headersSentTo('https://default.example/media/movies')).toEqual([
      expect.objectContaining({ 'If-None-Match': '"movies-1"', 'Cache-Control': 'max-age=0' }),
    ])
    expect(result.notModified).toBe(true)
    expect(result.fileServers).toEqual({})
    expect(result.errors).toEqual([])
    expect(result.statuses).toEqual({ default: { tv: 304, movies: 304 } })
    expect(result.etags).toEqual({ default: { tv: 'W/"tv-1"', movies: '"movies-1"' } })
  })

  it('fetches an unchanged payload again, without If-None-Match, when the other one changed', async () => {
    serve('https://default.example/media/tv', { etag: 'W/"tv-2"', body: { 'Show A': { seasons: {} }, 'Show B': {} } })

    const result = await fetchAllServerData({
      validators: { default: { tv: 'W/"tv-1"', movies: '"movies-1"' } },
    })

    // TV changed: one conditional request, answered 200
    expect(headersSentTo('https://default.example/media/tv')).toHaveLength(1)
    // Movies: conditional (304), then again unconditionally
    const movieRequests = headersSentTo('https://default.example/media/movies')
    expect(movieRequests).toHaveLength(2)
    expect(movieRequests[0]['If-None-Match']).toBe('"movies-1"')
    expect(movieRequests[1]['If-None-Match']).toBeUndefined()
    expect(movieRequests[1]['Cache-Control']).toBeUndefined()

    expect(result.notModified).toBe(false)
    expect(Object.keys(result.fileServers.default.tv)).toEqual(['Show A', 'Show B'])
    expect(result.fileServers.default.movies).toEqual({ 'Movie A': { urls: {} } })
    expect(result.statuses).toEqual({ default: { tv: 200, movies: 304 } })
    expect(result.etags).toEqual({ default: { tv: 'W/"tv-2"', movies: '"movies-1"' } })
  })

  it("fetches every payload of a server that answered 304 when another server's payload changed", async () => {
    mockServers = [server('default', 1), server('server2', 2)]
    serve('https://server2.example/media/tv', { etag: '"s2-tv-2"', body: { 'Show C': {} } })
    serve('https://server2.example/media/movies', { etag: '"s2-movies-1"', body: {} })

    const result = await fetchAllServerData({
      validators: {
        default: { tv: 'W/"tv-1"', movies: '"movies-1"' },
        server2: { tv: '"s2-tv-1"', movies: '"s2-movies-1"' },
      },
    })

    for (const url of ['https://default.example/media/tv', 'https://default.example/media/movies']) {
      const requests = headersSentTo(url)
      expect(requests).toHaveLength(2)
      expect(requests[0]['If-None-Match']).toBeDefined()
      expect(requests[1]['If-None-Match']).toBeUndefined()
    }
    expect(result.notModified).toBe(false)
    expect(result.statuses).toEqual({
      default: { tv: 304, movies: 304 },
      server2: { tv: 200, movies: 304 },
    })
    expect(result.fileServers.default.tv).toEqual({ 'Show A': { seasons: {} } })
    expect(result.fileServers.default.movies).toEqual({ 'Movie A': { urls: {} } })
    expect(result.fileServers.server2.tv).toEqual({ 'Show C': {} })
    expect(result.fileServers.server2.movies).toEqual({})
  })

  it('sends no If-None-Match for a payload with no ETag on record', async () => {
    const result = await fetchAllServerData({ validators: { default: { tv: 'W/"tv-1"' } } })

    const [movieHeaders] = headersSentTo('https://default.example/media/movies')
    expect(movieHeaders['If-None-Match']).toBeUndefined()
    expect(movieHeaders['Cache-Control']).toBeUndefined()
    expect(result.notModified).toBe(false)
    expect(result.fileServers.default.movies).toEqual({ 'Movie A': { urls: {} } })
  })
})
