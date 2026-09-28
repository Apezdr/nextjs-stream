/**
 * @jest-environment node
 */
/**
 * The TMDB proxy passes the media processor's verdict on instead of turning
 * every failure into a 500, and tries again only when another try can help.
 * Before, a title TMDB no longer has reached the clients as a 500, and the
 * POST handler retried every 4xx: the error it threw landed in its own catch
 * looking like a network failure.
 */

jest.mock('@src/utils/routeAuth', () => ({
  isAuthenticatedAndApproved: jest.fn(async () => ({ id: 'user-1' })),
}))
jest.mock('@src/utils/backendAuth', () => ({
  getBackendAuthHeaders: jest.fn(async () => ({ Authorization: 'Bearer token' })),
}))

const mockHttpGet = jest.fn()
jest.mock('@src/lib/httpHelper', () => ({ httpGet: (...args) => mockHttpGet(...args) }))

const mockFetchTmdbFromBackend = jest.fn()
jest.mock('@src/utils/tmdb/backendClient', () => ({
  ...jest.requireActual('@src/utils/tmdb/backendClient'),
  fetchTmdbFromBackend: (...args) => mockFetchTmdbFromBackend(...args),
}))

const { GET, POST } = require('@src/app/api/authenticated/tmdb/[...endpoint]/route')
const { GET: getDetailsRoute } = require('@src/app/api/authenticated/tmdb/details/[type]/[id]/route')
const { isRetryableBackendError } = require('@src/utils/tmdb/backendClient')

// The shape httpGet throws for a non-2xx answer
const statusError = (statusCode, body = '') =>
  Object.assign(new Error(`HTTP Error: ${statusCode}`), {
    statusCode,
    response: { statusCode, headers: {}, body },
  })

const NOT_FOUND = '{"error":"No tv with id 275188","code":"TMDB_NOT_FOUND"}'
const BASE = 'https://cinema.example/api/authenticated/tmdb'

const get = (endpoint) =>
  GET(new Request(`${BASE}/${endpoint.join('/')}?tmdb_id=275188`), {
    params: Promise.resolve({ endpoint }),
  })

const post = (endpoint) =>
  POST(new Request(`${BASE}/${endpoint.join('/')}`, { method: 'POST', body: '{}' }), {
    params: Promise.resolve({ endpoint }),
  })

const answer = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'error').mockImplementation(() => {})
  // Backoff sleeps resolve at once
  jest.spyOn(global, 'setTimeout').mockImplementation((fn) => {
    fn()
    return 0
  })
  global.fetch = jest.fn()
})

afterEach(() => jest.restoreAllMocks())

describe('GET', () => {
  it("passes a title TMDB doesn't have through as a 404 with its code", async () => {
    mockFetchTmdbFromBackend.mockRejectedValue(statusError(404, NOT_FOUND))

    const res = await get(['comprehensive', 'tv'])
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({
      error: 'No tv with id 275188',
      code: 'TMDB_NOT_FOUND',
      endpoint: 'comprehensive/tv',
    })
    expect(console.error).not.toHaveBeenCalled()
  })

  it('passes a 502 through and logs it', async () => {
    mockFetchTmdbFromBackend.mockRejectedValue(statusError(502, '{"error":"TMDB is down","code":"TMDB_UNAVAILABLE"}'))

    const res = await get(['comprehensive', 'movie'])
    expect(res.status).toBe(502)
    expect((await res.json()).code).toBe('TMDB_UNAVAILABLE')
    expect(console.error).toHaveBeenCalled()
  })

  it('answers 500 for a failure with no status of its own', async () => {
    mockFetchTmdbFromBackend.mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }))

    const res = await get(['comprehensive', 'movie'])
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/ECONNREFUSED/)
  })
})

describe('POST', () => {
  it('gives up on a 4xx after one request and passes it through', async () => {
    global.fetch.mockResolvedValue(answer(404, JSON.parse(NOT_FOUND)))

    const res = await post(['some', 'endpoint'])
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ code: 'TMDB_NOT_FOUND', endpoint: 'some/endpoint' })
  })

  it('does not retry a 500', async () => {
    global.fetch.mockResolvedValue(answer(500, { error: 'boom' }))

    const res = await post(['some', 'endpoint'])
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('boom')
  })

  it('retries a 503 and returns the answer that follows', async () => {
    global.fetch
      .mockResolvedValueOnce(answer(503, { error: 'busy' }))
      .mockResolvedValueOnce(answer(200, { results: [] }))

    const res = await post(['some', 'endpoint'])
    expect(global.fetch).toHaveBeenCalledTimes(2)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ results: [] })
  })

  it('retries a network error up to the limit, then answers 500', async () => {
    global.fetch.mockRejectedValue(new TypeError('fetch failed'))

    const res = await post(['some', 'endpoint'])
    expect(global.fetch).toHaveBeenCalledTimes(4) // first try + 3 retries
    expect(res.status).toBe(500)
  })
})

describe('details route', () => {
  const getDetails = () =>
    getDetailsRoute(new Request(`${BASE}/details/tv/275188`), {
      params: Promise.resolve({ type: 'tv', id: '275188' }),
    })

  it("passes a title TMDB doesn't have through as a 404, retrying only by the shared rule", async () => {
    mockHttpGet.mockRejectedValue(statusError(404, NOT_FOUND))

    const res = await getDetails()
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'No tv with id 275188', code: 'TMDB_NOT_FOUND' })
    expect(mockHttpGet.mock.calls[0][1].retry.shouldRetry).toBe(isRetryableBackendError)
  })
})
