import { httpGet } from '@src/lib/httpHelper'
import { isRetryableTmdbStatus } from './retryPolicy'

/**
 * Direct server-to-backend TMDB transport.
 *
 * Shared by the HTTP proxy route (/api/authenticated/tmdb/[...endpoint]) and
 * server-side resolvers (mediaResolver's batchResolveMedia). Server-side
 * callers previously reached the backend via self-HTTP through the proxy
 * route — paying Next routing plus per-item session validation even for 304s.
 * Calling the backend directly through httpGet keeps the Redis body+ETag
 * cache and If-None-Match revalidation (the backend emits content ETags), so
 * repeat requests are bodyless 304s served from cache with no session cost.
 */

function backendBaseURL() {
  // NODE_SERVER_INTERNAL_URL for server-to-server requests; fallback chain
  // matches the proxy route's historical behavior
  return process.env.NODE_SERVER_INTERNAL_URL || process.env.NODE_SERVER_URL || 'http://localhost:3000'
}

/**
 * Whether a failed backend request is worth another try (retryPolicy.js).
 * Reads the status httpGet puts on error.response, or fetch's `status` for
 * callers that build their own errors.
 * @param {Error} error
 * @returns {boolean}
 */
export function isRetryableBackendError(error) {
  return isRetryableTmdbStatus(error?.response?.statusCode ?? error?.response?.status)
}

/**
 * The client-facing answer for a failed backend request, or null when the
 * error carries no HTTP status (a network failure the caller answers itself).
 *
 * The media processor's status and body are its verdict: a 404 with code
 * TMDB_NOT_FOUND for a title TMDB doesn't have, a 400 for bad input, a 429
 * with Retry-After, a 502 when TMDB is down. Passing them on lets the web
 * clients tell "not on TMDB" from an outage, which a blanket 500 hid.
 * @param {Error} error - From httpGet (statusCode + response.body)
 * @param {string} [endpointPath] - Echoed in the body when given, e.g. 'comprehensive/tv'
 * @returns {Response|null}
 */
export function backendErrorResponse(error, endpointPath) {
  const status = error?.statusCode ?? error?.response?.status
  if (!Number.isInteger(status) || status < 400 || status > 599) return null

  let body = null
  try {
    body = JSON.parse(error.response?.body ?? '')
  } catch {
    // Not JSON (an HTML error page, an empty body): answer with our own words
  }

  // A 401 or 403 is the media processor refusing this server's credentials.
  // The proxy checked the caller's session before asking, so passing it on
  // would tell a signed-in user they aren't. To them it's a bad gateway.
  const refused = status === 401 || status === 403
  const payload = {
    error: typeof body?.error === 'string' ? body.error : `TMDB request failed with status ${status}`,
    ...(typeof body?.code === 'string' ? { code: body.code } : {}),
    ...(refused ? { upstreamStatus: status } : {}),
    ...(endpointPath ? { endpoint: endpointPath } : {}),
  }
  const init = { status: refused ? 502 : status }
  const retryAfter = error.response?.headers?.['retry-after']
  if (retryAfter) init.headers = { 'Retry-After': String(retryAfter) }
  return Response.json(payload, init)
}

/**
 * httpHelper caches JSON/text responses wrapped as `{ _dataType, _isBuffer, data }`.
 * On a cache hit that envelope can reach us instead of the bare body. Unwrap it
 * before returning; a no-op for already-unwrapped fresh bodies.
 */
export function unwrapCachedEnvelope(payload) {
  if (
    payload &&
    typeof payload === 'object' &&
    !Array.isArray(payload) &&
    (payload._dataType === 'json' || payload._dataType === 'text') &&
    'data' in payload
  ) {
    return payload.data
  }
  return payload
}

/**
 * Fetch a TMDB endpoint from the backend media processor.
 *
 * @param {string} endpointPath - Path after /api/tmdb/, e.g. 'comprehensive/movie'
 * @param {Object} [params={}] - Query parameters (null/undefined values omitted)
 * @param {Object} [options={}]
 * @param {Object|null} [options.authHeaders=null] - Explicit auth headers
 *   (e.g. from getBackendAuthHeaders). When absent, the caller's request
 *   credentials are forwarded via next/headers — the backend accepts either
 *   a session cookie or Authorization: Bearer.
 * @param {number} [options.timeout=15000]
 * @returns {Promise<{ data: any, headers: Object }>} Unwrapped body + response
 *   headers (including the backend's ETag for pass-through).
 */
export async function fetchTmdbFromBackend(endpointPath, params = {}, options = {}) {
  const { authHeaders = null, timeout = 15000 } = options

  const url = new URL(`${backendBaseURL()}/api/tmdb/${endpointPath}`)
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined) {
      url.searchParams.append(key, String(value))
    }
  })

  const headers = { 'Content-Type': 'application/json' }
  if (authHeaders && typeof authHeaders === 'object' && Object.keys(authHeaders).length > 0) {
    Object.assign(headers, authHeaders)
  } else {
    // No explicit auth supplied — forward the calling request's credentials
    try {
      const { headers: nextHeaders } = await import('next/headers')
      const requestHeaders = await nextHeaders()
      const authorization = requestHeaders.get('authorization')
      const cookie = requestHeaders.get('cookie')
      if (authorization?.startsWith('Bearer ')) {
        headers['Authorization'] = authorization
      } else if (cookie) {
        headers['cookie'] = cookie
      }
    } catch {
      // Outside a request context — proceed and let the backend decide
    }
  }

  const response = await httpGet(
    url.toString(),
    {
      headers,
      timeout,
      responseType: 'json',
      retry: {
        limit: 3,
        baseDelay: 1000,
        maxDelay: 5000,
        shouldRetry: isRetryableBackendError,
      },
    },
    // Always serve the Redis-cached body on a 304. This must be unconditional:
    // httpGet stores body+ETag for every 2xx regardless of this flag, so once
    // the backend starts answering 304 a caller that passed `false` here would
    // receive `data: null`.
    true
  )

  return { data: unwrapCachedEnvelope(response.data), headers: response.headers ?? {} }
}
