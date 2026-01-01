/**
 * Database infrastructure exports
 * Central export point for all database-related components
 */

export * from './BaseRepository'
export * from './MovieRepository'
export * from './EpisodeRepository'
export * from './SeasonRepository'
export * from './TVShowRepository'
export * from './DatabaseAdapter'

// Re-export key types for convenience
export type {
  DatabaseAdapter
} from './DatabaseAdapter'

export {
  createDatabaseAdapter
} from './DatabaseAdapter'