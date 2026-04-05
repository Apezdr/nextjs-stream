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

// Episode domain
export * from './episodes'

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

export {
  EpisodeSyncService,
  EpisodeContentStrategy
} from './episodes'

export {
  SeasonSyncService,
  SeasonMetadataStrategy,
  SeasonPosterStrategy
} from './seasons'
