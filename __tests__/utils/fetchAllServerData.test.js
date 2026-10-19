/**
 * @jest-environment node
 *
 * fetchAllServerData downloads every configured server's whole TV and movie
 * payloads. The sync reads manifests and entries instead (sync/run/
 * manifestTick); src/utils/sync_verification.js still calls this, until Step P
 * removes GET /media/<kind>.
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

/** A fetch that serves the payloads, as the processor does. */
function fakeFetch(url) {
  const entry = served[url]
  if (!entry) {
    return Promise.resolve({ status: 404, ok: false, statusText: 'Not Found', headers: { get: () => null } })
  }
  return Promise.resolve({
    status: 200,
    ok: true,
    statusText: 'OK',
    headers: { get: (name) => (name.toLowerCase() === 'etag' ? entry.etag : null) },
    text: async () => (entry.raw !== undefined ? entry.raw : JSON.stringify({ version: 1.0001, ...entry.body })),
  })
}

/** Run a fetch to the end, letting its retry back-offs (fake timers) elapse. */
async function settle(promise) {
  let done = false
  promise.then(() => { done = true }, () => { done = true })
  while (!done) await jest.advanceTimersByTimeAsync(60_000)
  return promise
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
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
  serve('https://default.example/media/tv', { etag: 'W/"tv-1"', body: { 'Show A': { seasons: {} } } })
  serve('https://default.example/media/movies', { etag: '"movies-1"', body: { 'Movie A': { urls: {} } } })
})

afterEach(() => {
  jest.clearAllTimers()
  jest.useRealTimers()
  jest.restoreAllMocks()
})

describe('a server that answers', () => {
  it('sends no conditional headers and returns both payloads, without their list version', async () => {
    const { fileServers, errors } = await fetchAllServerData()

    for (const url of ['https://default.example/media/tv', 'https://default.example/media/movies']) {
      const [headers] = headersSentTo(url)
      expect(headers['If-None-Match']).toBeUndefined()
      expect(headers['Cache-Control']).toBeUndefined()
    }
    expect(errors).toEqual([])
    expect(fileServers.default.tv).toEqual({ 'Show A': { seasons: {} } })
    expect(fileServers.default.movies).toEqual({ 'Movie A': { urls: {} } })
    expect(fileServers.default.config).toMatchObject({ priority: 1, baseURL: 'https://default.files.example' })
  })
})

describe('a 200 whose body is not an object', () => {
  // With two servers, a server synced as if it had no titles would let the
  // pass count as one where every server answered.
  it.each([
    ['null', 'null'],
    ['an array', '[]'],
    ['a number', '5'],
    ['a string', '"tv"'],
  ])('(%s) puts the server in errors, not in fileServers', async (_label, raw) => {
    mockServers = [server('default', 1), server('server2', 2)]
    served['https://default.example/media/tv'] = { etag: 'W/"tv-broken"', raw }
    serve('https://server2.example/media/tv', { etag: '"s2-tv"', body: { 'Show C': {} } })
    serve('https://server2.example/media/movies', { etag: '"s2-movies"', body: {} })

    const result = await settle(fetchAllServerData())

    expect(result.errors).toEqual([
      { serverId: 'default', error: expect.stringContaining('TV payload from https://default.example/media/tv is not an object') },
    ])
    expect(Object.keys(result.fileServers)).toEqual(['server2'])
    // Retried like any failed fetch before giving up
    expect(headersSentTo('https://default.example/media/tv')).toHaveLength(4)
  })
})
