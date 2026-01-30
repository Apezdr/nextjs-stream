import { tmdbNodeServerURL } from '@src/utils/config'
import { isAuthenticatedEither } from '@src/utils/routeAuth'
import { httpGet } from '@src/lib/httpHelper'

/**
 * GET /api/authenticated/tmdb/health
 * Proxy TMDB health check to backend server with enhanced retry and caching
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
    const configTMDB = tmdbNodeServerURL

    console.log('🔍 TMDB Health Route Debug:')
    console.log('  TMDB_NODE_SERVER_URL (server-only):', serverOnlyTMDB || 'undefined')
    console.log('  NODE_SERVER_INTERNAL_URL:', process.env.NODE_SERVER_INTERNAL_URL || 'undefined')
    console.log('  NODE_SERVER_URL (fallback):', process.env.NODE_SERVER_URL || 'undefined')
    console.log('  tmdbNodeServerURL (config):', configTMDB || 'undefined')

    // Using NODE_SERVER_INTERNAL_URL for server-to-server TMDB proxy requests; fallback to NODE_SERVER_URL when not configured
    const backendServerURL =
      process.env.NODE_SERVER_INTERNAL_URL || process.env.NODE_SERVER_URL || 'http://localhost:3000'

    // Check if TMDB server is configured
    if (!backendServerURL) {
      return Response.json(
        {
          error: 'Backend server URL not configured',
          tmdb_configured: false,
          status: 'error',
          debug_info: {
            TMDB_NODE_SERVER_URL: serverOnlyTMDB || 'undefined',
            NODE_SERVER_INTERNAL_URL: process.env.NODE_SERVER_INTERNAL_URL || 'undefined',
            NODE_SERVER_URL: process.env.NODE_SERVER_URL || 'undefined',
            config_tmdbNodeServerURL: configTMDB || 'undefined',
          },
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
            error: urlError.message,
          },
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

    // Use enhanced HTTP client with retry and caching
    const response = await httpGet(
      backendUrl,
      {
        headers,
        timeout: 10000,
        responseType: 'json',
        retry: {
          limit: 2, // Fewer retries for health checks
          baseDelay: 500,
          maxDelay: 2000,
          shouldRetry: (error, attemptCount) => {
            // Be more selective with health check retries
            if (!error.response) return true
            const statusCode = error.response.statusCode
            return statusCode >= 500 || statusCode === 429
          },
        },
      },
      false
    ) // Don't cache health checks for real-time status

    return Response.json(response.data)
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
          fallback_url: process.env.NODE_SERVER_URL || 'undefined',
          error_details: error.message,
        },
      },
      { status: 503 }
    )
  }
}
