/**
 * Validation functions for watchlist operations with playlist support
 * Provides input validation for watchlist and playlist functionality
 */

/**
 * Valid media types
 */
export const VALID_MEDIA_TYPES = [
  'movie',
  'tv'
]

/**
 * Valid playlist privacy settings
 */
export const VALID_PRIVACY_SETTINGS = [
  'private',
  'shared',
  'public'
]

/**
 * Valid collaboration permissions
 */
export const VALID_PERMISSIONS = [
  'view',
  'add',
  'edit',
  'admin'
]

/**
 * Validation error class
 */
export class WatchlistValidationError extends Error {
  constructor(message, field = null) {
    super(message)
    this.name = 'WatchlistValidationError'
    this.field = field
  }
}

/**
 * Validate watchlist item data for adding to watchlist
 * @param {Object} item - Item data to validate
 * @param {string} [item.mediaId] - Internal media ID
 * @param {number} [item.tmdbId] - TMDB ID
 * @param {string} item.mediaType - Media type
 * @param {string} item.title - Media title
 * @param {boolean} [item.isExternal] - Whether external media
 * @param {Object} [item.tmdbData] - TMDB metadata
 * @param {string} [item.playlistId] - Playlist ID
 * @returns {Object} Validated and sanitized item data
 * @throws {WatchlistValidationError} If validation fails
 */
export function validateWatchlistItem(item) {
  if (!item || typeof item !== 'object') {
    throw new WatchlistValidationError('Item data is required')
  }

  const validated = {}

  // Validate media identification (either mediaId or tmdbId required)
  if (!item.mediaId && !item.tmdbId) {
    throw new WatchlistValidationError('Either mediaId or tmdbId is required')
  }

  // Validate mediaId if present
  if (item.mediaId) {
    if (typeof item.mediaId !== 'string' || !item.mediaId.trim()) {
      throw new WatchlistValidationError('mediaId must be a non-empty string', 'mediaId')
    }
    validated.mediaId = item.mediaId.trim()
    // If mediaId is present, this is internal media (even if tmdbId is also present)
    validated.isExternal = false
  }

  // Validate tmdbId if present
  if (item.tmdbId) {
    const tmdbId = parseInt(item.tmdbId)
    if (isNaN(tmdbId) || tmdbId <= 0) {
      throw new WatchlistValidationError('tmdbId must be a positive integer', 'tmdbId')
    }
    validated.tmdbId = tmdbId
    // Only set as external if no mediaId is present
    if (!validated.mediaId) {
      validated.isExternal = true
    }
  }

  // Override isExternal if explicitly provided (for backward compatibility)
  if (typeof item.isExternal === 'boolean') {
    validated.isExternal = item.isExternal
  }

  // Validate media type
  if (!item.mediaType) {
    throw new WatchlistValidationError('mediaType is required', 'mediaType')
  }
  if (!VALID_MEDIA_TYPES.includes(item.mediaType)) {
    throw new WatchlistValidationError(
      `mediaType must be one of: ${VALID_MEDIA_TYPES.join(', ')}`,
      'mediaType'
    )
  }
  validated.mediaType = item.mediaType

  // Validate title
  if (!item.title) {
    throw new WatchlistValidationError('title is required', 'title')
  }
  if (typeof item.title !== 'string' || !item.title.trim()) {
    throw new WatchlistValidationError('title must be a non-empty string', 'title')
  }
  if (item.title.length > 500) {
    throw new WatchlistValidationError('title must be 500 characters or less', 'title')
  }
  validated.title = item.title.trim()

  // Validate posterURL (optional, primarily for external media from collections)
  if (item.posterURL) {
    if (typeof item.posterURL !== 'string' || !item.posterURL.trim()) {
      throw new WatchlistValidationError('posterURL must be a non-empty string', 'posterURL')
    }
    // Basic URL validation - should start with http/https or be a relative path
    const posterURL = item.posterURL.trim()
    if (posterURL.startsWith('http') || posterURL.startsWith('/')) {
      validated.posterURL = posterURL
    } else {
      throw new WatchlistValidationError('posterURL must be a valid URL or path', 'posterURL')
    }
  }

  // Validate playlist ID (optional)
  if (item.playlistId) {
    if (typeof item.playlistId !== 'string' || !item.playlistId.trim()) {
      throw new WatchlistValidationError('playlistId must be a non-empty string', 'playlistId')
    }
    validated.playlistId = item.playlistId.trim()
  }

  // Validate TMDB data for external items
  if (validated.isExternal && item.tmdbData) {
    validated.tmdbData = validateTmdbData(item.tmdbData, validated.mediaType)
  }

  return validated
}

