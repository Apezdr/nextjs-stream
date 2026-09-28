/**
 * @jest-environment node
 */
/**
 * httpGet's status handling. A deleted TMDB title once made a watchlist take
 * ~14 s per load: a 400 on the first fetch was cached and returned as the
 * payload, and every later 400 was retried with full backoff because the
 * thrown error carried no status.
 */

const mockGot = jest.fn()
jest.mock('got', () => ({ __esModule: true, default: (...args) => mockGot(...args) }))

const mockGetCache = jest.fn()
const mockSetCache = jest.fn()
jest.mock('@src/lib/cache', () => ({
  getCache: (...args) => mockGetCache(...args),
  setCache: (...args) => mockSetCache(...args),
}))

const { httpGet } = require('@src/lib/httpHelper')
// backendClient's rule: network errors, 429, 503 and 504
const { isRetryableBackendError: backendClientRule } = require('@src/utils/tmdb/backendClient')

const URL = 'http://backend.test/api/tmdb/comprehensive/tv?tmdb_id=275188'
const reply = (statusCode, body = '', headers = {}) => ({ statusCode, body, headers })
const fast = { baseDelay: 1, maxDelay: 1 }

beforeEach(() => {
  jest.clearAllMocks()
  mockGetCache.mockResolvedValue(null)
  mockSetCache.mockResolvedValue(undefined)
  jest.spyOn(Math, 'random').mockReturnValue(0) // no backoff jitter
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'debug').mockImplementation(() => {})
})

afterEach(() => jest.restoreAllMocks())

describe('httpGet status handling', () => {
  it('throws a 4xx on a first fetch, with its status, and caches nothing', async () => {
    mockGot.mockResolvedValue(reply(400, '{"error":"TMDB API request failed"}', { etag: 'W/"e"' }))

    await expect(httpGet(URL, { retry: fast })).rejects.toMatchObject({
      statusCode: 400,
      response: { statusCode: 400 },
    })
    expect(mockSetCache).not.toHaveBeenCalled()
    expect(mockGot).toHaveBeenCalledTimes(1)
  })

  it("does not retry a 4xx, even under backendClient's rule", async () => {
    mockGot.mockResolvedValue(reply(404, '{"error":"not found"}'))

    await expect(httpGet(URL, { retry: { ...fast, limit: 3, shouldRetry: backendClientRule } })).rejects.toMatchObject({
      statusCode: 404,
    })
    expect(mockGot).toHaveBeenCalledTimes(1)
  })

  it('keeps the error body for the caller, capped at 4 KB', async () => {
    const body = '{"error":"No tv with id 275188","code":"TMDB_NOT_FOUND"}'
    mockGot.mockResolvedValueOnce(reply(404, body))
    await expect(httpGet(URL, { retry: fast })).rejects.toMatchObject({ response: { body } })

    mockGot.mockResolvedValueOnce(reply(502, 'x'.repeat(10000)))
    const error = await httpGet(URL, { retry: { ...fast, shouldRetry: backendClientRule } }).catch((e) => e)
    expect(error.response.body).toHaveLength(4096)
  })

  it('logs a 404 as a warning, not an error with a stack trace', async () => {
    mockGot.mockResolvedValue(reply(404, '{"error":"not found"}'))

    await expect(httpGet(URL, { retry: fast })).rejects.toMatchObject({ statusCode: 404 })
    expect(console.warn).toHaveBeenCalledWith(`Not found (404): ${URL}`)
    expect(console.error).not.toHaveBeenCalled()
  })

  it('retries a 503 up to the limit and never sleeps after the last attempt', async () => {
    mockGot.mockResolvedValue(reply(503))

    await expect(httpGet(URL, { retry: { ...fast, limit: 2, shouldRetry: backendClientRule } })).rejects.toMatchObject({
      statusCode: 503,
    })
    expect(mockGot).toHaveBeenCalledTimes(3) // first try + 2 retries
    expect(console.warn).toHaveBeenCalledTimes(2) // one backoff per retry, none after the last
  })

  it.each([500, 502])("does not retry a %i under backendClient's rule", async (status) => {
    mockGot.mockResolvedValue(reply(status))

    await expect(httpGet(URL, { retry: { ...fast, limit: 3, shouldRetry: backendClientRule } })).rejects.toMatchObject({
      statusCode: status,
    })
    expect(mockGot).toHaveBeenCalledTimes(1)
  })

  it('still retries a network error', async () => {
    mockGot
      .mockRejectedValueOnce(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }))
      .mockResolvedValueOnce(reply(200, '{"name":"Show"}', { etag: 'W/"ok"' }))

    const result = await httpGet(URL, { retry: fast })
    expect(result.data).toEqual({ name: 'Show' })
    expect(mockGot).toHaveBeenCalledTimes(2)
  })

  it('caches a 2xx with its ETag and returns the body', async () => {
    mockGot.mockResolvedValue(reply(200, '{"name":"Show"}', { etag: 'W/"ok"' }))

    const result = await httpGet(URL, { retry: fast })
    expect(result.data).toEqual({ name: 'Show' })
    expect(mockSetCache).toHaveBeenCalledWith(
      URL,
      expect.objectContaining({ data: { name: 'Show' } }),
      'W/"ok"',
      null
    )
  })

  it('serves the cached payload on a 304 when asked to', async () => {
    mockGetCache.mockResolvedValue({ data: { _dataType: 'json', _isBuffer: false, data: { name: 'Show' } }, etag: 'W/"ok"' })
    mockGot.mockResolvedValue(reply(304))

    const result = await httpGet(URL, { retry: fast }, true)
    expect(result.data).toEqual({ name: 'Show' })
    expect(mockGot.mock.calls[0][1].headers['If-None-Match']).toBe('W/"ok"')
  })

  it("answers a 304 with data: null when nothing is cached here (the caller's own If-None-Match)", async () => {
    mockGot.mockResolvedValue(reply(304))

    const result = await httpGet(URL, { headers: { 'If-None-Match': 'W/"theirs"' }, retry: fast })
    expect(result.data).toBeNull()
    expect(mockGot).toHaveBeenCalledTimes(1)
  })
})
