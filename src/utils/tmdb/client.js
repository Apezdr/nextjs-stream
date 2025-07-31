/**
 * TMDB API client utility for interfacing with the backend Node.js server
 * Uses the existing backend TMDB API endpoints with caching
 */

import { buildURL } from ".."

// For client-side requests, use relative URLs to the current origin
// The Next.js API routes will handle the server-side proxy logic

/**
 * TMDB client error class
 */
export class TMDBError extends Error {
  constructor(message, status = null, response = null) {
    super(message)
    this.name = 'TMDBError'
    this.status = status
    this.response = response
  }
}

/**
 * Make a request to the local TMDB API proxy
 * @param {string} endpoint - API endpoint (without /api/authenticated/tmdb prefix)
 * @param {Object} [options] - Request options
 * @param {number} [options.retries=2] - Number of retry attempts
 * @param {number} [options.timeout=10000] - Request timeout in milliseconds
 * @returns {Promise<Object>} API response data
 */
async function makeRequest(endpoint, options = {}) {
  const { method = 'GET', body = null, params = {}, retries = 2, timeout = 10000 } = options

  // Build URL using local Next.js API routes (server-side proxy)
  // Use relative URLs that work from the browser
  const builtURL = buildURL(`/api/authenticated/tmdb${endpoint}`)
  const url = new URL(builtURL, builtURL.startsWith('http') ? undefined : window.location.origin)

  console.log(`TMDB Request: ${method} ${url.toString()}`, { params, body })
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined) {
      url.searchParams.append(key, value.toString())
    }
  })

  let lastError = null

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeout)

      const response = await fetch(url.toString(), {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : null,
        signal: controller.signal,
        credentials: 'include' // Include session cookies for Next.js authentication
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        const error = new TMDBError(
          errorData.error || `HTTP ${response.status}: ${response.statusText}`,
          response.status,
          errorData
        )
        
        // Don't retry on client errors (4xx)
        if (response.status >= 400 && response.status < 500) {
          throw error
        }
        
        lastError = error
        if (attempt === retries) throw error
        
        // Wait before retrying (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000))
        continue
      }

      return await response.json()
    } catch (error) {
      if (error.name === 'AbortError') {
        lastError = new TMDBError(`Request timeout after ${timeout}ms`)
      } else if (error instanceof TMDBError) {
        lastError = error
      } else {
        lastError = new TMDBError(`Network error: ${error.message}`)
      }
      
      if (attempt === retries) {
        throw lastError
      }
      
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000))
    }
  }

  throw lastError
}

/**
 * Search for movies or TV shows
 * @param {string} query - Search query
 * @param {string} [type='movie'] - 'movie' or 'tv'
 * @param {Object} [options] - Search options
 * @returns {Promise<Object>} Search results
 */
export async function searchMedia(query, type = 'movie', options = {}) {
  const { page = 1 } = options

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    throw new TMDBError('Search query is required')
  }

  if (!['movie', 'tv'].includes(type)) {
    throw new TMDBError('Type must be "movie" or "tv"')
  }

  return await makeRequest('/search', {
    params: {
      type,
      query: query.trim(),
      page
    }
  })
}

/**
 * Get media details by TMDB ID
 * @param {number} mediaId - TMDB media ID
 * @param {string} type - 'movie' or 'tv'
 * @returns {Promise<Object>} Media details
 */
export async function getMediaDetails(mediaId, type) {
  if (!mediaId || isNaN(mediaId) || mediaId <= 0) {
    throw new TMDBError('Valid media ID is required')
  }

  if (!['movie', 'tv'].includes(type)) {
    throw new TMDBError('Type must be "movie" or "tv"')
  }

  return await makeRequest(`/details/${type}/${mediaId}`)
}

/**
 * Get comprehensive media details including cast, trailer, logo, and rating
 * @param {Object} options - Search options
 * @param {string} [options.name] - Media name for search
 * @param {number} [options.tmdbId] - TMDB ID
 * @param {string} options.type - 'movie' or 'tv'
 * @returns {Promise<Object>} Comprehensive media details
 */
export async function getComprehensiveDetails(options) {
  const { name, tmdbId, type } = options

  if (!name && !tmdbId) {
    throw new TMDBError('Either name or tmdbId is required')
  }

  if (!['movie', 'tv'].includes(type)) {
    throw new TMDBError('Type must be "movie" or "tv"')
  }

  const params = {}
  if (name) params.name = name
  if (tmdbId) params.tmdb_id = tmdbId

  return await makeRequest(`/comprehensive/${type}`, { params })
}

/**
 * Get cast information for media
 * @param {number} mediaId - TMDB media ID
 * @param {string} type - 'movie' or 'tv'
 * @returns {Promise<Array>} Cast information
 */
