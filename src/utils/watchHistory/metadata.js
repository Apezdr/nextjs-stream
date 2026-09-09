/**
 * Watch History Metadata Extraction and Formatting
 * 
 * Utilities for extracting and formatting playback metadata
 * from frontend payloads for database storage
 */

import { createLogger } from '@src/lib/logger'

const log = createLogger('WatchHistory.Metadata')

/**
 * A season or episode number as the client sent it, or undefined when it did
 * not send one. Zero is a real value — Specials live in season 0 — so this is
 * `??`-shaped, not `||`-shaped. Numeric strings are accepted because route
 * params arrive that way from some clients.
 */
function presentNumber(value) {
  if (value === undefined || value === null || value === '') return undefined
  const n = typeof value === 'string' ? Number(value) : value
  return Number.isFinite(n) ? n : undefined
}

function presentString(value) {
  if (value === undefined || value === null) return undefined
  const s = typeof value === 'string' ? value : String(value)
  return s === '' ? undefined : s
}

/**
 * Extract and format media metadata for storage.
 *
 * Only fields the client actually sent come back. Every consumer spreads this
 * into a `$set`, and an explicit null there is not "unknown" — it is "erase
 * what the row already knows". A heartbeat that omits showId/seasonNumber/
 * episodeNumber (the contract marks them optional) must leave the row's TV
 * grouping alone, not wipe it.
 *
 * @param {Object} mediaMetadata - The media metadata object from frontend
 * @returns {Object} Formatted metadata for database storage (present fields only)
 */
export function extractPlaybackMetadata(mediaMetadata) {
  if (!mediaMetadata || typeof mediaMetadata !== 'object') {
    return {}
  }

  const out = {}
  const mediaType = presentString(mediaMetadata.mediaType)
  const mediaId = presentString(mediaMetadata.mediaId)
  const showId = presentString(mediaMetadata.showId)
  const seasonNumber = presentNumber(mediaMetadata.seasonNumber)
  const episodeNumber = presentNumber(mediaMetadata.episodeNumber)

  if (mediaType !== undefined) out.mediaType = mediaType
  if (mediaId !== undefined) out.mediaId = mediaId
  if (showId !== undefined) out.showId = showId
  if (seasonNumber !== undefined) out.seasonNumber = seasonNumber
  if (episodeNumber !== undefined) out.episodeNumber = episodeNumber
  return out
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

  // Ensure mediaType is valid — an unknown type is dropped, never nulled
  if (base.mediaType !== undefined && !['movie', 'tv'].includes(base.mediaType)) {
    log.warn({ mediaType: base.mediaType }, 'Invalid media type, dropping it')
    delete base.mediaType
  }

  // Season 0 (Specials) and episode 0 are real; negatives and fractions are not
  if (base.seasonNumber !== undefined && (!Number.isInteger(base.seasonNumber) || base.seasonNumber < 0)) {
    log.warn({ seasonNumber: base.seasonNumber }, 'Invalid season number, dropping it')
    delete base.seasonNumber
  }

  if (base.episodeNumber !== undefined && (!Number.isInteger(base.episodeNumber) || base.episodeNumber < 0)) {
    log.warn({ episodeNumber: base.episodeNumber }, 'Invalid episode number, dropping it')
    delete base.episodeNumber
  }

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
