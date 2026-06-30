/**
 * Database adapter providing unified access to all repositories
 * Central coordination point for database operations
 */

import { MongoClient } from 'mongodb'
import { MovieRepository } from './MovieRepository'
import { EpisodeRepository } from './EpisodeRepository'
import { SeasonRepository } from './SeasonRepository'
import { TVShowRepository } from './TVShowRepository'
import { DatabaseError } from '../../core/types'

export interface DatabaseAdapter {
  movies: MovieRepository
  episodes: EpisodeRepository
  seasons: SeasonRepository
  tvShows: TVShowRepository
  
  getStats(): Promise<{
    movies: any
    episodes: any
    seasons: any
    tvShows: any
    overview: {
      totalEntities: number
      databaseSize?: number
    }
  }>
  
  close(): Promise<void>
}

export class MongoDBAdapter implements DatabaseAdapter {
  public readonly movies: MovieRepository
  public readonly episodes: EpisodeRepository
  public readonly seasons: SeasonRepository
  public readonly tvShows: TVShowRepository

  private client: MongoClient
  private indexesCreated: boolean = false
  private indexInitInFlight: Promise<void> | null = null

  constructor(client: MongoClient) {
    this.client = client
    this.movies = new MovieRepository(client)
    this.episodes = new EpisodeRepository(client)
    this.seasons = new SeasonRepository(client)
    this.tvShows = new TVShowRepository(client)
  }

  /**
   * Initialize the database adapter and create indexes.
   *
   * Idempotent and SELF-HEALING: a no-op once every index is confirmed created,
   * but if a prior attempt was left INCOMPLETE — a repo's index build dropped on a
   * transient Mongo connection close and didn't recover even after
   * createIndexSafely's retries — `indexesCreated` stays false so the next
   * createDatabaseAdapter()/sync re-attempts, instead of caching a half-indexed
   * state until the process restarts (which is how all four collections were left
   * with only `_id_` on 2026-06-20). Concurrent callers share one in-flight attempt.
   */
  async initialize(): Promise<void> {
    if (this.indexesCreated) return
    if (this.indexInitInFlight) return this.indexInitInFlight

    this.indexInitInFlight = (async () => {
      console.log('Creating database indexes...')
      // Repos catch their own errors and report success/failure, so Promise.all
      // never rejects on a per-collection index failure — we inspect the booleans.
      const results = await Promise.all([
        this.movies.createIndexes(),
        this.episodes.createIndexes(),
        this.seasons.createIndexes(),
        this.tvShows.createIndexes()
      ])
      if (results.every(Boolean)) {
        this.indexesCreated = true
        console.log('Database indexes created successfully')
      } else {
        const failed = ['movies', 'episodes', 'seasons', 'tvShows'].filter((_, i) => !results[i])
        console.error(
          `Database index creation INCOMPLETE for: ${failed.join(', ')} — leaving uncached so the next sync retries`
        )
      }
    })()

    try {
      await this.indexInitInFlight
    } finally {
      // Clear so a failed attempt (indexesCreated still false) can be retried by
      // the next caller; a successful attempt is gated out by the early return above.
      this.indexInitInFlight = null
    }
  }

  /**
   * Get comprehensive database statistics
   */
  async getStats(): Promise<{
    movies: any
    episodes: any
    seasons: any
    tvShows: any
    overview: {
      totalEntities: number
      databaseSize?: number
    }
  }> {
    try {
      const [movieStats, episodeStats, seasonStats, tvShowStats] = await Promise.all([
        this.movies.getMovieStats(),
        this.episodes.getEpisodeStats(),
        this.seasons.getSeasonStats(),
        this.tvShows.getTVShowStats()
      ])

      const totalEntities = movieStats.total + episodeStats.total + seasonStats.total + tvShowStats.total

      return {
        movies: movieStats,
        episodes: episodeStats,
        seasons: seasonStats,
        tvShows: tvShowStats,
        overview: {
          totalEntities
        }
      }
    } catch (error) {
      throw new DatabaseError(`Failed to get database statistics: ${error}`)
    }
  }

  /**
   * Health check for database connection
   */
  async healthCheck(): Promise<{
    connected: boolean
    latency: number
    collections: string[]
  }> {
    try {
      const start = Date.now()
      
      // Test connection with a simple operation
      await this.client.db().admin().ping()
      
      const latency = Date.now() - start

      // Get collection names
      const collections = await this.client.db().listCollections().toArray()
      const collectionNames = collections.map(col => col.name)

      return {
        connected: true,
        latency,
        collections: collectionNames
      }
    } catch (error) {
      return {
        connected: false,
        latency: -1,
        collections: []
      }
    }
  }

  /**
   * Get database connection info
   */
  getConnectionInfo(): {
    databaseName: string
    isConnected: boolean
  } {
    return {
      databaseName: this.client.db().databaseName,
      isConnected: true // Simplified connection check
    }
  }

  /**
   * Clean shutdown of database adapter
   */
  async close(): Promise<void> {
    try {
      await this.client.close()
    } catch (error) {
      console.error('Error closing database connection:', error)
    }
  }
}

declare global {
  // Preserve across HMR in development, same pattern as src/lib/mongodb.ts
  var __syncDatabaseAdapter: MongoDBAdapter | undefined
}

/**
 * Factory function to create the database adapter.
 *
 * Caches the adapter INSTANCE at module scope (not its init promise) and calls
 * `initialize()` on every invocation. initialize() is a no-op once all indexes are
 * confirmed created, and dedupes concurrent callers internally so the ~51
 * `createIndex` calls don't re-fire — but a prior INCOMPLETE attempt (a build
 * dropped on a transient connection close) re-runs here on the next sync. Caching
 * the init PROMISE instead, as before, pinned a half-indexed adapter for the whole
 * process lifetime and required a restart to recover.
 */
export async function createDatabaseAdapter(client: MongoClient): Promise<MongoDBAdapter> {
  if (!globalThis.__syncDatabaseAdapter) {
    globalThis.__syncDatabaseAdapter = new MongoDBAdapter(client)
  }
  const adapter = globalThis.__syncDatabaseAdapter
  await adapter.initialize()
  return adapter
}