export async function getCast(mediaId, type) {
  if (!mediaId || isNaN(mediaId) || mediaId <= 0) {
    throw new TMDBError('Valid media ID is required')
  }

  if (!['movie', 'tv'].includes(type)) {
    throw new TMDBError('Type must be "movie" or "tv"')
  }

  return await makeRequest(`/cast/${type}/${mediaId}`)
}

/**
 * Get videos/trailers for media
 * @param {number} mediaId - TMDB media ID
 * @param {string} type - 'movie' or 'tv'
 * @returns {Promise<Object>} Videos and trailer information
 */
export async function getVideos(mediaId, type) {
  if (!mediaId || isNaN(mediaId) || mediaId <= 0) {
    throw new TMDBError('Valid media ID is required')
  }

  if (!['movie', 'tv'].includes(type)) {
    throw new TMDBError('Type must be "movie" or "tv"')
  }

  return await makeRequest(`/videos/${type}/${mediaId}`)
}

/**
 * Get images for media
 * @param {number} mediaId - TMDB media ID
 * @param {string} type - 'movie' or 'tv'
 * @returns {Promise<Object>} Images including logos, backdrops, and posters
 */
export async function getImages(mediaId, type) {
  if (!mediaId || isNaN(mediaId) || mediaId <= 0) {
    throw new TMDBError('Valid media ID is required')
  }

  if (!['movie', 'tv'].includes(type)) {
    throw new TMDBError('Type must be "movie" or "tv"')
  }

  return await makeRequest(`/images/${type}/${mediaId}`)
}

/**
 * Get content rating for media
 * @param {number} mediaId - TMDB media ID
 * @param {string} type - 'movie' or 'tv'
 * @returns {Promise<Object>} Content rating
 */
export async function getRating(mediaId, type) {
  if (!mediaId || isNaN(mediaId) || mediaId <= 0) {
    throw new TMDBError('Valid media ID is required')
  }

  if (!['movie', 'tv'].includes(type)) {
    throw new TMDBError('Type must be "movie" or "tv"')
  }

  return await makeRequest(`/rating/${type}/${mediaId}`)
}

/**
 * Get TV episode details
 * @param {number} showId - TMDB show ID
 * @param {number} season - Season number
 * @param {number} episode - Episode number
 * @returns {Promise<Object>} Episode details
 */
export async function getEpisodeDetails(showId, season, episode) {
  if (!showId || isNaN(showId) || showId <= 0) {
    throw new TMDBError('Valid show ID is required')
  }

  if (!season || isNaN(season) || season <= 0) {
    throw new TMDBError('Valid season number is required')
  }

  if (!episode || isNaN(episode) || episode <= 0) {
    throw new TMDBError('Valid episode number is required')
  }

  return await makeRequest(`/episode/${showId}/${season}/${episode}`)
}

/**
 * Get TV episode images
 * @param {number} showId - TMDB show ID
 * @param {number} season - Season number
 * @param {number} episode - Episode number
 * @returns {Promise<Object>} Episode images
 */
export async function getEpisodeImages(showId, season, episode) {
  if (!showId || isNaN(showId) || showId <= 0) {
    throw new TMDBError('Valid show ID is required')
  }

  if (!season || isNaN(season) || season <= 0) {
    throw new TMDBError('Valid season number is required')
  }

  if (!episode || isNaN(episode) || episode <= 0) {
    throw new TMDBError('Valid episode number is required')
  }

  return await makeRequest(`/episode/${showId}/${season}/${episode}/images`)
}

/**
 * Check TMDB service health
 * @returns {Promise<Object>} Health status
 */
export async function getHealth() {
  return await makeRequest('/health')
}

/**
 * Test TMDB server connectivity
 * @returns {Promise<Object>} Connection test results
 */
export async function testTMDBConnection() {
  try {
    const startTime = Date.now()
    const health = await getHealth()
    const responseTime = Date.now() - startTime
    
    return {
      success: true,
      serverURL: 'Local Next.js API Proxy',
      tmdbConfigured: health.tmdb_configured === true,
      responseTime,
      timestamp: new Date().toISOString(),
      details: health
    }
  } catch (error) {
    return {
      success: false,
      serverURL: 'Local Next.js API Proxy',
      tmdbConfigured: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }
  }
}

/**
 * Validate TMDB server configuration
 * @returns {Promise<Object>} Validation results
 */
