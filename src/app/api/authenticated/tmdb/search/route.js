import { tmdbNodeServerURL } from '@src/utils/config'
import { isAuthenticatedEither } from '@src/utils/routeAuth'
import { httpGet } from '@src/lib/httpHelper'

/**
 * GET /api/authenticated/tmdb/search
 * Proxy TMDB search requests to backend server with enhanced retry and caching
 * Query params:
 * - type: 'movie' or 'tv'
 * - query: search term
 * - page: page number (optional)
 */
export async function GET(request) {
  try {
    // Check authentication
    const authResult = await isAuthenticatedEither(request)
    if (authResult instanceof Response) {
      return authResult
    }
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type')
    const query = searchParams.get('query')
    const page = searchParams.get('page') || '1'

    // Validate required parameters
    if (!type || !query) {
      return Response.json(
        { error: 'Missing required parameters: type and query' },
        { status: 400 }
      )
    }

    if (!['movie', 'tv'].includes(type)) {
      return Response.json({ error: 'Invalid type. Must be "movie" or "tv"' }, { status: 400 })
    }

    // Using NODE_SERVER_INTERNAL_URL for server-to-server TMDB proxy requests; fallback to NODE_SERVER_URL when not configured
    const backendServerURL =
      process.env.NODE_SERVER_INTERNAL_URL || process.env.NODE_SERVER_URL || 'http://localhost:3000'

    // Check if backend server is configured
    if (!backendServerURL) {
      return Response.json({ error: 'Backend/TMDB server URL not configured' }, { status: 503 })
    }

    // Build backend URL with correct path
    const backendUrl = new URL(`${backendServerURL}/api/tmdb/search/${type}`)
    backendUrl.searchParams.set('query', query)
    backendUrl.searchParams.set('page', page)

    console.log('🔍 TMDB Search URL:', backendUrl.toString())

    // Build headers with authentication
    const headers = {
      'Content-Type': 'application/json',
    }

    // Forward cookies for authentication with backend
    if (request.headers.get('cookie')) {
      headers['cookie'] = request.headers.get('cookie')
    }

    // Use enhanced HTTP client with retry and caching
    const response = await httpGet(
      backendUrl.toString(),
      {
        headers,
        timeout: 15000,
        responseType: 'json',
        retry: {
          limit: 3,
          baseDelay: 1000,
          maxDelay: 5000,
          shouldRetry: (error, attemptCount) => {
            // Retry on network errors and 5xx/429 status codes
            if (!error.response) return true
            const statusCode = error.response.statusCode
            return statusCode >= 500 || statusCode === 429
          },
        },
      },
      true
    ) // Enable cache for search results

    return Response.json(response.data)
  } catch (error) {
    console.error('TMDB search error:', error)

    return Response.json(
      {
        error: `TMDB search failed: ${error.message}`,
        results: [],
      },
      { status: 500 }
    )
  }
}
