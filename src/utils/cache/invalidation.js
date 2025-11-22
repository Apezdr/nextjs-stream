import { revalidateTag, updateTag } from 'next/cache'

// Enhanced cache invalidation utilities with SWR support for landing page lists

// Invalidate user-specific playlist cache when user modifies playlist settings
export async function invalidateUserPlaylistsCache(userId) {
  if (!userId) return false
  
  try {
    // Use updateTag in Server Actions for immediate read-your-writes semantics
    if (typeof updateTag === 'function') {
      updateTag(`user-playlists-${userId}`)
      updateTag(`user-data-${userId}`)
    } else {
      // Fallback to revalidateTag with max profile for SWR behavior
      revalidateTag(`user-playlists-${userId}`, 'max')
      revalidateTag(`user-data-${userId}`, 'max')
    }
    
    console.log(`[Cache SWR] Invalidated user playlists cache for user ${userId}`)
    return true
  } catch (error) {
    console.error('[Cache SWR] Failed to invalidate user playlists cache:', error)
    return false
  }
}

// Invalidate static content cache when new media is added/removed
export async function invalidateStaticContentCache(contentType = 'all') {
  try {
    // Use revalidateTag with 'max' profile for SWR - serve stale while revalidating
    if (contentType === 'all' || contentType === 'recently-added') {
      revalidateTag('recently-added-content', 'max')
      revalidateTag('media-content-updates', 'max')
    }
    
    if (contentType === 'all' || contentType === 'movies') {
      revalidateTag('movie-content', 'max')
    }
    
    if (contentType === 'all' || contentType === 'tv') {
      revalidateTag('tv-content', 'max')
    }
    
    // Always invalidate general static sections tag
    revalidateTag('landing-static-sections', 'max')
    
    console.log(`[Cache SWR] Invalidated static content cache for type: ${contentType}`)
    return true
  } catch (error) {
    console.error('[Cache SWR] Failed to invalidate static content cache:', error)
    return false
  }
}

// Invalidate specific playlist data when playlist content changes
export async function invalidatePlaylistDataCache(playlistId, userId = null) {
  if (!playlistId) return false
  
  try {
    // Use updateTag for immediate playlist data updates in Server Actions
    if (typeof updateTag === 'function') {
      updateTag(`playlist-data-${playlistId}`)
      if (userId) {
        updateTag(`user-data-${userId}`)
      }
    } else {
      // Fallback to revalidateTag with immediate revalidation
      revalidateTag(`playlist-data-${playlistId}`, 'max')
      if (userId) {
        revalidateTag(`user-data-${userId}`, 'max')
      }
    }
    
    console.log(`[Cache SWR] Invalidated playlist data cache for playlist ${playlistId}`)
    return true
  } catch (error) {
    console.error('[Cache SWR] Failed to invalidate playlist data cache:', error)
    return false
  }
}

// Invalidate user watch history when new content is watched
export async function invalidateUserWatchHistoryCache(userId) {
  if (!userId) return false
  
  try {
    // Use updateTag for immediate watch history updates in Server Actions
    if (typeof updateTag === 'function') {
      updateTag(`user-watch-history-${userId}`)
      updateTag(`user-content-${userId}`)
    } else {
      // Fallback to revalidateTag with max profile for SWR
      revalidateTag(`user-watch-history-${userId}`, 'max')
      revalidateTag(`user-content-${userId}`, 'max')
    }
    
    // Also invalidate general watch history updates
    revalidateTag('watch-history-updates', 'max')
    
    console.log(`[Cache SWR] Invalidated watch history cache for user ${userId}`)
    return true
  } catch (error) {
    console.error('[Cache SWR] Failed to invalidate watch history cache:', error)
    return false
  }
}

// Bulk invalidation for major content updates (e.g., sync operations)
export async function invalidateAllLandingPageCache(userId = null) {
  try {
    // Invalidate all static content
    await invalidateStaticContentCache('all')
    
    // Invalidate user-specific content if user provided
    if (userId) {
      await invalidateUserPlaylistsCache(userId)
      await invalidateUserWatchHistoryCache(userId)
    }
    
    console.log(`[Cache SWR] Bulk invalidated all landing page cache${userId ? ` for user ${userId}` : ''}`)
    return true
  } catch (error) {
    console.error('[Cache SWR] Failed to bulk invalidate landing page cache:', error)
    return false
  }
}
