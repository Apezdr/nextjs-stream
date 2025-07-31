import { tmdbNodeServerURL } from '@src/utils/config'
import { isAuthenticatedEither } from '@src/utils/routeAuth'

/**
 * GET /api/authenticated/tmdb/health
 * Proxy TMDB health check to backend server
 */
export async function GET(request) {
  try {
    // Check authentication
    const authResult = await isAuthenticatedEither(request)
    if (authResult instanceof Response) {
      return authResult
    }
    // Server-side environment variable resolution with debugging
    const serverOnlyTMDB = process.env.TMDB_NODE_SERVER_URL
    const fallbackNodeServer = process.env.NEXT_PUBLIC_NODE_SERVER_URL
    const configTMDB = tmdbNodeServerURL
    
    console.log('🔍 TMDB Health Route Debug:')
    console.log('  TMDB_NODE_SERVER_URL (server-only):', serverOnlyTMDB || 'undefined')
    console.log('  NEXT_PUBLIC_NODE_SERVER_URL (fallback):', fallbackNodeServer || 'undefined')
    console.log('  tmdbNodeServerURL (config):', configTMDB || 'undefined')
    
    // Use the base server URL (without /api/tmdb path) to avoid double paths
    const backendServerURL = fallbackNodeServer
    
    // Check if TMDB server is configured
    if (!backendServerURL) {
      return Response.json(
        {
          error: 'Backend server URL not configured',
          tmdb_configured: false,
          status: 'error',
          debug_info: {
            TMDB_NODE_SERVER_URL: serverOnlyTMDB || 'undefined',
            NEXT_PUBLIC_NODE_SERVER_URL: fallbackNodeServer || 'undefined',
            config_tmdbNodeServerURL: configTMDB || 'undefined'
          }
        },
        { status: 503 }
      )
    }

    // Build backend URL with validation
    let backendUrl
    try {
      backendUrl = `${backendServerURL}/api/tmdb/health`
      console.log('  Constructed backend URL:', backendUrl)
      // Validate URL construction
      new URL(backendUrl)
    } catch (urlError) {
      console.error('  URL construction failed:', urlError.message)
      return Response.json(
        {
          error: `Invalid TMDB server URL: ${urlError.message}`,
          tmdb_configured: false,
          status: 'error',
          debug_info: {
            backendServerURL,
            constructed_url: backendUrl,
            error: urlError.message
          }
        },
        { status: 503 }
      )
    }
    
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
      signal: AbortSignal.timeout(10000)
    })

    if (!response.ok) {
      throw new Error(`Backend responded with ${response.status}`)
    }

    const data = await response.json()
    
    return Response.json(data)
    
  } catch (error) {
    console.error('TMDB health check error:', error)
    
    return Response.json(
      {
        error: `TMDB service unavailable: ${error.message}`,
        tmdb_configured: false,
        status: 'error',
        debug_info: {
          backend_url: tmdbNodeServerURL,
          server_only_url: process.env.TMDB_NODE_SERVER_URL || 'undefined',
          fallback_url: process.env.NEXT_PUBLIC_NODE_SERVER_URL || 'undefined',
          error_details: error.message
        }
      },
      { status: 503 }
    )
  }
}