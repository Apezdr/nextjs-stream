/**
 * Infrastructure layer exports
 * Central export point for all infrastructure components
 */

// Database infrastructure
export * from './database'

// File system infrastructure
export * from './fileSystem'

// Re-export key components for convenience
export {
  createDatabaseAdapter,
  type DatabaseAdapter
} from './database'

export {
  DefaultFileServerAdapter,
  UrlBuilder
} from './fileSystem'