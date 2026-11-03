import { approvedGate } from '@src/lib/roles/gates'
import { libraryAccessFor } from '@src/lib/roles/libraryAccess'
import { findPlaybackForUser } from '@src/utils/watchHistory/database'
import { watchRowsInScope } from '@src/utils/watchHistory/scopeRows'
// ETag support for HTTP caching
import { generateETag, hasMatchingETag, createNotModifiedResponse, createCacheHeaders } from '@src/utils/cache/etagHelpers'

export async function GET(req) {
  // Authenticate the user (using direct auth() call - no HTTP fetch overhead)
  const authResult = await approvedGate.route()
  if (authResult instanceof Response) {
    return authResult // Return unauthorized response if not authenticated
  }

  // Parse query parameters for filtering (performance optimization)
  const { searchParams } = new URL(req.url)
  const daysParam = searchParams.get('days') // e.g., "30" for last 30 days
  const limit = parseInt(searchParams.get('limit') || '0')

  // The user's own rows; the library scope is checked on the ones returned only
  const watchedMedia = (await findPlaybackForUser(authResult.id)) ?? []

  // Filter by recent days if requested (backward compatible - no params returns all)
  let filtered = watchedMedia
  if (daysParam) {
    const days = parseInt(daysParam)
    if (!isNaN(days) && days > 0) {
      const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      filtered = watchedMedia.filter(item => {
        if (!item.lastUpdated) return false
        return new Date(item.lastUpdated) >= cutoffDate
      })
    }
  }

  // Sort by most recent first
  const sorted = filtered.sort((a, b) => {
    const dateA = a.lastUpdated ? new Date(a.lastUpdated).getTime() : 0
    const dateB = b.lastUpdated ? new Date(b.lastUpdated).getTime() : 0
    return dateB - dateA
  })

  // Apply limit if requested, then leave out the titles outside the user's
  // library scope (and their video URLs with them)
  const result = await watchRowsInScope(limit > 0 ? sorted.slice(0, limit) : sorted, await libraryAccessFor(authResult))

  // Generate ETag from response data
  const responseString = JSON.stringify(result)
  const etag = generateETag(responseString)

  // Check if client has current version
  if (hasMatchingETag(req, etag)) {
    return createNotModifiedResponse(etag)
  }

  // Return the results with ETag header for caching
  return new Response(responseString, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      ...createCacheHeaders(etag),
    },
  })
}
