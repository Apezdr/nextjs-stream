/**
 * Media Pages Cache Tags
 * 
 * Cache tag constants and helpers for media detail pages.
 * Follows existing cache patterns from horizontalListData.js and invalidation.js
 */

/**
 * Cache tag constants for media details
 */
export const MEDIA_CACHE_TAGS = {
  // Already defined in horizontalListData.js:
  // - 'media-library'
  // - 'movies'  
  // - 'tv'
  // - 'recently-added'
  // - 'all'
  
  // New tags for detail pages
  MOVIE_DETAILS: 'movie-details',
  TV_DETAILS: 'tv-details',
  EPISODE_DETAILS: 'episode-details',
  SEASON_DETAILS: 'season-details',
}

/**
 * Generate cache tag for specific movie details
 * @param {string} movieTitle - Movie title (URL encoded)
 * @returns {string} Cache tag
 */
export function movieDetailsTag(movieTitle) {
  return `movie-details-${movieTitle}`
}

/**
 * Generate cache tag for specific TV show details
 * @param {string} showTitle - Show title (URL encoded)
 * @returns {string} Cache tag
 */
export function tvShowDetailsTag(showTitle) {
  return `tv-show-${showTitle}`
}

/**
 * Generate cache tag for specific season
 * @param {string} showTitle - Show title (URL encoded)
 * @param {string|number} seasonNum - Season number
 * @returns {string} Cache tag
 */
export function seasonDetailsTag(showTitle, seasonNum) {
  return `season-${showTitle}-${seasonNum}`
}

/**
 * Generate cache tag for specific episode
 * @param {string} showTitle - Show title (URL encoded)
 * @param {string|number} seasonNum - Season number
 * @param {string|number} episodeNum - Episode number
 * @returns {string} Cache tag
 */
export function episodeDetailsTag(showTitle, seasonNum, episodeNum) {
  return `episode-${showTitle}-S${seasonNum}E${episodeNum}`
}

/**
 * Get all cache tags for a movie (for comprehensive invalidation)
 * @param {string} movieTitle - Movie title
 * @returns {string[]} Array of cache tags to invalidate
 */
export function getAllMovieCacheTags(movieTitle) {
  return [
    movieDetailsTag(movieTitle),
    MEDIA_CACHE_TAGS.MOVIE_DETAILS,
    'movies',
    'media-library',
    'all',
  ]
}

/**
 * Get all cache tags for a TV show (for comprehensive invalidation)
 * @param {string} showTitle - Show title
 * @returns {string[]} Array of cache tags to invalidate
 */
export function getAllTVShowCacheTags(showTitle) {
  return [
    tvShowDetailsTag(showTitle),
    MEDIA_CACHE_TAGS.TV_DETAILS,
    'tv',
    'media-library',
    'all',
  ]
}

/**
 * Get all cache tags for an episode (for comprehensive invalidation)
 * @param {string} showTitle - Show title
 * @param {string|number} seasonNum - Season number
 * @param {string|number} episodeNum - Episode number
 * @returns {string[]} Array of cache tags to invalidate
 */
export function getAllEpisodeCacheTags(showTitle, seasonNum, episodeNum) {
  return [
    episodeDetailsTag(showTitle, seasonNum, episodeNum),
    seasonDetailsTag(showTitle, seasonNum),
    tvShowDetailsTag(showTitle),
    MEDIA_CACHE_TAGS.EPISODE_DETAILS,
    MEDIA_CACHE_TAGS.SEASON_DETAILS,
    MEDIA_CACHE_TAGS.TV_DETAILS,
    'tv',
    'media-library',
  ]
}