export async function validateTMDBConfiguration() {
  const validation = {
    serverURL: {
      configured: true, // Always true for local proxy
      value: 'Local Next.js API Proxy',
      valid: true
    },
    connectivity: {
      reachable: false,
      responseTime: null
    },
    overall: false
  }

  // Test connectivity through local proxy
  try {
    const connectionTest = await testTMDBConnection()
    validation.connectivity.reachable = connectionTest.success
    validation.connectivity.responseTime = connectionTest.responseTime
    
    if (!connectionTest.success) {
      validation.connectivity.error = connectionTest.error
    }
  } catch (error) {
    validation.connectivity.error = error.message
  }

  // Overall validation
  validation.overall = validation.serverURL.valid && validation.connectivity.reachable

  return validation
}

/**
 * Format TMDB media item for watchlist
 * @param {Object} item - TMDB media item
 * @returns {Object} Formatted item for watchlist
 */
export function formatForWatchlist(item) {
  const mediaType = item.media_type || (item.title ? 'movie' : 'tv')
  
  return {
    tmdbId: item.id,
    mediaType,
    title: item.title || item.name,
    isExternal: true,
    tmdbData: {
      overview: item.overview,
      poster_path: item.poster_path,
      backdrop_path: item.backdrop_path,
      genres: item.genres || [],
      original_language: item.original_language,
      vote_average: item.vote_average,
      vote_count: item.vote_count,
      release_date: item.release_date,
      first_air_date: item.first_air_date,
      // TV-specific fields
      number_of_seasons: item.number_of_seasons,
      number_of_episodes: item.number_of_episodes,
      status: item.status,
      networks: item.networks || []
    }
  }
}

/**
 * Check if TMDB item exists in internal database and return internal media data
 * @param {number} tmdbId - TMDB ID
 * @param {string} mediaType - 'movie' or 'tv'
 * @returns {Promise<Object|null>} Internal media data if found, null otherwise
 */
export async function findInternalMediaByTMDBId(tmdbId, mediaType) {
  if (!tmdbId || !mediaType) return null
  
  try {
    const response = await fetch('/api/authenticated/media/find-by-tmdb', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ tmdbId, mediaType }),
      credentials: 'include' // Include session cookies for authentication
    })
    
    if (!response.ok) {
      if (response.status === 404) return null
      throw new Error(`HTTP ${response.status}`)
    }
    
    const data = await response.json()
    return data.media || null
  } catch (error) {
    console.error('Error finding internal media by TMDB ID:', error)
    return null
  }
}

/**
 * Enhanced format function that checks for internal media first
 * @param {Object} item - TMDB media item
 * @returns {Promise<Object>} Formatted item for watchlist with proper internal/external detection
 */
export async function formatForWatchlistWithInternalCheck(item) {
  const mediaType = item.media_type || (item.title ? 'movie' : 'tv')
  const tmdbId = item.id
  
  // Check if this TMDB item exists in our internal database
  const internalMedia = await findInternalMediaByTMDBId(tmdbId, mediaType)
  
  if (internalMedia) {
    // This is internal media - include both mediaId (primary) and tmdbId (fallback)
    return {
      mediaId: internalMedia.id || internalMedia._id,
      tmdbId, // Keep TMDB ID as fallback
      mediaType,
      title: internalMedia.title || item.title || item.name,
      isExternal: false
    }
  } else {
    // This is external media - use original format (tmdbId only)
    return formatForWatchlist(item)
  }
}

/**
 * Get TMDB image URL (images from backend are already full URLs)
 * @param {string} path - Image path from TMDB
 * @param {string} [size='original'] - Image size (not used since backend returns full URLs)
 * @returns {string|null} Full image URL or null
 */
export function getTMDBImageURL(path, size = 'original') {
  if (!path) return null
  
  // If path is already a full URL, return as-is
  if (path.startsWith('http')) {
    return path
  }
  
  // Otherwise, construct the URL
  return `https://image.tmdb.org/t/p/${size}${path}`
}

/**
 * Check if TMDB is available by checking health
 * @returns {Promise<boolean>} True if TMDB is available
 */
export async function isTMDBAvailable() {
  try {
    const health = await getHealth()
    return health.tmdb_configured === true
  } catch (error) {
    console.error('Error checking TMDB availability:', error)
    return false
  }
}

// Export constants
export const TMDB_CONSTANTS = {
  IMAGE_BASE_URL: 'https://image.tmdb.org/t/p/',
  POSTER_SIZES: ['w92', 'w154', 'w185', 'w342', 'w500', 'w780', 'original'],
  BACKDROP_SIZES: ['w300', 'w780', 'w1280', 'original'],
  PROFILE_SIZES: ['w45', 'w185', 'h632', 'original'],
  LOGO_SIZES: ['w45', 'w92', 'w154', 'w185', 'w300', 'w500', 'original']
}