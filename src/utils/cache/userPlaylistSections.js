"use cache"
import { cacheTag, cacheLife } from 'next/cache'

// Cache user-specific playlist sections with SWR optimization
// NOTE: This function accepts pre-fetched data to avoid dynamic data access inside cache
export async function getCachedUserPlaylistSections(userId, allPlaylists, visibilityPrefs) {
  if (!userId || !allPlaylists || !visibilityPrefs) return []
  
  cacheLife("max") // Use max for SWR - serve cached immediately while revalidating
  cacheTag(`user-playlists-${userId}`) // User-specific tag for selective revalidation
  cacheTag(`user-data-${userId}`) // Also tag with user for broader invalidation
  
  try {
    // Create visibility map for quick lookup
    const visibilityMap = new Map(
      visibilityPrefs.map(pref => [
        pref.playlistId,
        { appOrder: pref.appOrder, appTitle: pref.appTitle }
      ])
    )
    
    // Filter to only playlists with showInApp=true that user can access
    const userPlaylistSections = allPlaylists
      .filter(playlist => visibilityMap.has(playlist.id))
      .map(playlist => {
        const vis = visibilityMap.get(playlist.id)
        return {
          id: `user-playlist-${playlist.id}`,
          playlistId: playlist.id,
          label: vis.appTitle || playlist.name, // Use appTitle if provided
          type: "playlist",
          static: false,
          priority: 2, // Between watch history (1) and static sections (3+)
          appOrder: vis.appOrder,
          userId: userId,
          dateUpdated: playlist.dateUpdated, // Include for sorting
          cacheTag: `playlist-data-${playlist.id}` // Individual playlist tag
        }
      })
      // Sort by appOrder (ascending), then by dateUpdated (descending) as tiebreaker  
      .sort((a, b) => {
        const orderDiff = a.appOrder - b.appOrder
        if (orderDiff !== 0) return orderDiff
        return new Date(b.dateUpdated || 0) - new Date(a.dateUpdated || 0)
      })
    
    return userPlaylistSections
  } catch (error) {
    console.error('[Cache] Failed to process user playlist sections:', error)
    return []
  }
}
