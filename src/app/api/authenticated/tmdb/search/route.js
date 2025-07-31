import { tmdbNodeServerURL } from '@src/utils/config'
import { isAuthenticatedEither } from '@src/utils/routeAuth'

/**
 * GET /api/authenticated/tmdb/search
 * Proxy TMDB search requests to backend server
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
      return Response.json(
        { error: 'Invalid type. Must be "movie" or "tv"' },
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
    
    // Proxy request to backend
    const response = await fetch(backendUrl.toString(), {
      method: 'GET',
      headers,
      // Add timeout
      signal: AbortSignal.timeout(15000)
    })

    if (!response.ok) {
      throw new Error(`Backend responded with ${response.status}`)
    }

    const data = await response.json()
    
    return Response.json(data)
    
  } catch (error) {
    console.error('TMDB search error:', error)
    
    return Response.json(
      {
        error: `TMDB search failed: ${error.message}`,
        results: []
      },
      { status: 500 }
    )
  }
}