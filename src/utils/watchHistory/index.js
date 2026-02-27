/**
 * Watch History Module
 * 
 * Centralized export point for all watch history operations
 * Provides clean, organized API for playback tracking, validation, and querying
 */

// Database operations
export {
  upsertPlayback,
  getPlaybackForUser,
  getPlaybackForVideo,
  getRecentlyWatchedForUser,
  getUsersWhoWatched,
  getViewCount,
  deletePlaybackForUser,
  clearValidationForUser,
  updateValidationStatus,
  getBulkPlaybackForUsers
} from './database'

// Server component utilities
export {
  getCurrentUserWatchHistory,
  getWatchTimeForVideo,
  hasUserWatchedVideo
} from './server'

// Lookup map creation
export { createWatchHistoryLookupMap } from './lookupMap'

// Metadata operations
export {
  extractPlaybackMetadata,
  buildPlaybackMetadata,
  isMetadataValid,
  formatMetadataForLogging
} from './metadata'

// Validation operations
export {
  validateAllPlaybackEntries,
  validateUserPlaybackEntries,
  validateAndUpdatePlaybackUrl,
  needsValidation,
  markPlaybackAsNeedingValidation
} from './validation'
