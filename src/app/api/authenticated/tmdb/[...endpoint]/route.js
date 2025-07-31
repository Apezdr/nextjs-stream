import { tmdbNodeServerURL } from '@src/utils/config'
import { isAuthenticatedEither } from '@src/utils/routeAuth'

/**
 * Dynamic TMDB proxy route
 * GET /api/authenticated/tmdb/[...endpoint]
 * Proxies all other TMDB requests to backend server
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
  try {
    // Check authentication
    const authResult = await isAuthenticatedEither(request)
    if (authResult instanceof Response) {
      return authResult
    }
    const { endpoint } = params
    const { searchParams } = new URL(request.url)

    // Validate endpoint array
    if (!endpoint || !Array.isArray(endpoint) || endpoint.length === 0) {
      return Response.json(
        { error: 'Invalid endpoint' },
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
    const endpointPath = endpoint.join('/')
    const backendUrl = new URL(`${backendServerURL}/api/tmdb/${endpointPath}`)
    
    // Copy all search parameters
    searchParams.forEach((value, key) => {
      backendUrl.searchParams.append(key, value)
    })
    
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
      const errorText = await response.text()
      throw new Error(`Backend responded with ${response.status}: ${errorText}`)
    }

    const data = await response.json()
    
    return Response.json(data)
    
  } catch (error) {
    console.error('TMDB proxy error:', error)
    
    return Response.json(
      {
        error: `TMDB request failed: ${error.message}`,
        endpoint: params.endpoint?.join('/') || 'unknown'
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
    const authResult = await isAuthenticatedEither(request)
    if (authResult instanceof Response) {
      return authResult
    }
    const { endpoint } = params
    const body = await request.text()

    // Validate endpoint array
    if (!endpoint || !Array.isArray(endpoint) || endpoint.length === 0) {
      return Response.json(
        { error: 'Invalid endpoint' },
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
    const endpointPath = endpoint.join('/')
    const backendUrl = `${backendServerURL}/api/tmdb/${endpointPath}`
    
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
      method: 'POST',
      headers,
      body: body || null,
      // Add timeout
      signal: AbortSignal.timeout(15000)
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Backend responded with ${response.status}: ${errorText}`)
    }

    const data = await response.json()
    
    return Response.json(data)
    
  } catch (error) {
    console.error('TMDB proxy POST error:', error)
    
    return Response.json(
      {
        error: `TMDB POST request failed: ${error.message}`,
        endpoint: params.endpoint?.join('/') || 'unknown'
      },
      { status: 500 }
    )
  }
}