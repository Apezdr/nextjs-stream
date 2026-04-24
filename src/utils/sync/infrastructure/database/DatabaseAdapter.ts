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

  constructor(client: MongoClient) {
    this.client = client
    this.movies = new MovieRepository(client)
    this.episodes = new EpisodeRepository(client)
    this.seasons = new SeasonRepository(client)
    this.tvShows = new TVShowRepository(client)
  }

  /**
   * Initialize the database adapter and create indexes
   */
  async initialize(): Promise<void> {
    try {
      if (!this.indexesCreated) {
        console.log('Creating database indexes...')
        
        await Promise.all([
          this.movies.createIndexes(),
          this.episodes.createIndexes(),
          this.seasons.createIndexes(),
          this.tvShows.createIndexes()
        ])

        this.indexesCreated = true
        console.log('Database indexes created successfully')
      }
    } catch (error) {
      throw new DatabaseError(`Failed to initialize database adapter: ${error}`)
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
  var __syncDatabaseAdapterPromise: Promise<MongoDBAdapter> | undefined
}

/**
 * Factory function to create database adapter.
 *
 * Caches the adapter (and its index-creation promise) at module scope so
 * `initialize()` — which fires ~51 `createIndex` wire calls across four
 * collections — runs exactly once per process lifetime, not on every caller.
 */
export async function createDatabaseAdapter(client: MongoClient): Promise<MongoDBAdapter> {
  if (!globalThis.__syncDatabaseAdapterPromise) {
    const adapter = new MongoDBAdapter(client)
    globalThis.__syncDatabaseAdapterPromise = adapter.initialize()
      .then(() => adapter)
      .catch((err) => {
        // Don't poison the cache on transient failures — let the next caller retry
        globalThis.__syncDatabaseAdapterPromise = undefined
        throw err
      })
  }
  return globalThis.__syncDatabaseAdapterPromise
}