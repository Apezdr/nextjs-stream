'use server'

import { getProcessedSystemStatus } from '@src/utils/getProcessedSystemStatus'
import { isAuthenticatedEither } from '@src/utils/routeAuth'

const DEFAULTS = {
  CACHE_CONTROL: 'private, must-revalidate, max-age=30',
}

/** Generate a simple hash-based ETag from any object */
function generateETag(obj) {
  const s = JSON.stringify(obj),
    len = s.length
  let h = 0
  for (let i = 0; i < len; i++) {
    h = (h << 5) - h + s.charCodeAt(i)
    h |= 0
  }
  return `"${h.toString(36)}"`
}

export async function GET(request) {
  // auth
  const auth = await isAuthenticatedEither(request)
  if (auth instanceof Response) return auth

  const incomingETag = request.headers.get('If-None-Match')

  try {
    // Use the shared helper function to get processed system status
    const response = await getProcessedSystemStatus()

    const etag = generateETag(response)
    if (incomingETag === etag) {
      return new Response(null, {
        status: 304,
        headers: {
          'Cache-Control': DEFAULTS.CACHE_CONTROL,
          ETag: etag,
        },
      })
    }

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': DEFAULTS.CACHE_CONTROL,
        ETag: etag,
      },
    })
  } catch (err) {
    console.error('Error in system status API:', err)
    
    // Return a basic error response
    const errorResponse = {
      overall: {
        level: 'unknown',
        message: 'System status temporarily unavailable',
        updatedAt: new Date().toISOString(),
      },
      servers: [],
      hasActiveIncidents: false,
    }

    const etag = generateETag(errorResponse)
    return new Response(JSON.stringify(errorResponse), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'private, must-revalidate, max-age=10',
        ETag: etag,
        'X-Status': 'error',
      },
    })
  }
}
