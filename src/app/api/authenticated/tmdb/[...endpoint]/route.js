import { isAuthenticatedAndApproved } from '@src/utils/routeAuth'
import { getBackendAuthHeaders } from '@src/utils/backendAuth'
import { fetchTmdbFromBackend, unwrapCachedEnvelope } from '@src/utils/tmdb/backendClient'
import { hasMatchingETag, createNotModifiedResponse } from '@src/utils/cache/etagHelpers'

/**
 * Dynamic TMDB proxy route
 * GET /api/authenticated/tmdb/[...endpoint]
 * Proxies all other TMDB requests to backend server with enhanced retry and caching
 *
 * Handles endpoints like:
 * - /comprehensive/movie or /comprehensive/tv
 * - /cast/movie/123 or /cast/tv/456
 * - /videos/movie/123
 * - /images/movie/123
 * - /rating/movie/123
 * - /episode/123/1/1
 * - /episode/123/1/1/images
 */
export async function GET(request, { params }) {
  const { endpoint } = await params
  
  try {
    // Check authentication
    const authResult = await isAuthenticatedAndApproved(request)
    if (authResult instanceof Response) {
      return authResult
    }
    const { searchParams } = new URL(request.url)

    // Validate endpoint array
    if (!endpoint || !Array.isArray(endpoint) || endpoint.length === 0) {
      return Response.json({ error: 'Invalid endpoint' }, { status: 400 })
    }

    // Build query params for the shared backend client
    const endpointPath = endpoint.join('/')
    const params = {}
    searchParams.forEach((value, key) => {
      params[key] = value
    })

    // Shared transport: Redis body+ETag cache with If-None-Match revalidation
    // against the backend, cached body served on 304. Serve-from-cache is
    // unconditional inside fetchTmdbFromBackend — httpGet stores every 2xx
    // regardless, so a non-serving caller would receive `data: null` once the
    // backend starts answering 304 (previously a latent bug here for the
    // endpoints outside the old shouldCache list).
    const { data, headers: backendHeaders } = await fetchTmdbFromBackend(endpointPath, params, {
      authHeaders: await getBackendAuthHeaders(request),
    })

    // Propagate the backend's content ETag so this proxy's own clients
    // (RN/TV app, browser) can revalidate against us the same way we
    // revalidate against the backend
    const backendETag = backendHeaders?.etag || null
    if (backendETag && hasMatchingETag(request, backendETag)) {
      return createNotModifiedResponse(backendETag)
    }

    return Response.json(
      data,
      backendETag
        ? { headers: { ETag: backendETag, 'Cache-Control': 'no-cache' } }
        : undefined
    )
  } catch (error) {
    console.error('TMDB proxy error:', error)

    return Response.json(
      {
        error: `TMDB request failed: ${error.message}`,
        endpoint: endpoint?.join('/') || 'unknown',
      },
      { status: 500 }
    )
  }
}

/**
 * POST /api/authenticated/tmdb/[...endpoint]
 * Handle POST requests for endpoints that require them
 */
export async function POST(request, { params }) {
  try {
    // Check authentication
    const authResult = await isAuthenticatedAndApproved(request)
    if (authResult instanceof Response) {
      return authResult
    }
    const { endpoint } = await params
    const body = await request.text()

    // Validate endpoint array
    if (!endpoint || !Array.isArray(endpoint) || endpoint.length === 0) {
      return Response.json({ error: 'Invalid endpoint' }, { status: 400 })
    }

    // Using NODE_SERVER_INTERNAL_URL for server-to-server TMDB proxy requests; fallback to NODE_SERVER_URL when not configured
    const backendServerURL =
      process.env.NODE_SERVER_INTERNAL_URL || process.env.NODE_SERVER_URL || 'http://localhost:3000'

    // Check if backend server is configured
    if (!backendServerURL) {
      return Response.json({ error: 'Backend/TMDB server URL not configured' }, { status: 503 })
    }

    // Build backend URL with correct path
    const endpointPath = endpoint.join('/')
    const backendUrl = `${backendServerURL}/api/tmdb/${endpointPath}`

    // Build headers with authentication
    const headers = {
      'Content-Type': 'application/json',
      ...await getBackendAuthHeaders(request),
    }

    // For POST requests, we'll use a more direct approach since httpGet is optimized for GET
    // but still add retry logic
    let lastError
    const maxRetries = 3

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(backendUrl, {
          method: 'POST',
          headers,
          body: body || null,
          signal: AbortSignal.timeout(15000),
        })

        if (!response.ok) {
          const errorText = await response.text()
          const error = new Error(`Backend responded with ${response.status}: ${errorText}`)

          // Only retry on server errors or timeout
          if (response.status >= 500 || response.status === 429) {
            lastError = error
            if (attempt < maxRetries) {
              const delay = Math.min(1000 * Math.pow(2, attempt), 5000)
              await new Promise((resolve) => setTimeout(resolve, delay))
              continue
            }
          }
          throw error
        }

        const data = await response.json()
        return Response.json(unwrapCachedEnvelope(data))
      } catch (error) {
        lastError = error
        if (attempt < maxRetries && (!error.response || error.response.status >= 500)) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 5000)
          await new Promise((resolve) => setTimeout(resolve, delay))
          continue
        }
        break
      }
    }

    throw lastError
  } catch (error) {
    console.error('TMDB proxy POST error:', error)

    return Response.json(
      {
        error: `TMDB POST request failed: ${error.message}`,
        endpoint: params.endpoint?.join('/') || 'unknown',
      },
      { status: 500 }
    )
  }
}
