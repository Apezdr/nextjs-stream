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

// The cache lines go through the app's pino logger: capture its records
const mockLogDebug = jest.fn()
const mockLogError = jest.fn()
jest.mock('@src/lib/logger', () => ({
  createLogger: () => ({
    debug: (...args) => mockLogDebug(...args),
    error: (...args) => mockLogError(...args),
    warn: jest.fn(),
    info: jest.fn(),
  }),
  logError: jest.fn(),
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

describe('what a failed request logs', () => {
  const { loggableUrl } = require('@src/lib/httpHelper')
  const FILE = 'https://files.example/movies/Caf%C3%A9%20(2001)/metadata.json?hash=0123abcd'

  /** got's RequestError carries options, timings and agents: thousands of lines when printed whole. */
  const requestError = () =>
    Object.assign(new Error("Timeout awaiting 'request' for 5000ms"), {
      name: 'RequestError',
      code: 'ETIMEDOUT',
      options: { agent: { http2: { sessions: Array.from({ length: 50 }, (_, i) => ({ i, buffer: 'x'.repeat(200) })) } } },
      timings: { start: 1, phases: { total: 5000 } },
    })

  it('is one line under 300 characters with the URL, the attempts, and the error’s name, code and message', async () => {
    mockGot.mockRejectedValue(requestError())

    const error = await httpGet(FILE, { retry: { ...fast, limit: 2 } }).catch((e) => e)

    // The same error, after the same attempts
    expect(error.code).toBe('ETIMEDOUT')
    expect(mockGot).toHaveBeenCalledTimes(3)
    expect(console.error).toHaveBeenCalledTimes(1)
    const [line, ...rest] = console.error.mock.calls[0]
    expect(rest).toEqual([])
    expect(line).toBe(
      `Failed to fetch ${FILE} after 3 attempts: RequestError ETIMEDOUT: Timeout awaiting 'request' for 5000ms`
    )
    expect(line.length).toBeLessThan(300)
    // Each retry is one line too, naming the error
    expect(console.warn.mock.calls.map(([warning, ...more]) => [warning.length < 300, more.length])).toEqual([
      [true, 0],
      [true, 0],
    ])
    expect(console.warn.mock.calls[0][0]).toContain('RequestError ETIMEDOUT')
    // The stack only with DEBUG
    expect(console.debug).not.toHaveBeenCalledWith(expect.stringContaining('Error:'))
  })

  it('names the HTTP status when there is one', async () => {
    mockGot.mockResolvedValue(reply(503))

    await httpGet(FILE, { retry: { ...fast, limit: 0 } }).catch(() => {})

    expect(console.error.mock.calls[0][0]).toMatch(/after 1 attempt: \w+ HTTP 503: /)
  })

  it('keeps a file’s query as it is, and hides a credential in the URL', () => {
    expect(loggableUrl(FILE)).toBe(FILE)
    expect(loggableUrl('https://sonarr.example/feed/calendar/Sonarr.ics?apikey=s3cr3t&unmonitored=true')).toBe(
      'https://sonarr.example/feed/calendar/Sonarr.ics?apikey=REDACTED&unmonitored=true'
    )
    expect(loggableUrl('https://user:pass@files.example/a.json')).not.toContain('pass')
  })
})

describe('the cache log lines', () => {
  const FEED = 'https://sonarr.example/feed/calendar/Sonarr.ics?apikey=s3cr3t&unmonitored=true'
  const FILE = 'https://files.example/movies/Caf%C3%A9%20(2001)/metadata.json?hash=0123abcd'
  // One record per call: the message and its fields
  const records = () => mockLogDebug.mock.calls.map(([fields, msg]) => ({ msg, ...fields }))
  const noKey = () => {
    for (const record of records()) expect(JSON.stringify(record)).not.toContain('s3cr3t')
  }

  it('STORE: shows a feed URL with its API key REDACTED', async () => {
    mockGot.mockResolvedValue(reply(200, 'BEGIN:VCALENDAR'))

    await httpGet(FEED, { responseType: 'text', retry: fast })

    expect(records()).toContainEqual({
      msg: 'Cache store',
      url: 'https://sonarr.example/feed/calendar/Sonarr.ics?apikey=REDACTED&unmonitored=true',
      type: 'text',
      size: '15 Bytes',
    })
    noKey()
  })

  it('HIT: shows a feed URL with its API key REDACTED', async () => {
    mockGetCache.mockResolvedValue({ data: 'BEGIN:VCALENDAR', etag: 'W/"ics"' })
    mockGot.mockResolvedValue(reply(304))

    await httpGet(FEED, { responseType: 'text', retry: fast }, true)

    expect(records().find((record) => record.msg === 'Cache hit').url).toContain('?apikey=REDACTED&unmonitored=true')
    noKey()
  })

  it('MISS: shows a feed URL with its API key REDACTED', async () => {
    // A cached buffer that is not one: a miss, then a fresh answer
    mockGetCache.mockResolvedValue({ data: { _dataType: 'buffer', data: 42 }, etag: 'W/"b"' })
    mockGot.mockResolvedValueOnce(reply(304)).mockResolvedValueOnce({ ...reply(200), rawBody: Buffer.from('abc') })

    await httpGet(FEED, { responseType: 'buffer', retry: fast }, true)

    expect(records().find((record) => record.msg === 'Cache miss')).toEqual({
      msg: 'Cache miss',
      url: 'https://sonarr.example/feed/calendar/Sonarr.ics?apikey=REDACTED&unmonitored=true',
      reason: 'invalid buffer format in cache',
    })
    noKey()
  })

  it('shows a file URL exactly as it was asked for, its hash included', async () => {
    mockGot.mockResolvedValue(reply(200, '{"title":"Film"}'))

    await httpGet(FILE, { retry: fast })

    expect(records().find((record) => record.msg === 'Cache store')).toEqual({
      msg: 'Cache store',
      url: FILE,
      type: 'json',
      size: '0 Bytes',
    })
  })

  it('a 503 on a feed URL logs no key: not in the retry warnings, not in the final line', async () => {
    mockGot.mockResolvedValue(reply(503))

    const error = await httpGet(FEED, { responseType: 'text', retry: { ...fast, limit: 2, shouldRetry: backendClientRule } }).catch(
      (e) => e
    )

    // The thrown error is unchanged: its callers see the same error
    expect(error.message).toBe(`HTTP Error: 503 for URL: ${FEED}`)
    expect(mockGot).toHaveBeenCalledTimes(3)
    const logged = [...console.warn.mock.calls, ...console.error.mock.calls, ...mockLogDebug.mock.calls, ...mockLogError.mock.calls]
      .flat()
      .map((entry) => (typeof entry === 'string' ? entry : JSON.stringify(entry)))
    expect(console.warn).toHaveBeenCalledTimes(2)
    for (const line of logged) expect(line).not.toContain('s3cr3t')
    const redacted = 'https://sonarr.example/feed/calendar/Sonarr.ics?apikey=REDACTED&unmonitored=true'
    expect(console.error.mock.calls[0][0]).toBe(
      `Failed to fetch ${redacted} after 3 attempts: Error HTTP 503: HTTP Error: 503 for URL: ${redacted}`
    )
    expect(console.warn.mock.calls[0][0]).toContain(`HTTP Error: 503 for URL: ${redacted}`)
  })
})
