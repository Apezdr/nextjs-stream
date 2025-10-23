/**
 * New sync system main exports
 * Central export point for the entire domain-driven sync architecture
 */

// Core foundation
export * from './core'

// Infrastructure layer
export * from './infrastructure'

// Domain services
export * from './domain'

// Main orchestrator
export * from './SyncManager'

// Convenience exports for easy migration
export {
  syncManager,
  syncMoviesWithNewArchitecture,
  getSyncSystemStats
} from './SyncManager'

// Key types for external consumers
export type {
  // Core types
  MediaType,
  SyncOperation,
  SyncStatus,
  SyncContext,
  SyncResult,
  BatchSyncResult,
  ServerConfig,
  FieldAvailability,
  
  // Entity types
  BaseMediaEntity,
  MovieEntity,
  EpisodeEntity,
  SeasonEntity,
  TVShowEntity,
  
  // Infrastructure types
  FileServerAdapter,
  MediaRepository,
  SyncStrategy
} from './core'