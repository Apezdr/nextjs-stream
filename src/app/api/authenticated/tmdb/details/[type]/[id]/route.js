import { tmdbNodeServerURL } from '@src/utils/config'
import { isAuthenticatedEither } from '@src/utils/routeAuth'
import { httpGet } from '@src/lib/httpHelper'

/**
 * GET /api/authenticated/tmdb/details/[type]/[id]
 * Proxy TMDB details requests to backend server with enhanced retry and caching
 * Params:
 * - type: 'movie' or 'tv'
 * - id: TMDB media ID
 */
export async function GET(request, { params }) {
  try {
    // Check authentication
    const authResult = await isAuthenticatedEither(request)
    if (authResult instanceof Response) {
      return authResult
    }
    const { type, id } = await params

    // Validate parameters
    if (!type || !id) {
      return Response.json(
        { error: 'Missing required parameters: type and id' },
        { status: 400 }
      )
    }

    if (!['movie', 'tv'].includes(type)) {
      return Response.json(
        { error: 'Invalid type. Must be "movie" or "tv"' },
        { status: 400 }
      )
    }

    const mediaId = parseInt(id)
    if (isNaN(mediaId) || mediaId <= 0) {
      return Response.json(
        { error: 'Invalid media ID' },
        { status: 400 }
      )
    }

    // Use base server URL to avoid double paths
    const backendServerURL = process.env.NEXT_PUBLIC_NODE_SERVER_URL
    
    // Check if backend server is configured
    if (!backendServerURL) {
      return Response.json(
        { error: 'Backend/TMDB server URL not configured' },
        { status: 503 }
      )
    }

    // Build backend URL with correct path
    const backendUrl = `${backendServerURL}/api/tmdb/details/${type}/${mediaId}`
    
    // Build headers with authentication
    const headers = {
      'Content-Type': 'application/json',
    }
    
    // Forward cookies for authentication with backend
    if (request.headers.get('cookie')) {
      headers['cookie'] = request.headers.get('cookie')
    }
    
    // Use enhanced HTTP client with retry and caching
    const response = await httpGet(backendUrl, {
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
        }
      }
    }, true) // Enable cache for details - they don't change often
    
    return Response.json(response.data)
    
  } catch (error) {
    console.error('TMDB details error:', error)
    
    return Response.json(
      {
        error: `TMDB details failed: ${error.message}`
      },
      { status: 500 }
    )
  }
}
