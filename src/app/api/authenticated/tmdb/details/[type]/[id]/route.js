import { tmdbNodeServerURL } from '@src/utils/config'
import { isAuthenticatedEither } from '@src/utils/routeAuth'

/**
 * GET /api/authenticated/tmdb/details/[type]/[id]
 * Proxy TMDB details requests to backend server
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
    const { type, id } = params

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
    
    // Proxy request to backend
    const response = await fetch(backendUrl, {
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
    console.error('TMDB details error:', error)
    
    return Response.json(
      {
        error: `TMDB details failed: ${error.message}`
      },
      { status: 500 }
    )
  }
}