/**
 * Validate TMDB data for external watchlist items
 * @param {Object} tmdbData - TMDB metadata
 * @param {string} mediaType - Media type ('movie' or 'tv')
 * @returns {Object} Validated TMDB data
 */
export function validateTmdbData(tmdbData, mediaType) {
  if (!tmdbData || typeof tmdbData !== 'object') {
    return {}
  }

  const validated = {}

  // Common fields for both movies and TV shows
  if (tmdbData.overview && typeof tmdbData.overview === 'string') {
    validated.overview = tmdbData.overview.slice(0, 2000)
  }

  if (tmdbData.poster_path && typeof tmdbData.poster_path === 'string') {
    validated.poster_path = tmdbData.poster_path
  }

  if (tmdbData.backdrop_path && typeof tmdbData.backdrop_path === 'string') {
    validated.backdrop_path = tmdbData.backdrop_path
  }

  if (tmdbData.genres && Array.isArray(tmdbData.genres)) {
    validated.genres = tmdbData.genres.slice(0, 10)
  }

  if (tmdbData.original_language && typeof tmdbData.original_language === 'string') {
    validated.original_language = tmdbData.original_language
  }

  if (typeof tmdbData.vote_average === 'number' && tmdbData.vote_average >= 0 && tmdbData.vote_average <= 10) {
    validated.vote_average = tmdbData.vote_average
  }

  if (typeof tmdbData.vote_count === 'number' && tmdbData.vote_count >= 0) {
    validated.vote_count = tmdbData.vote_count
  }

  // Date validation
  if (mediaType === 'movie' && tmdbData.release_date) {
    if (isValidDateString(tmdbData.release_date)) {
      validated.release_date = tmdbData.release_date
    }
  }

  if (mediaType === 'tv' && tmdbData.first_air_date) {
    if (isValidDateString(tmdbData.first_air_date)) {
      validated.first_air_date = tmdbData.first_air_date
    }
  }

  // TV-specific fields
  if (mediaType === 'tv') {
    if (typeof tmdbData.number_of_seasons === 'number' && tmdbData.number_of_seasons > 0) {
      validated.number_of_seasons = tmdbData.number_of_seasons
    }

    if (typeof tmdbData.number_of_episodes === 'number' && tmdbData.number_of_episodes > 0) {
      validated.number_of_episodes = tmdbData.number_of_episodes
    }

    if (tmdbData.status && typeof tmdbData.status === 'string') {
      validated.status = tmdbData.status
    }

    if (tmdbData.networks && Array.isArray(tmdbData.networks)) {
      validated.networks = tmdbData.networks.slice(0, 5)
    }
  }

  return validated
}

/**
 * Validate watchlist query parameters
 * @param {Object} params - Query parameters
 * @param {number} [params.page] - Page number
 * @param {number} [params.limit] - Items per page
 * @param {string} [params.mediaType] - Media type filter
 * @param {string} [params.playlistId] - Playlist ID filter
 * @returns {Object} Validated query parameters
 * @throws {WatchlistValidationError} If validation fails
 */
export function validateWatchlistQuery(params = {}) {
  const validated = {}

  // Validate page
  if (params.page !== undefined) {
    const page = parseInt(params.page)
    if (isNaN(page) || page < 0) {
      throw new WatchlistValidationError('page must be a non-negative integer', 'page')
    }
    validated.page = page
  } else {
    validated.page = 0
  }

  // Validate limit
  if (params.limit !== undefined) {
    const limit = parseInt(params.limit)
    if (isNaN(limit) || limit < 1 || limit > 100) {
      throw new WatchlistValidationError('limit must be between 1 and 100', 'limit')
    }
    validated.limit = limit
  } else {
    validated.limit = 20
  }

  // Validate media type filter
  if (params.mediaType) {
    if (!VALID_MEDIA_TYPES.includes(params.mediaType)) {
      throw new WatchlistValidationError(
        `mediaType must be one of: ${VALID_MEDIA_TYPES.join(', ')}`,
        'mediaType'
      )
    }
    validated.mediaType = params.mediaType
  }

  // Validate playlist ID filter
  if (params.playlistId) {
    if (typeof params.playlistId !== 'string' || !params.playlistId.trim()) {
      throw new WatchlistValidationError('playlistId must be a non-empty string', 'playlistId')
    }
    validated.playlistId = params.playlistId.trim()
  }

  return validated
}

/**
 * Validate playlist data
 * @param {Object} playlist - Playlist data
 * @param {string} playlist.name - Playlist name
 * @param {string} [playlist.description] - Playlist description
 * @param {string} [playlist.privacy] - Privacy setting
 * @returns {Object} Validated playlist data
 * @throws {WatchlistValidationError} If validation fails
 */
