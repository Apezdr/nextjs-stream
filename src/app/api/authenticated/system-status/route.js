'use server'

import { getProcessedSystemStatus } from '@src/utils/getProcessedSystemStatus'
import isAuthenticated from '@src/utils/routeAuth'
// Use shared ETag helpers for consistency across all endpoints
import { generateETag, hasMatchingETag, createNotModifiedResponse, createCacheHeaders } from '@src/utils/cache/etagHelpers'
import { connection } from 'next/server'

const DEFAULTS = {
  CACHE_CONTROL: 'private, must-revalidate, max-age=30',
}

export async function GET(request) {
  await connection();
  // auth
  const auth = await isAuthenticated(request)
  if (auth instanceof Response) return auth

  try {
    // Use the shared helper function to get processed system status
    const response = await getProcessedSystemStatus()

    // Generate ETag from response data using shared helper
    const responseString = JSON.stringify(response)
    const etag = generateETag(responseString)

    // Check if client has current version
    if (hasMatchingETag(request, etag)) {
      return createNotModifiedResponse(etag, {
        'Cache-Control': DEFAULTS.CACHE_CONTROL,
      })
    }

    // Return system status with ETag header for efficient polling
    return new Response(responseString, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': DEFAULTS.CACHE_CONTROL,
        ...createCacheHeaders(etag),
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

    // Generate ETag for error response as well
    const errorString = JSON.stringify(errorResponse)
    const etag = generateETag(errorString)

    return new Response(errorString, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'private, must-revalidate, max-age=10',
        ...createCacheHeaders(etag),
        'X-Status': 'error',
      },
    })
  }
}
