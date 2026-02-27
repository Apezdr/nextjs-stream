/**
 * Watch History Metadata Extraction and Formatting
 * 
 * Utilities for extracting and formatting playback metadata
 * from frontend payloads for database storage
 */

import { createLogger } from '@src/lib/logger'

const log = createLogger('WatchHistory.Metadata')

/**
 * Extract and format media metadata for storage
 * Validates metadata structure and ensures type safety
 * 
 * @param {Object} mediaMetadata - The media metadata object from frontend
 * @returns {Object} Formatted metadata for database storage
 */
export function extractPlaybackMetadata(mediaMetadata) {
  if (!mediaMetadata) {
    return {
      mediaType: null,
      mediaId: null,
      showId: null,
      seasonNumber: null,
      episodeNumber: null
    }
  }

  return {
    mediaType: mediaMetadata.mediaType || null,
    mediaId: mediaMetadata.mediaId || null,
    showId: mediaMetadata.showId || null,
    seasonNumber: mediaMetadata.seasonNumber || null,
    episodeNumber: mediaMetadata.episodeNumber || null
  }
}

/**
 * Build complete metadata object for storage
 * Includes validation and conditional TV-specific fields
 * 
 * @param {Object} mediaMetadata - Raw metadata from frontend
 * @returns {Object} Complete metadata object with all fields properly formatted
 */
export function buildPlaybackMetadata(mediaMetadata) {
  const base = extractPlaybackMetadata(mediaMetadata)

  // Ensure mediaType is valid
  if (base.mediaType && !['movie', 'tv'].includes(base.mediaType)) {
    log.warn({ mediaType: base.mediaType }, 'Invalid media type, treating as null')
    base.mediaType = null
  }

  // Ensure numeric fields are valid
  if (base.seasonNumber && (!Number.isInteger(base.seasonNumber) || base.seasonNumber < 1)) {
    log.warn({ seasonNumber: base.seasonNumber }, 'Invalid season number')
    base.seasonNumber = null
  }

  if (base.episodeNumber && (!Number.isInteger(base.episodeNumber) || base.episodeNumber < 1)) {
    log.warn({ episodeNumber: base.episodeNumber }, 'Invalid episode number')
    base.episodeNumber = null
  }

  // Remove empty strings and undefined values
  Object.keys(base).forEach(key => {
    if (base[key] === '' || base[key] === undefined) {
      delete base[key]
    }
  })

  return base
}

/**
 * Validate that provided metadata matches the actual media type
 * (e.g., TV-specific fields should only exist for mediaType: 'tv')
 * 
 * @param {Object} metadata - Metadata object to validate
 * @returns {boolean} True if metadata is valid
 */
export function isMetadataValid(metadata) {
  if (!metadata) return false

  const { mediaType, showId, seasonNumber, episodeNumber } = metadata

  // If mediaType is 'tv', we should have TV-specific fields
  if (mediaType === 'tv') {
    // At least show ID should be present
    if (!showId) {
      log.warn({ metadata }, 'TV metadata missing show ID')
      return false
    }
  }

  // If we have season/episode numbers, mediaType must be 'tv'
  if ((seasonNumber || episodeNumber) && mediaType !== 'tv') {
    log.warn({ metadata }, 'Season/episode numbers provided for non-TV media')
    return false
  }

  return true
}

/**
 * Format metadata for display/logging
 * Sanitizes sensitive information if needed
 * 
 * @param {Object} metadata - Metadata object
 * @returns {Object} Formatted metadata for logging
 */
export function formatMetadataForLogging(metadata) {
  return {
    mediaType: metadata?.mediaType || 'unknown',
    mediaId: metadata?.mediaId ? '[MASKED]' : 'none',
    isTV: metadata?.mediaType === 'tv',
    hasShowId: !!metadata?.showId,
    season: metadata?.seasonNumber || null,
    episode: metadata?.episodeNumber || null
  }
}