export function validatePlaylistData(playlist) {
  if (!playlist || typeof playlist !== 'object') {
    throw new WatchlistValidationError('Playlist data is required')
  }

  const validated = {}

  // Validate name
  if (!playlist.name) {
    throw new WatchlistValidationError('Playlist name is required', 'name')
  }
  if (typeof playlist.name !== 'string' || !playlist.name.trim()) {
    throw new WatchlistValidationError('Playlist name must be a non-empty string', 'name')
  }
  if (playlist.name.length > 100) {
    throw new WatchlistValidationError('Playlist name must be 100 characters or less', 'name')
  }
  validated.name = playlist.name.trim()

  // Validate description (optional)
  if (playlist.description !== undefined) {
    if (typeof playlist.description !== 'string') {
      throw new WatchlistValidationError('Playlist description must be a string', 'description')
    }
    if (playlist.description.length > 500) {
      throw new WatchlistValidationError('Playlist description must be 500 characters or less', 'description')
    }
    validated.description = playlist.description.trim()
  } else {
    validated.description = ''
  }

  // Validate privacy setting (optional)
  if (playlist.privacy !== undefined) {
    if (!VALID_PRIVACY_SETTINGS.includes(playlist.privacy)) {
      throw new WatchlistValidationError(
        `Privacy setting must be one of: ${VALID_PRIVACY_SETTINGS.join(', ')}`,
        'privacy'
      )
    }
    validated.privacy = playlist.privacy
  } else {
    validated.privacy = 'private'
  }

  return validated
}

/**
 * Validate collaboration data for sharing playlists
 * @param {Array} collaborators - Array of collaborator objects
 * @returns {Array} Validated collaborators
 * @throws {WatchlistValidationError} If validation fails
 */
export function validateCollaborators(collaborators) {
  if (!Array.isArray(collaborators)) {
    throw new WatchlistValidationError('Collaborators must be an array')
  }

  if (collaborators.length > 20) {
    throw new WatchlistValidationError('Maximum 20 collaborators allowed')
  }

  return collaborators.map((collab, index) => {
    if (!collab || typeof collab !== 'object') {
      throw new WatchlistValidationError(`Collaborator ${index + 1} must be an object`)
    }

    // Validate email
    if (!collab.email) {
      throw new WatchlistValidationError(`Collaborator ${index + 1} email is required`)
    }
    if (typeof collab.email !== 'string' || !collab.email.trim()) {
      throw new WatchlistValidationError(`Collaborator ${index + 1} email must be a non-empty string`)
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(collab.email)) {
      throw new WatchlistValidationError(`Collaborator ${index + 1} email must be valid`)
    }

    // Validate permission
    if (!collab.permission) {
      throw new WatchlistValidationError(`Collaborator ${index + 1} permission is required`)
    }
    if (!VALID_PERMISSIONS.includes(collab.permission)) {
      throw new WatchlistValidationError(
        `Collaborator ${index + 1} permission must be one of: ${VALID_PERMISSIONS.join(', ')}`
      )
    }

    return {
      email: collab.email.trim().toLowerCase(),
      permission: collab.permission
    }
  })
}

/**
 * Validate MongoDB ObjectId string
 * @param {string} id - ID to validate
 * @param {string} fieldName - Field name for error messages
 * @returns {boolean} True if valid
 * @throws {WatchlistValidationError} If validation fails
 */
export function validateObjectId(id, fieldName = 'id') {
  if (!id) {
    throw new WatchlistValidationError(`${fieldName} is required`, fieldName)
  }
  
  if (typeof id !== 'string') {
    throw new WatchlistValidationError(`${fieldName} must be a string`, fieldName)
  }

  // MongoDB ObjectId is 24 character hex string
  if (!/^[0-9a-fA-F]{24}$/.test(id)) {
    throw new WatchlistValidationError(`${fieldName} must be a valid ObjectId`, fieldName)
  }

  return true
}

/**
 * Check if a string is a valid date in YYYY-MM-DD format
 * @param {string} dateString - Date string to validate
 * @returns {boolean} True if valid date
 */
function isValidDateString(dateString) {
  if (typeof dateString !== 'string') {
    return false
  }

  // Check format YYYY-MM-DD
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/
  if (!dateRegex.test(dateString)) {
    return false
  }

  // Check if it's a valid date
  const date = new Date(dateString)
  return date instanceof Date && !isNaN(date) && date.toISOString().slice(0, 10) === dateString
}

/**
 * Get validation error response for API endpoints
 * @param {Error} error - Validation error
 * @returns {Object} Error response object
 */
export function getValidationErrorResponse(error) {
  if (error instanceof WatchlistValidationError) {
    return {
      error: 'Validation Error',
      message: error.message,
      field: error.field,
      status: 400
    }
  }

  return {
    error: 'Internal Server Error',
    message: 'An unexpected error occurred',
    status: 500
  }
}