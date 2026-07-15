/**
 * Redirect Handler for Media Routes
 * 
 * Handles canonical URL redirects when media is found via originalTitle.
 * Consolidates duplicate redirect logic from generateMetadata and MediaPage.
 */

import { buildMediaUrl } from './urlParser'

/**
 * Check if media should trigger a canonical redirect.
 *
 * The canonical URL keys on the unique `originalTitle`. A request only needs
 * redirecting when it resolved via the legacy display-title fallback
 * (`foundByTitleFallback`) AND the canonical originalTitle differs from what was
 * requested — i.e. an old title-based bookmark should be sent to its
 * originalTitle URL. Requests already on the originalTitle URL carry no flag and
 * never redirect.
 *
 * @param {Object} media - Media object from database (resolver output)
 * @param {string} requestedTitle - The (decoded) title/originalTitle from the URL
 * @returns {boolean} Whether a redirect should occur
 */
export function shouldRedirect(media, requestedTitle) {
  return Boolean(
    media?.foundByTitleFallback &&
    media.originalTitle &&
    media.originalTitle !== requestedTitle
  )
}

/**
 * Build canonical redirect URL keyed on the unique originalTitle.
 *
 * @param {Object} media - Media object with canonical originalTitle
 * @param {Object} parsedParams - Parsed URL parameters
 * @returns {string} Canonical URL to redirect to
 */
export function buildRedirectUrl(media, parsedParams) {
  const { mediaType, mediaSeason, mediaEpisode, isPlayerPage } = parsedParams

  return buildMediaUrl({
    mediaType,
    mediaTitle: media.originalTitle,
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