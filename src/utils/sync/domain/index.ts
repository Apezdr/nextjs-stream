/**
 * Domain layer exports
 * Central export point for all domain services and components
 */

// Movie domain
export * from './movies'

// Shared cross-domain strategies
export * from './shared'

// TV domain (TVShowSyncService, SeasonSyncService, EpisodeSyncService)
export * from './tv'

// TV show domain
export * from './tvShows'

// Season domain
export * from './seasons'

// Re-export key domain services for convenience
export {
  MovieSyncService,
  MovieMetadataStrategy,
  MovieAssetStrategy
} from './movies'

export { BlurhashStrategy } from './shared'

export {
  TVShowSyncService as TVShowSyncServiceCore,
  SeasonSyncService as SeasonSyncServiceCore,
  EpisodeSyncService as EpisodeSyncServiceCore
} from './tv'

export {
  TVShowSyncService,
  TVShowMetadataStrategy,
  TVShowAssetStrategy
} from './tvShows'

// EpisodeSyncService is the production read-merge-replace service from './tv'
// (re-exported via `export * from './tv'` above, and aliased as
// EpisodeSyncServiceCore). The former strategy-based './episodes' variant was
// an unwired early experiment and has been removed.
export {
  EpisodeSyncService
} from './tv'

export {
  SeasonSyncService,
  SeasonMetadataStrategy,
  SeasonPosterStrategy
} from './seasons'
