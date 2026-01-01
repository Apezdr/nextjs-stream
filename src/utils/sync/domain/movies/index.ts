/**
 * Movie domain exports
 * Central export point for all movie-related sync components
 */

export * from './MovieSyncService'
export * from './strategies'

// Re-export key components for convenience
export { MovieSyncService } from './MovieSyncService'
export { 
  MovieMetadataStrategy,
  MovieAssetStrategy
} from './strategies'