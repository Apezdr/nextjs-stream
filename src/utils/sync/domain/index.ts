/**
 * Domain layer exports
 * Central export point for all domain services and components
 */

// Movie domain (MovieSyncService)
export * from './movies'

// TV domain (TVShowSyncService, SeasonSyncService, EpisodeSyncService)
export * from './tv'

export {
  TVShowSyncService as TVShowSyncServiceCore,
  SeasonSyncService as SeasonSyncServiceCore,
  EpisodeSyncService as EpisodeSyncServiceCore
} from './tv'

// EpisodeSyncService is the production read-merge-replace service from './tv'
// (re-exported via `export * from './tv'` above, and aliased as
// EpisodeSyncServiceCore). The former strategy-based './episodes' variant was
// an unwired early experiment and has been removed.
export {
  EpisodeSyncService
} from './tv'
