import { syncBackdrop } from './backdrop'
import { syncBlurhash } from './blurhash'
import { syncCaptions } from './captions'
import { syncChapters } from './chapters'
import { syncLogos } from './logos'
import { syncMetadata } from './metadata'
import { syncPosterURLs } from './posters'
import { syncTVThumbnails } from './thumbnails'
import { syncVideoInfo } from './videoInfo'
import { syncVideoURL } from './videoUrl'
import { identifyMissingMedia } from './fileServer'
import { 
  checkVideoAvailabilityAcrossServers, 
  removeUnavailableVideos,
  clearRelatedCacheEntries,
  isMovieAvailableOnAnyServer,
  isEpisodeAvailableOnAnyServer,
  gatherUnavailableMovies,
  gatherUnavailableTVContent
} from './videoAvailability'
import { MediaType } from './utils'

export {
  // Core sync functions
  syncBackdrop,
  syncBlurhash,
  syncCaptions,
  syncChapters,
  syncLogos,
  syncMetadata,
  syncPosterURLs,
  syncTVThumbnails,
  syncVideoInfo,
  syncVideoURL,
  
  // File server operations
  identifyMissingMedia,
  
  // Video availability operations
  checkVideoAvailabilityAcrossServers,
  removeUnavailableVideos,
  clearRelatedCacheEntries,
  isMovieAvailableOnAnyServer,
  isEpisodeAvailableOnAnyServer,
  gatherUnavailableMovies,
  gatherUnavailableTVContent,
  
  // Types
  MediaType,
}

// Re-export utility functions that may be needed by external code
export {
  createFullUrl,
  filterLockedFields,
  isSourceMatchingServer,
  isCurrentServerHighestPriorityForField,
  findEpisodeFileName,
  matchEpisodeFileName,
  extractEpisodeDetails,
  processCaptionURLs,
} from './utils'

// Re-export database operations that may be needed by external code
export {
  updateEpisodeInDatabase,
  updateMediaInDatabase,
} from './database'

// Re-export file server operations that may be needed by external code
export {
  processMovieData,
  processShowData,
  extractSeasonInfo,
} from './fileServer'
