/**
 * Core sync infrastructure exports
 * Central export point for all core sync system components
 */

// Types and interfaces
export * from './types'

// Event system
export * from './events'

// Validation system
export * from './validation'

// Logger system
export * from './logger'

// Field path mappings (type-safe fieldAvailability lookups)
export * from './fieldPaths'

// Resource management (throttling, memory monitoring)
export { ResourceManager, getResourceConfig } from './ResourceManager'
export type { ResourceConfig } from './ResourceManager'

// Re-export commonly used items for convenience
export {
  MediaType,
  SyncOperation,
  SyncStatus,
  SyncEventType,
  type MediaRepository,
  type SyncStrategy,
  type SyncContext,
  type SyncResult,
  type BatchSyncResult,
  type ServerConfig,
  type FieldAvailability,
  type BaseMediaEntity,
  type MovieEntity,
  type EpisodeEntity,
  type SeasonEntity,
  type TVShowEntity
} from './types'

export {
  syncEventBus,
  SyncEvents
} from './events'

export {
  validateEntity,
  validateEntityOrThrow,
  validateVideoInfo,
  validateCaptionTracks,
  validateChapterMarkers
} from './validation'