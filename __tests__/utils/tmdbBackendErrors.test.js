/**
 * @jest-environment node
 */
/**
 * What the TMDB proxy tells its clients when the media processor says no, and
 * which failures are tried again. A title TMDB no longer has used to reach the
 * clients as a 500, and every 500 and 502 was retried with full backoff.
 */

jest.mock('@src/lib/httpHelper', () => ({ httpGet: jest.fn() }))

const { isRetryableTmdbStatus } = require('@src/utils/tmdb/retryPolicy')
const { backendErrorResponse, isRetryableBackendError } = require('@src/utils/tmdb/backendClient')

// The shape httpGet throws for a non-2xx answer
const statusError = (statusCode, body = '', headers = {}) =>
  Object.assign(new Error(`HTTP Error: ${statusCode}`), {
    statusCode,
    response: { statusCode, headers, body },
  })

describe('isRetryableTmdbStatus', () => {
  it.each([429, 503, 504])('retries %i', (status) => {
    expect(isRetryableTmdbStatus(status)).toBe(true)
  })

  it.each([400, 401, 403, 404, 500, 502])('gives up on %i', (status) => {
    expect(isRetryableTmdbStatus(status)).toBe(false)
  })

  it('retries a request that got no answer, or one that broke off mid-body', () => {
    expect(isRetryableTmdbStatus(undefined)).toBe(true)
    expect(isRetryableTmdbStatus(null)).toBe(true)
    expect(isRetryableTmdbStatus(200)).toBe(true)
  })
})

describe('isRetryableBackendError', () => {
  it("reads httpGet's statusCode and fetch's status", () => {
    expect(isRetryableBackendError(statusError(503))).toBe(true)
    expect(isRetryableBackendError(statusError(404))).toBe(false)
    expect(isRetryableBackendError({ response: { status: 429 } })).toBe(true)
    expect(isRetryableBackendError({ response: { status: 500 } })).toBe(false)
  })

  it('retries a network error', () => {
    const error = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })
    expect(isRetryableBackendError(error)).toBe(true)
  })
})

describe('backendErrorResponse', () => {
  it("passes a 404 through with the backend's message and code", async () => {
    const error = statusError(404, JSON.stringify({ error: 'No tv with id 275188', code: 'TMDB_NOT_FOUND' }))

    const res = backendErrorResponse(error, 'comprehensive/tv')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({
      error: 'No tv with id 275188',
      code: 'TMDB_NOT_FOUND',
      endpoint: 'comprehensive/tv',
    })
  })

  it('answers in its own words when the body is not JSON', async () => {
    const res = backendErrorResponse(statusError(502, '<html>Bad Gateway</html>'))
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'TMDB request failed with status 502' })
  })

  it("passes a 429's Retry-After on", () => {
    const error = statusError(429, '{"error":"Too many requests","code":"TMDB_RATE_LIMITED"}', { 'retry-after': '7' })

    const res = backendErrorResponse(error)
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('7')
  })

  it.each([401, 403])("answers 502 when the backend refuses this server's credentials (%i)", async (status) => {
    const res = backendErrorResponse(statusError(status, '{"error":"Unauthorized"}'))
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'Unauthorized', upstreamStatus: status })
  })

  it('leaves an error with no HTTP status to the caller', () => {
    expect(backendErrorResponse(new Error('socket hang up'))).toBeNull()
    expect(backendErrorResponse(null)).toBeNull()
  })

  it("reads the POST handler's errors, which carry fetch's status", async () => {
    const error = Object.assign(new Error('Backend responded with 400'), {
      statusCode: 400,
      response: { status: 400, headers: { 'retry-after': null }, body: '{"error":"query is required"}' },
    })

    const res = backendErrorResponse(error, 'search/collection')
    expect(res.status).toBe(400)
    expect(res.headers.get('retry-after')).toBeNull()
    expect(await res.json()).toEqual({ error: 'query is required', endpoint: 'search/collection' })
  })
})
