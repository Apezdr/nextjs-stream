/**
 * Redirect Handler for Media Routes
 * 
 * Handles canonical URL redirects when media is found via originalTitle.
 * Consolidates duplicate redirect logic from generateMetadata and MediaPage.
 */

import { buildMediaUrl } from './urlParser'

/**
 * Check if media should trigger a redirect (found via originalTitle)
 * 
 * @param {Object} media - Media object from database
 * @returns {boolean} Whether a redirect should occur
 */
export function shouldRedirect(media) {
  return Boolean(media?.foundByOriginalTitle)
}

/**
 * Build canonical redirect URL for media found via originalTitle
 * 
 * @param {Object} media - Media object with canonical title
 * @param {Object} parsedParams - Parsed URL parameters
 * @returns {string} Canonical URL to redirect to
 */
export function buildRedirectUrl(media, parsedParams) {
  const { mediaType, mediaSeason, mediaEpisode, isPlayerPage } = parsedParams
  
  // Use the canonical title from the media object
  const canonicalTitle = media.title
  
  return buildMediaUrl({
    mediaType,
    mediaTitle: canonicalTitle,
    mediaSeason,
    mediaEpisode,
    includePlay: isPlayerPage,
  })
}

/**
 * Log redirect information for debugging purposes
 * 
 * @param {string} originalTitle - Original title from URL
 * @param {string} canonicalTitle - Canonical title from database
 * @param {string} redirectUrl - URL being redirected to
 * @param {string} context - Context where redirect is happening (e.g., 'generateMetadata', 'page')
 */
export function logRedirect(originalTitle, canonicalTitle, redirectUrl, context = 'unknown') {
  if (process.env.DEBUG === 'true' || process.env.DEBUG === '1') {
    console.log(
      `[REDIRECT:${context}] Media found via originalTitle. ` +
      `Redirecting from "${originalTitle}" to "${canonicalTitle}" at ${redirectUrl}`
    )
  }
}