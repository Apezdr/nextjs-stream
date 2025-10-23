/**
 * Season-specific repository implementation
 * Handles all database operations for season entities
 */

import { MongoClient } from 'mongodb'
import { SeasonEntity, DatabaseError } from '../../core/types'
import { BaseRepository } from './BaseRepository'

export class SeasonRepository extends BaseRepository<SeasonEntity> {
  constructor(client: MongoClient) {
    super(client, 'Seasons')
  }

  /**
   * Create optimal indexes for season queries
   */
  async createIndexes(): Promise<void> {
    try {
      await Promise.all([
        // Primary lookup indexes
        this.createIndexSafely({ showTitle: 1, seasonNumber: 1 }, { unique: true }),
        this.createIndexSafely({ showTitle: 1 }),
        this.createIndexSafely({ title: 1 }),
        
        // Performance indexes
        this.createIndexSafely({ serverId: 1 }),
        this.createIndexSafely({ lastSynced: 1 }),
        this.createIndexSafely({ showTitle: 1, lastSynced: 1 }),
        
        // Asset indexes
        this.createIndexSafely({ posterURL: 1 }),
        
        // Metadata indexes
        this.createIndexSafely({ episodeCount: 1 }, { sparse: true })
      ])
    } catch (error) {
      console.error('Failed to create season indexes:', error)
    }
  }

  /**
   * Find seasons by show title
   */
  async findByShow(showTitle: string): Promise<SeasonEntity[]> {
    try {
      return await this.collection.find({ showTitle })
        .sort({ seasonNumber: 1 })
        .toArray()
    } catch (error) {
      throw new DatabaseError(`Failed to find seasons for ${showTitle}: ${error}`)
    }
  }

  /**
   * Find specific season
   */
  async findSeason(showTitle: string, seasonNumber: number): Promise<SeasonEntity | null> {
    try {
      return await this.collection.findOne({
        showTitle,
        seasonNumber
      })
    } catch (error) {
      throw new DatabaseError(`Failed to find season ${showTitle} S${seasonNumber}: ${error}`)
    }
  }

  /**
   * Bulk upsert seasons for a show
   */
  async bulkUpsertShow(seasons: SeasonEntity[]): Promise<void> {
    if (seasons.length === 0) return

    try {
      const now = new Date()
      const operations = seasons.map(season => ({
        replaceOne: {
          filter: {
            showTitle: season.showTitle,
            seasonNumber: season.seasonNumber
          },
          replacement: {
            ...season,
            lastSynced: now,
            updatedAt: now
          },
          upsert: true
        }
      }))

      await this.collection.bulkWrite(operations, { ordered: false })
    } catch (error) {
      throw new DatabaseError(`Failed to bulk upsert seasons: ${error}`)
    }
  }

  /**
   * Get season count for a show
   */
  async getSeasonCount(showTitle: string): Promise<number> {
    try {
      return await this.collection.countDocuments({ showTitle })
    } catch (error) {
      throw new DatabaseError(`Failed to get season count for ${showTitle}: ${error}`)
    }
  }

  /**
   * Find seasons missing posters
   */
  async findMissingPosters(showTitle?: string): Promise<SeasonEntity[]> {
    try {
      const filter: any = {
        $or: [
          { posterURL: { $exists: false } },
          { posterURL: null },
          { posterURL: '' }
        ]
      }

      if (showTitle) {
        filter.showTitle = showTitle
      }

      return await this.collection.find(filter).toArray()
    } catch (error) {
      throw new DatabaseError(`Failed to find seasons missing posters: ${error}`)
    }
  }

  /**
   * Update season episode count
   */
  async updateEpisodeCount(showTitle: string, seasonNumber: number, episodeCount: number): Promise<void> {
    try {
      await this.collection.updateOne(
        { showTitle, seasonNumber },
        { 
          $set: { 
            episodeCount,
            lastSynced: new Date(),
            updatedAt: new Date()
          }
        }
      )
    } catch (error) {
      throw new DatabaseError(`Failed to update episode count for ${showTitle} S${seasonNumber}: ${error}`)
    }
  }

  /**
   * Delete seasons for a show
   */
  async deleteByShow(showTitle: string): Promise<number> {
    try {
      const result = await this.collection.deleteMany({ showTitle })
      return result.deletedCount || 0
    } catch (error) {
      throw new DatabaseError(`Failed to delete seasons for ${showTitle}: ${error}`)
    }
  }

  /**
   * Get season statistics
   */
  async getSeasonStats(): Promise<{
    total: number
    withPosters: number
    averageEpisodeCount: number
    byShow: Array<{ showTitle: string; seasonCount: number }>
  }> {
    try {
      const [
        total,
        withPosters,
        episodeCountStats,
        byShowStats
      ] = await Promise.all([
        this.collection.countDocuments(),
        this.collection.countDocuments({ posterURL: { $exists: true, $ne: undefined } }),
        this.collection.aggregate([
          { $match: { episodeCount: { $exists: true, $gt: 0 } } },
          { $group: { _id: null, average: { $avg: '$episodeCount' } } }
        ]).toArray(),
        this.collection.aggregate([
          { $group: { _id: '$showTitle', seasonCount: { $sum: 1 } } },
          { $sort: { seasonCount: -1 } },
          { $limit: 20 }
        ]).toArray()
      ])

      const averageEpisodeCount = episodeCountStats.length > 0 ? episodeCountStats[0].average : 0

      const byShow = byShowStats.map(({ _id, seasonCount }) => ({
        showTitle: _id,
        seasonCount
      }))

      return {
        total,
        withPosters,
        averageEpisodeCount,
        byShow
      }
    } catch (error) {
      throw new DatabaseError(`Failed to get season statistics: ${error}`)
    }
  }

  /**
   * Validate season before save
   */
  protected validateEntity(entity: SeasonEntity): void {
    super.validateEntity(entity)

    if (typeof entity.seasonNumber !== 'number' || entity.seasonNumber < 0) {
      throw new DatabaseError('Season number must be non-negative', entity.title)
    }

    if (!entity.showTitle || entity.showTitle.trim().length === 0) {
      throw new DatabaseError('Show title is required for seasons', entity.title)
    }
  }
}