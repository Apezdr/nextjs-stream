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

// Invalidate movie details cache when movie is updated
export async function invalidateMovieDetailsCache(movieTitle) {
  if (!movieTitle) return false
  
  try {
    const { movieDetailsTag, getAllMovieCacheTags } = await import('./mediaPagesTags')
    const tags = getAllMovieCacheTags(movieTitle)
    
    // Revalidate all related tags with max profile for SWR
    for (const tag of tags) {
      revalidateTag(tag, 'max')
    }
    
    console.log(`[Cache SWR] Invalidated movie details cache for: ${movieTitle}`)
    return true
  } catch (error) {
    console.error('[Cache SWR] Failed to invalidate movie details cache:', error)
    return false
  }
}

// Invalidate TV show details cache when show is updated
export async function invalidateTVShowDetailsCache(showTitle) {
  if (!showTitle) return false
  
  try {
    const { getAllTVShowCacheTags } = await import('./mediaPagesTags')
    const tags = getAllTVShowCacheTags(showTitle)
    
    // Revalidate all related tags with max profile for SWR
    for (const tag of tags) {
      revalidateTag(tag, 'max')
    }
    
    console.log(`[Cache SWR] Invalidated TV show details cache for: ${showTitle}`)
    return true
  } catch (error) {
    console.error('[Cache SWR] Failed to invalidate TV show details cache:', error)
    return false
  }
}

// Invalidate episode details cache when episode is updated
export async function invalidateEpisodeDetailsCache(showTitle, seasonNum, episodeNum) {
  if (!showTitle || !seasonNum || !episodeNum) return false
  
  try {
    const { getAllEpisodeCacheTags } = await import('./mediaPagesTags')
    const tags = getAllEpisodeCacheTags(showTitle, seasonNum, episodeNum)
    
    // Revalidate all related tags with max profile for SWR
    for (const tag of tags) {
      revalidateTag(tag, 'max')
    }
    
    console.log(`[Cache SWR] Invalidated episode details cache for: ${showTitle} S${seasonNum}E${episodeNum}`)
    return true
  } catch (error) {
    console.error('[Cache SWR] Failed to invalidate episode details cache:', error)
    return false
  }
}

// Invalidate all media detail caches (for use during sync operations)
export async function invalidateAllMediaDetailsCache() {
  try {
    const { MEDIA_CACHE_TAGS } = await import('./mediaPagesTags')
    
    // Invalidate all detail page caches
    revalidateTag(MEDIA_CACHE_TAGS.MOVIE_DETAILS, 'max')
    revalidateTag(MEDIA_CACHE_TAGS.TV_DETAILS, 'max')
    revalidateTag(MEDIA_CACHE_TAGS.EPISODE_DETAILS, 'max')
    revalidateTag(MEDIA_CACHE_TAGS.SEASON_DETAILS, 'max')
    
    // Also invalidate media library caches
    revalidateTag('media-library', 'max')
    revalidateTag('movies', 'max')
    revalidateTag('tv', 'max')
    
    console.log('[Cache SWR] Invalidated all media details caches')
    return true
  } catch (error) {
    console.error('[Cache SWR] Failed to invalidate all media details caches:', error)
    return false
  }
}
