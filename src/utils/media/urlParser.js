/**
 * URL Parameter Parser for Dynamic Media Routes
 * 
 * Handles parsing and validation of URL parameters from Next.js dynamic routes:
 * - /list/[movie|tv]/[title]/[season]/[episode]/[play]
 * 
 * Provides helper flags for route determination and URL building utilities.
 */

/**
 * Parse and validate URL parameters from Next.js dynamic route params
 * 
 * @param {Object} params - Next.js params object from dynamic route
 * @returns {Object} Parsed and decoded media parameters with helper flags
 */
export function parseMediaParams(params) {
  const mediaType = params?.media?.[0] // 'movie' or 'tv'
  const mediaTitle = params?.media?.[1]
  const mediaSeason = params?.media?.[2] // Could be 'Season X' or just the number
  const mediaEpisode = params?.media?.[3] // Could be 'Episode Y' or just the number
  
  // Determine if this is a player page based on media type
  const isPlayerPage = 
    (mediaType === 'tv' && params?.media?.[4] === 'play') ||
    (mediaType === 'movie' && params?.media?.[2] === 'play')
  
  return {
    // Raw values
    mediaType,
    mediaTitle: mediaTitle ? decodeURIComponent(mediaTitle) : null,
    mediaSeason,
    mediaEpisode,
    isPlayerPage,
    
    // Helper flags for route determination
    isTVShow: mediaType === 'tv',
    isMovie: mediaType === 'movie',
    hasTitle: Boolean(mediaTitle),
    hasSeason: Boolean(mediaType === 'tv' && mediaSeason),
    hasEpisode: Boolean(mediaType === 'tv' && mediaSeason && mediaEpisode),
    
    // Specific route type flags
    isTVShowSeasonsList: mediaType === 'tv' && mediaTitle && !mediaSeason,
    isTVSeasonEpisodesList: mediaType === 'tv' && mediaTitle && mediaSeason && !mediaEpisode,
    isTVEpisodeView: mediaType === 'tv' && mediaTitle && mediaSeason && mediaEpisode,
    isMovieView: mediaType === 'movie' && mediaTitle,
    isListView: !mediaTitle, // Just /list or /list/movie or /list/tv
  }
}

/**
 * Build canonical media URL from parsed parameters
 * 
 * @param {Object} options - URL building options
 * @param {string} options.mediaType - 'movie' or 'tv'
 * @param {string} options.mediaTitle - Media title (will be URL encoded)
 * @param {string} [options.mediaSeason] - Season identifier
 * @param {string} [options.mediaEpisode] - Episode identifier
 * @param {boolean} [options.includePlay] - Whether to append /play
 * @returns {string} Constructed URL path
 */
export function buildMediaUrl({ 
  mediaType, 
  mediaTitle, 
  mediaSeason, 
  mediaEpisode, 
  includePlay = false 
}) {
  if (!mediaType) return '/list'
  
  let url = `/list/${mediaType}`
  
  if (mediaTitle) {
    url += `/${encodeURIComponent(mediaTitle)}`
    
    if (mediaType === 'tv') {
      if (mediaSeason) {
        url += `/${mediaSeason}`
        if (mediaEpisode) {
          url += `/${mediaEpisode}`
        }
      }
    }
    
    if (includePlay) {
      url += '/play'
    }
  }
  
  return url
}

/**
 * Build callback URL for authentication redirects
 * 
 * @param {Object} parsedParams - Parsed parameters from parseMediaParams
 * @returns {string} URL to redirect back to after authentication
 */
export function buildCallbackUrl(parsedParams) {
  const { mediaType, mediaTitle, mediaSeason, mediaEpisode, isPlayerPage } = parsedParams
  
  return buildMediaUrl({
    mediaType,
    mediaTitle,
    mediaSeason,
    mediaEpisode,
    includePlay: isPlayerPage,
  })
}

/**
 * Build "go back" URL for media player navigation
 * 
 * @param {Object} parsedParams - Parsed parameters from parseMediaParams
 * @returns {string} URL to navigate back to from player
 */
export function buildGoBackUrl(parsedParams) {
  const { mediaType, mediaTitle, mediaSeason, mediaEpisode } = parsedParams
  
  // For TV episodes, go back to episode details (remove /play)
  // For movies, go back to movie details (remove /play)
  return buildMediaUrl({
    mediaType,
    mediaTitle,
    mediaSeason,
    mediaEpisode,
    includePlay: false,
  })
}

/**
 * Extract season number from season parameter
 * 
 * @param {string} mediaSeason - Season parameter (e.g., 'Season 1' or '1')
 * @returns {number|null} Numeric season number
 */
export function extractSeasonNumber(mediaSeason) {
  if (!mediaSeason) return null
  
  // Handle both 'Season X' format and plain number
  const match = mediaSeason.match(/\d+/)
  return match ? parseInt(match[0], 10) : null
}

/**
 * Extract episode number from episode parameter
 * 
 * @param {string} mediaEpisode - Episode parameter (e.g., 'Episode 1' or '1')
 * @returns {number|null} Numeric episode number
 */
export function extractEpisodeNumber(mediaEpisode) {
  if (!mediaEpisode) return null
  
  // Handle both 'Episode X' format and plain number
  const match = mediaEpisode.match(/\d+/)
  return match ? parseInt(match[0], 10) : null
}