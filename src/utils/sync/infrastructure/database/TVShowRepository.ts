/**
 * TV Show-specific repository implementation
 * Handles all database operations for TV show entities
 */

import { MongoClient } from 'mongodb'
import { TVShowEntity, DatabaseError } from '../../core/types'
import { BaseRepository } from './BaseRepository'

export class TVShowRepository extends BaseRepository<TVShowEntity> {
  constructor(client: MongoClient) {
    super(client, 'FlatTVShows')
  }

  /**
   * Create optimal indexes for TV show queries
   */
  async createIndexes(): Promise<void> {
    try {
      await Promise.all([
        // Primary lookup indexes
        this.createIndexSafely({ title: 1 }, { unique: true }),
        this.createIndexSafely({ title: 1, serverId: 1 }),

        // originalTitle — used by findByOriginalTitle() before every show sync
        // and as the upsert filter key in BaseRepository.upsert()
        this.createIndexSafely({ originalTitle: 1 }),

        // Performance indexes
        this.createIndexSafely({ serverId: 1 }),
        this.createIndexSafely({ lastSynced: 1 }),
        
        // Asset indexes
        this.createIndexSafely({ posterURL: 1 }),
        this.createIndexSafely({ backdrop: 1 }),
        this.createIndexSafely({ logo: 1 }),
        
        // Metadata indexes
        this.createIndexSafely({ seasonCount: 1 }, { sparse: true }),
        this.createIndexSafely({ totalEpisodeCount: 1 }, { sparse: true }),
        this.createIndexSafely({ 'metadata.genre': 1 }),
        this.createIndexSafely({ 'metadata.year': 1 }),
        
        // Text search
        this.createIndexSafely({ 
          title: 'text', 
          'metadata.description': 'text' 
        })
      ])
    } catch (error) {
      console.error('Failed to create TV show indexes:', error)
    }
  }

  /**
   * Find shows missing specific assets
   */
  async findMissingAssets(assetType: 'poster' | 'backdrop' | 'logo'): Promise<TVShowEntity[]> {
    try {
      const fieldMap = {
        poster: 'posterURL',
        backdrop: 'backdrop',
        logo: 'logo'
      }

      const field = fieldMap[assetType]
      return await this.collection.find({
        [field]: { $exists: false }
      }).toArray()
    } catch (error) {
      throw new DatabaseError(`Failed to find TV shows missing ${assetType}: ${error}`)
    }
  }

  /**
   * Update show counts (seasons and episodes)
   */
  async updateCounts(title: string, seasonCount: number, totalEpisodeCount: number): Promise<void> {
    try {
      await this.update(title, {
        seasonCount,
        totalEpisodeCount
      })
    } catch (error) {
      throw new DatabaseError(`Failed to update counts for ${title}: ${error}`, title)
    }
  }

  /**
   * Update show assets
   */
  async updateAssets(title: string, assets: {
    posterURL?: string
    backdrop?: string
    logo?: string
    posterBlurhash?: string
    backdropBlurhash?: string
  }): Promise<void> {
    try {
      const updates: any = {}

      if (assets.posterURL !== undefined) updates.posterURL = assets.posterURL
      if (assets.backdrop !== undefined) updates.backdrop = assets.backdrop
      if (assets.logo !== undefined) updates.logo = assets.logo
      if (assets.posterBlurhash !== undefined) updates.posterBlurhash = assets.posterBlurhash
      if (assets.backdropBlurhash !== undefined) updates.backdropBlurhash = assets.backdropBlurhash

      await this.update(title, updates)
    } catch (error) {
      throw new DatabaseError(`Failed to update TV show assets: ${error}`, title)
    }
  }

  /**
   * Get TV show statistics
   */
  async getTVShowStats(): Promise<{
    total: number
    withPoster: number
    withBackdrop: number
    withLogo: number
    averageSeasonCount: number
    averageEpisodeCount: number
    byGenre: Record<string, number>
  }> {
    try {
      const [
        total,
        withPoster,
        withBackdrop,
        withLogo,
        seasonStats,
        episodeStats,
        genreStats
      ] = await Promise.all([
        this.collection.countDocuments(),
        this.collection.countDocuments({ posterURL: { $exists: true, $ne: undefined } }),
        this.collection.countDocuments({ backdrop: { $exists: true, $ne: undefined } }),
        this.collection.countDocuments({ logo: { $exists: true, $ne: undefined } }),
        this.collection.aggregate([
          { $match: { seasonCount: { $exists: true, $gt: 0 } } },
          { $group: { _id: null, average: { $avg: '$seasonCount' } } }
        ]).toArray(),
        this.collection.aggregate([
          { $match: { totalEpisodeCount: { $exists: true, $gt: 0 } } },
          { $group: { _id: null, average: { $avg: '$totalEpisodeCount' } } }
        ]).toArray(),
        this.collection.aggregate([
          { $unwind: { path: '$metadata.genre', preserveNullAndEmptyArrays: true } },
          { $group: { _id: '$metadata.genre', count: { $sum: 1 } } },
          { $sort: { count: -1 } }
        ]).toArray()
      ])

      const averageSeasonCount = seasonStats.length > 0 ? seasonStats[0].average : 0
      const averageEpisodeCount = episodeStats.length > 0 ? episodeStats[0].average : 0

      const byGenre: Record<string, number> = {}
      genreStats.forEach(({ _id, count }) => {
        byGenre[_id || 'unknown'] = count
      })

      return {
        total,
        withPoster,
        withBackdrop,
        withLogo,
        averageSeasonCount,
        averageEpisodeCount,
        byGenre
      }
    } catch (error) {
      throw new DatabaseError(`Failed to get TV show statistics: ${error}`)
    }
  }
}