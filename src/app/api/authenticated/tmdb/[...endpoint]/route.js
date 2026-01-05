import { tmdbNodeServerURL } from '@src/utils/config'
import { isAuthenticatedEither } from '@src/utils/routeAuth'
import { httpGet } from '@src/lib/httpHelper'

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
  try {
    // Check authentication
    const authResult = await isAuthenticatedEither(request)
    if (authResult instanceof Response) {
      return authResult
    }
    const { endpoint } = await params
    const { searchParams } = new URL(request.url)

    // Validate endpoint array
    if (!endpoint || !Array.isArray(endpoint) || endpoint.length === 0) {
      return Response.json(
        { error: 'Invalid endpoint' },
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
    
    // Determine caching strategy based on endpoint
    const shouldCache = endpointPath.includes('images') ||
                       endpointPath.includes('cast') ||
                       endpointPath.includes('videos') ||
                       endpointPath.includes('comprehensive')
    
    // Use enhanced HTTP client with retry and caching
    const response = await httpGet(backendUrl.toString(), {
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
    }, shouldCache, shouldCache) // Cache based on endpoint type, disable ETag headers for fresh data
    
    return Response.json(response.data)
    
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
    const { endpoint } = await params
    const body = await request.text()

    // Validate endpoint array
    if (!endpoint || !Array.isArray(endpoint) || endpoint.length === 0) {
      return Response.json(
        { error: 'Invalid endpoint' },
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
          signal: AbortSignal.timeout(15000)
        })

        if (!response.ok) {
          const errorText = await response.text()
          const error = new Error(`Backend responded with ${response.status}: ${errorText}`)
          
          // Only retry on server errors or timeout
          if (response.status >= 500 || response.status === 429) {
            lastError = error
            if (attempt < maxRetries) {
              const delay = Math.min(1000 * Math.pow(2, attempt), 5000)
              await new Promise(resolve => setTimeout(resolve, delay))
              continue
            }
          }
          throw error
        }

        const data = await response.json()
        return Response.json(data)
        
      } catch (error) {
        lastError = error
        if (attempt < maxRetries && (!error.response || error.response.status >= 500)) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 5000)
          await new Promise(resolve => setTimeout(resolve, delay))
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
        endpoint: params.endpoint?.join('/') || 'unknown'
      },
      { status: 500 }
    )
  }
}
