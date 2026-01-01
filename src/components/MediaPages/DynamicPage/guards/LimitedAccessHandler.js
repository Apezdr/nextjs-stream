/**
 * Limited Access Handler
 * 
 * Handles users with limited access by fetching trailer media instead of full content.
 * This allows preview/demo access without full library permissions.
 */

import { fetchTrailerMedia } from '@src/utils/media/mediaFetcher'

/**
 * Check if user has limited access and fetch trailer if needed
 * 
 * @param {Object} session - NextAuth session object
 * @param {Object} parsedParams - Parsed URL parameters
 * @returns {Promise<Object|null>} Trailer media object or null
 */
export async function handleLimitedAccess(session, parsedParams) {
  const { mediaType, mediaTitle } = parsedParams
  
  // Check if user has limited access
  const hasLimitedAccess = session?.user?.limitedAccess
  
  if (!hasLimitedAccess || !mediaTitle) {
    return null
  }
  
  // Fetch trailer for the requested media
  return await fetchTrailerMedia(mediaType, mediaTitle)
}

/**
 * Check if the current session has limited access
 * 
 * @param {Object} session - NextAuth session object
 * @returns {boolean} Whether user has limited access
 */
export function hasLimitedAccess(session) {
  return Boolean(session?.user?.limitedAccess)
}