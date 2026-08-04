import { cacheLife, cacheTag } from 'next/cache'
import { getFlatRequestedMedia } from '@src/utils/flatDatabaseUtils'
import { applyJitPreference } from '@src/utils/jit/preference'
import { shouldRedirect, buildRedirectUrl, logRedirect } from '@src/utils/media/redirectHandler'

/**
 * Per-request delivery decision for PLAYER pages, applied AFTER the cached
 * fetch — deliberately NOT inside the 'use cache' scope. The JIT swap
 * depends on the admin serve mode, per-media overrides, and a live
 * transcoder health probe; baking it into a cross-request cache entry would
 * freeze one moment's decision for every user until revalidation (and turn
 * the kill switch into a "kill within cacheLife, maybe"). 'use cache' reads
 * return fresh copies, but the swap works on its own shallow copy anyway.
 *
 * Call this at PAGE render for player routes; generateMetadata keeps the
 * raw cached doc (metadata never plays anything).
 */
export async function applyPlayerDelivery(result, parsedParams) {
  if (!parsedParams?.isPlayerPage) return result
  if (!result?.media || typeof result.media.jitUrl !== 'string' || !result.media.jitUrl) {
    return result
  }
  const media = await applyJitPreference({ ...result.media })
  return { ...result, media }
}
import {
  movieDetailsTag,
  tvShowDetailsTag,
  seasonDetailsTag,
  episodeDetailsTag,
  MEDIA_CACHE_TAGS,
} from './mediaPagesTags'

/**
 * Cached media fetching with redirect handling
 * Uses Next.js "use cache" to cache across requests (not just within a request)
 * 
 * This replaces fetchMediaWithRedirect when you want cross-request caching
 */
export async function getCachedMediaWithRedirect(parsedParams) {
  'use cache'
  cacheLife('mediaLists') // 1 min stale, revalidates in background
  
  const { mediaType, mediaTitle, mediaSeason, mediaEpisode, isPlayerPage } = parsedParams
  
  // Add appropriate cache tags based on media type
  if (mediaType === 'movie' && mediaTitle) {
    cacheTag('media-library', 'movies', MEDIA_CACHE_TAGS.MOVIE_DETAILS, movieDetailsTag(mediaTitle))
  } else if (mediaType === 'tv' && mediaTitle) {
    const tags = ['media-library', 'tv', MEDIA_CACHE_TAGS.TV_DETAILS, tvShowDetailsTag(mediaTitle)]
    
    if (mediaSeason) {
      tags.push(seasonDetailsTag(mediaTitle, mediaSeason))
    }
    
    if (mediaEpisode) {
      tags.push(MEDIA_CACHE_TAGS.EPISODE_DETAILS)
      tags.push(episodeDetailsTag(mediaTitle, mediaSeason, mediaEpisode))
    }
    
    cacheTag(...tags)
  } else {
    // List views
    cacheTag('media-library', mediaType || 'all')
  }
  
  // Handle movie fetching
  if (mediaType === 'movie' && mediaTitle) {
    const media = await getFlatRequestedMedia({
      type: mediaType,
      title: mediaTitle,
    })
    
    // Check for redirect
    if (media && shouldRedirect(media, mediaTitle)) {
      const redirectUrl = buildRedirectUrl(media, parsedParams)
      logRedirect(mediaTitle, media.originalTitle, redirectUrl, 'cachedMedia')
      return { media, redirectUrl, notFoundType: null }
    }
    
    return {
      media,
      redirectUrl: null,
      notFoundType: media ? null : 'movie',
    }
  }
  
  // Handle TV show fetching (hierarchical checking)
  if (mediaType === 'tv' && mediaTitle) {
    // Step 1: Check if the show exists (base level)
    const baseShow = await getFlatRequestedMedia({
      type: mediaType,
      title: mediaTitle,
    })
    
    if (!baseShow) {
      return {
        media: null,
        redirectUrl: null,
        notFoundType: 'show',
      }
    }
    
    // Show exists, check for redirect
    if (shouldRedirect(baseShow)) {
      const redirectUrl = buildRedirectUrl(baseShow, parsedParams)
      logRedirect(mediaTitle, baseShow.originalTitle, redirectUrl, 'cachedMedia')
      return { media: baseShow, redirectUrl, notFoundType: null }
    }
    
    // Step 2: If season or episode requested, fetch that specific level
    if (mediaSeason || mediaEpisode) {
      const media = await getFlatRequestedMedia({
        type: mediaType,
        title: mediaTitle,
        season: mediaSeason,
        episode: mediaEpisode,
      })
      
      if (!media) {
        // Determine what level failed
        let notFoundType = null
        
        if (mediaSeason && !mediaEpisode) {
          notFoundType = 'season'
        } else if (mediaSeason && mediaEpisode) {
          // Check if season exists but episode doesn't
          const seasonOnly = await getFlatRequestedMedia({
            type: mediaType,
            title: mediaTitle,
            season: mediaSeason,
          })
          notFoundType = seasonOnly ? 'episode' : 'season'
        }
        
        return {
          media: null,
          redirectUrl: null,
          notFoundType,
        }
      }
      
      // Season/episode found successfully
      return {
        media,
        redirectUrl: null,
        notFoundType: null,
      }
    }
    
    // No season/episode requested, return the base show
    return {
      media: baseShow,
      redirectUrl: null,
      notFoundType: null,
    }
  }
  
  // No media type or title - list view
  return {
    media: null,
    redirectUrl: null,
    notFoundType: null,
  }
}