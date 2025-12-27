import { isAuthenticatedEither } from '@src/utils/routeAuth'
import { httpGet } from '@src/lib/httpHelper'

/**
 * GET /api/authenticated/tmdb/collection/[collectionId]
 * Proxy TMDB collection requests to backend server with enhanced retry and caching
 * Params:
 * - collectionId: TMDB collection ID
 */
export async function GET(request, { params }) {
  try {
    // Check authentication
    const authResult = await isAuthenticatedEither(request)
    if (authResult instanceof Response) {
      return authResult
    }
    const { collectionId } = await params

    // Validate collection ID
    if (!collectionId) {
      return Response.json(
        { error: 'Missing required parameter: collectionId' },
        { status: 400 }
      )
    }

    const collectionIdInt = parseInt(collectionId)
    if (isNaN(collectionIdInt) || collectionIdInt <= 0) {
      return Response.json(
        { error: 'Invalid collection ID' },
        { status: 400 }
      )
    }

    // Use base server URL to avoid double paths
    const backendServerURL = process.env.NODE_SERVER_URL
    
    // Check if backend server is configured
    if (!backendServerURL) {
      return Response.json(
        { error: 'Backend/TMDB server URL not configured' },
        { status: 503 }
      )
    }

    // Extract query parameters from the request URL
    const url = new URL(request.url)
    const enhanced = url.searchParams.get('enhanced')
    
    // Build backend URL with correct path
    let backendUrl = `${backendServerURL}/api/tmdb/collection/${collectionIdInt}`
    
    // Forward the enhanced parameter to the backend if present
    if (enhanced === 'true') {
      backendUrl += '?enhanced=true'
    }
    
    console.log('🎬 TMDB Collection URL:', backendUrl)
    
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
    }, true) // Enable cache for collection details - they don't change often
    
    return Response.json(response.data)
    
  } catch (error) {
    console.error('TMDB collection error:', error)
    
    return Response.json(
      {
        error: `TMDB collection failed: ${error.message}`,
        collectionId: params.collectionId
      },
      { status: 500 }
    )
  }
}