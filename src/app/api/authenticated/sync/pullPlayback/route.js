import { getVideosWatched } from '@src/utils/auth_database'
import { isAuthenticatedServer } from '@src/utils/routeAuth'

export async function GET(req) {
  // Authenticate the user (using direct auth() call - no HTTP fetch overhead)
  const authResult = await isAuthenticatedServer()
  if (authResult instanceof Response) {
    return authResult // Return unauthorized response if not authenticated
  }

  // Parse query parameters for filtering (performance optimization)
  const { searchParams } = new URL(req.url)
  const daysParam = searchParams.get('days') // e.g., "30" for last 30 days
  const limit = parseInt(searchParams.get('limit') || '0')

  const watchedMedia = await getVideosWatched()

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

  // Apply limit if requested
  const result = limit > 0 ? sorted.slice(0, limit) : sorted

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
