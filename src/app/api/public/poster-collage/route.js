import { httpGet } from '@src/lib/httpHelper'
import { fileServerURLWithPrefixPath } from '@src/utils/config'

/**
 * GET /api/public/poster-collage
 * 
 * Serves the poster collage image from the default file server.
 * This endpoint proxies the poster_collage.jpg file from the configured
 * file server, respecting the NEXT_PUBLIC_FILE_SERVER_URL and 
 * NEXT_PUBLIC_FILE_SERVER_PREFIX_PATH environment variables.
 * 
 * The image is proxied through this API to:
 * - Hide the internal file server path structure
 * - Provide centralized cache control
 * - Enable consistent CORS handling
 * 
 * @returns {Response} The poster collage image or error response
 */
export const GET = async (req) => {
  try {
    // Build the poster collage URL using the default server configuration
    const posterCollageUrl = fileServerURLWithPrefixPath('/poster_collage.jpg')
    
    // Fetch the image using the same pattern as random-banner and screensaver routes
    const { data: buffer, headers: imageHeaders } = await httpGet(posterCollageUrl, {
      responseType: 'buffer',
      headers: {
        Accept: 'image/*',
      },
      timeout: 10000,
      retry: {
        retries: 3,
        factor: 2,
        minTimeout: 1000,
        maxTimeout: 5000
      }
    }, true)

    // Convert Buffer to ArrayBuffer for Response constructor
    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    )

    // Return the image with appropriate cache headers
    // Poster collages don't change frequently, so we can cache for longer
    return new Response(arrayBuffer, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': imageHeaders['content-type'] || 'image/jpeg',
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
        'ETag': imageHeaders['etag'] || undefined,
        'Last-Modified': imageHeaders['last-modified'] || undefined,
      },
    })
  } catch (error) {
    console.error('Error fetching poster collage:', error)
    
    // Handle specific HTTP errors
    if (error.response) {
      const statusCode = error.response.statusCode || error.response.status
      
      if (statusCode === 404) {
        return new Response(JSON.stringify({ 
          error: 'Poster collage not found',
          details: 'The poster_collage.jpg file does not exist on the file server'
        }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      
      if (statusCode >= 500) {
        return new Response(JSON.stringify({ 
          error: 'File server error',
          details: 'The file server encountered an error while serving the poster collage'
        }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }
    
    // Generic error response
    return new Response(JSON.stringify({ 
      error: 'Failed to fetch poster collage',
      details: error.message || 'Unknown error occurred'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}