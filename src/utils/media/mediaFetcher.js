/**
 * Media Fetching Service
 *
 * Centralized media fetching with hierarchical error handling for TV shows.
 * Handles the complex logic of determining what level failed (show/season/episode).
 *
 * Uses React's cache() to eliminate duplicate calls between generateMetadata and page component.
 */

import { cache } from 'react'
import { getFlatRequestedMedia, getTrailerMedia } from '@src/utils/flatDatabaseUtils'
import { shouldRedirect, buildRedirectUrl, logRedirect } from './redirectHandler'

// Create cached versions of database functions to eliminate duplicate calls
// between generateMetadata and the page component
const getCachedRequestedMedia = cache(getFlatRequestedMedia)
const getCachedTrailerMedia = cache(getTrailerMedia)

// Create a cached version of video URL validation to avoid repeated HEAD requests
const getCachedVideoValidation = cache(async (url) => {
  try {
    const response = await fetch(url, { method: 'HEAD' })
    return response.ok
  } catch (error) {
    return false
  }
})

/**
 * Fetch media with redirect handling and hierarchical error detection
 * 
 * For TV shows, implements hierarchical checking:
 * 1. Check if show exists
 * 2. If show exists, check if season exists
 * 3. If season exists, check if episode exists
 * 
 * @param {Object} params - Parsed media parameters
 * @param {string} params.mediaType - 'movie' or 'tv'
 * @param {string} params.mediaTitle - Decoded media title
 * @param {string} [params.mediaSeason] - Season identifier
 * @param {string} [params.mediaEpisode] - Episode identifier
 * @param {boolean} [params.isPlayerPage] - Whether this is a player page
 * @returns {Promise<Object>} { media, redirectUrl, notFoundType }
 */
export async function fetchMediaWithRedirect(params) {
  const { mediaType, mediaTitle, mediaSeason, mediaEpisode, isPlayerPage } = params
  
  // Handle movie fetching (simpler case)
  if (mediaType === 'movie' && mediaTitle) {
    const media = await getCachedRequestedMedia({
      type: mediaType,
      title: mediaTitle,
    })
    
    // Check for redirect
    if (media && shouldRedirect(media)) {
      const redirectUrl = buildRedirectUrl(media, params)
      logRedirect(mediaTitle, media.title, redirectUrl, 'mediaFetcher')
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
    const baseShow = await getCachedRequestedMedia({
      type: mediaType,
      title: mediaTitle,
    })
    
    if (!baseShow) {
      // Show not found - set error type and return
      return {
        media: null,
        redirectUrl: null,
        notFoundType: 'show',
      }
    }
    
    // Show exists, check for redirect
    if (shouldRedirect(baseShow)) {
      const redirectUrl = buildRedirectUrl(baseShow, params)
      logRedirect(mediaTitle, baseShow.title, redirectUrl, 'mediaFetcher')
      return { media: baseShow, redirectUrl, notFoundType: null }
    }
    
    // Step 2: If season or episode requested, fetch that specific level
    if (mediaSeason || mediaEpisode) {
      const media = await getCachedRequestedMedia({
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
          const seasonOnly = await getCachedRequestedMedia({
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

/**
 * Fetch trailer media for limited access users
 * 
 * @param {string} mediaType - 'movie' or 'tv'
 * @param {string} mediaTitle - Media title
 * @returns {Promise<Object|null>} Trailer media or null
 */
export async function fetchTrailerMedia(mediaType, mediaTitle) {
  if (!mediaType || !mediaTitle) return null
  
  try {
    return await getCachedTrailerMedia(mediaType, mediaTitle)
  } catch (error) {
    console.error('Error fetching trailer media:', error)
    return null
  }
}

/**
 * Validate video URL with HEAD request
 * 
 * @param {string} url - Video URL to validate
 * @returns {Promise<boolean>} Whether the video URL is accessible
 */
export async function validateVideoURL(url) {
  if (!url) return false
  
  return await getCachedVideoValidation(url)
}

/**
 * Fetch contextual media for error pages
 * Used to show available seasons when a specific season/episode isn't found
 * 
 * @param {string} mediaTitle - TV show title
 * @returns {Promise<Object|null>} Show data with seasons or null
 */
export async function fetchContextualMediaForError(mediaTitle) {
  try {
    return await getCachedRequestedMedia({
      type: 'tv',
      title: mediaTitle,
    })
  } catch (error) {
    console.error('Error fetching contextual media:', error)
    return null
  }
}