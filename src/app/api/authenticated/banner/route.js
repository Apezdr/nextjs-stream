import { isAuthenticatedAndApproved } from '@src/utils/routeAuth'
import { fetchBannerMedia } from '@src/utils/auth_database'
import { fetchFlatBannerMedia } from '@src/utils/flatDatabaseUtils'
import { generateClipVideoURL } from '@src/utils/auth_utils'
// ETag support for HTTP caching
import { generateETag, hasMatchingETag, createNotModifiedResponse, createCacheHeaders } from '@src/utils/cache/etagHelpers'

// /api/authenticated/banner
export const GET = async (req) => {
  const authResult = await isAuthenticatedAndApproved(req)
  if (authResult instanceof Response) {
    return authResult // Stop execution and return the unauthorized response
  }

  // Extract query parameters
  const url = new URL(req.url)
  const isTVdevice = url.searchParams.get('isTVdevice') === 'true'

  const mediaResult = await fetchFlatBannerMedia()
  if (mediaResult.error && mediaResult.details && mediaResult.status) {
    return new Response(JSON.stringify({ error: mediaResult.error, details: mediaResult.details }), {
      status: mediaResult.status,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // If TV device mode is enabled, add clipVideoURL to each movie
  let processedMediaResult = mediaResult
  if (isTVdevice && Array.isArray(mediaResult)) {
    processedMediaResult = mediaResult.map(movie => {
      // Add clipVideoURL for TV device mode
      if (movie.videoURL && movie.duration) {
        try {
          movie.clipVideoURL = generateClipVideoURL(movie, 'movie', movie.originalTitle || movie.title, true)
        } catch (error) {
          console.warn(`Failed to generate clip URL for movie ${movie.title}:`, error.message)
          // Continue without clipVideoURL for this movie
        }
      }
      return movie
    })
  }

  // Generate ETag from response data
  const responseString = JSON.stringify(processedMediaResult)
  const etag = generateETag(responseString)

  // Check if client has current version
  if (hasMatchingETag(req, etag)) {
    return createNotModifiedResponse(etag)
  }

  // Return the banner media with ETag header for efficient polling
  return new Response(responseString, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*', // Allows all origins
      'Content-Type': 'application/json',
      ...createCacheHeaders(etag),
    },
  })
}
