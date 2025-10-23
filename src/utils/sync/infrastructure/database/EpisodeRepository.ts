/**
 * Episode-specific repository implementation
 * Handles all database operations for episode entities
 * Optimized for high-volume episode operations
 */

import { MongoClient } from 'mongodb'
import { EpisodeEntity, DatabaseError } from '../../core/types'
import { BaseRepository } from './BaseRepository'

export class EpisodeRepository extends BaseRepository<EpisodeEntity> {
  constructor(client: MongoClient) {
    super(client, 'Episodes')
  }

  /**
   * Create optimal indexes for episode queries
   * Episodes have the highest volume, so indexing is critical
   */
  async createIndexes(): Promise<void> {
    try {
      await Promise.all([
        // Primary lookup indexes - most critical for performance
        this.createIndexSafely({ title: 1 }),
        this.createIndexSafely({ showTitle: 1, seasonNumber: 1, episodeNumber: 1 }, { unique: true }),
        this.createIndexSafely({ showTitle: 1, seasonNumber: 1 }),
        this.createIndexSafely({ showTitle: 1 }),
        
        // Server and sync indexes
        this.createIndexSafely({ serverId: 1 }),
        this.createIndexSafely({ showTitle: 1, serverId: 1 }),
        this.createIndexSafely({ lastSynced: 1 }),
        
        // Asset availability indexes
        this.createIndexSafely({ videoURL: 1 }),
        this.createIndexSafely({ thumbnailURL: 1 }),
        
        // Performance indexes for aggregations
        this.createIndexSafely({ showTitle: 1, lastSynced: 1 }),
        this.createIndexSafely({ seasonNumber: 1, episodeNumber: 1 }),
        
        // Sparse indexes for optional fields
        this.createIndexSafely({ 'videoInfo.duration': 1 }, { sparse: true }),
        this.createIndexSafely({ 'captions.language': 1 }, { sparse: true })
      ])
    } catch (error) {
      console.error('Failed to create episode indexes:', error)
    }
  }

  /**
   * Find episodes by show and season (most common query)
   */
  async findByShowAndSeason(showTitle: string, seasonNumber: number): Promise<EpisodeEntity[]> {
    try {
      return await this.collection.find({
        showTitle,
        seasonNumber
      }).sort({ episodeNumber: 1 }).toArray()
    } catch (error) {
      throw new DatabaseError(`Failed to find episodes for ${showTitle} S${seasonNumber}: ${error}`)
    }
  }

  /**
   * Find specific episode
   */
  async findEpisode(showTitle: string, seasonNumber: number, episodeNumber: number): Promise<EpisodeEntity | null> {
    try {
      return await this.collection.findOne({
        showTitle,
        seasonNumber,
        episodeNumber
      })
    } catch (error) {
      throw new DatabaseError(`Failed to find episode ${showTitle} S${seasonNumber}E${episodeNumber}: ${error}`)
    }
  }

  /**
   * Bulk upsert episodes for a season (optimized for sync performance)
   */
  async bulkUpsertSeason(episodes: EpisodeEntity[]): Promise<void> {
    if (episodes.length === 0) return

    try {
      const now = new Date()
      const operations = episodes.map(episode => ({
        replaceOne: {
          filter: {
            showTitle: episode.showTitle,
            seasonNumber: episode.seasonNumber,
            episodeNumber: episode.episodeNumber
          },
          replacement: {
            ...episode,
            lastSynced: now,
            updatedAt: now
          },
          upsert: true
        }
      }))

      await this.collection.bulkWrite(operations, { ordered: false })
    } catch (error) {
      throw new DatabaseError(`Failed to bulk upsert episodes: ${error}`)
    }
  }

  /**
   * Get episode count by show and season
   */
  async getEpisodeCount(showTitle: string, seasonNumber?: number): Promise<number> {
    try {
      const filter: any = { showTitle }
      if (seasonNumber !== undefined) {
        filter.seasonNumber = seasonNumber
      }

      return await this.collection.countDocuments(filter)
    } catch (error) {
      throw new DatabaseError(`Failed to get episode count for ${showTitle}: ${error}`)
    }
  }

  /**
   * Find episodes missing video URLs (for sync prioritization)
   */
  async findMissingVideo(showTitle?: string): Promise<EpisodeEntity[]> {
    try {
      const filter: any = {
        $or: [
          { videoURL: { $exists: false } },
          { videoURL: null },
          { videoURL: '' }
        ]
      }

      if (showTitle) {
        filter.showTitle = showTitle
      }

      return await this.collection.find(filter).toArray()
    } catch (error) {
      throw new DatabaseError(`Failed to find episodes missing video: ${error}`)
    }
  }

  /**
   * Find episodes missing thumbnails
   */
  async findMissingThumbnails(showTitle?: string): Promise<EpisodeEntity[]> {
    try {
      const filter: any = {
        $or: [
          { thumbnailURL: { $exists: false } },
          { thumbnailURL: null },
          { thumbnailURL: '' }
        ]
      }

      if (showTitle) {
        filter.showTitle = showTitle
      }

      return await this.collection.find(filter).toArray()
    } catch (error) {
      throw new DatabaseError(`Failed to find episodes missing thumbnails: ${error}`)
    }
  }

  /**
   * Get episodes modified since date (for incremental sync)
   */
  async findModifiedSinceByShow(showTitle: string, since: Date): Promise<EpisodeEntity[]> {
    try {
      return await this.collection.find({
        showTitle,
        lastSynced: { $gte: since }
      }).toArray()
    } catch (error) {
      throw new DatabaseError(`Failed to find modified episodes for ${showTitle}: ${error}`)
    }
  }

  /**
   * Delete episodes for a show/season (cleanup operations)
   */
  async deleteByShowAndSeason(showTitle: string, seasonNumber?: number): Promise<number> {
    try {
      const filter: any = { showTitle }
      if (seasonNumber !== undefined) {
        filter.seasonNumber = seasonNumber
      }

      const result = await this.collection.deleteMany(filter)
      return result.deletedCount || 0
    } catch (error) {
      throw new DatabaseError(`Failed to delete episodes for ${showTitle}: ${error}`)
    }
  }

  /**
   * Get comprehensive episode statistics (for performance monitoring)
   */
  async getEpisodeStats(): Promise<{
    total: number
    withVideo: number
    withThumbnails: number
    withCaptions: number
    byShow: Array<{ showTitle: string; count: number }>
    byServer: Record<string, number>
    averageFileSize: number
  }> {
    try {
      const [
        total,
        withVideo,
        withThumbnails,
        withCaptions,
        byShowStats,
        byServerStats,
        fileSizeStats
      ] = await Promise.all([
        this.collection.countDocuments(),
        this.collection.countDocuments({ videoURL: { $exists: true, $ne: undefined } }),
        this.collection.countDocuments({ thumbnailURL: { $exists: true, $ne: undefined } }),
        this.collection.countDocuments({ captions: { $exists: true, $not: { $size: 0 } } }),
        this.collection.aggregate([
          { $group: { _id: '$showTitle', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 20 }
        ]).toArray(),
        this.collection.aggregate([
          { $group: { _id: '$serverId', count: { $sum: 1 } } }
        ]).toArray(),
        this.collection.aggregate([
          { $match: { 'videoInfo.fileSize': { $exists: true, $gt: 0 } } },
          { $group: { _id: null, averageSize: { $avg: '$videoInfo.fileSize' } } }
        ]).toArray()
      ])

      const byShow = byShowStats.map(({ _id, count }) => ({
        showTitle: _id,
        count
      }))

      const byServer: Record<string, number> = {}
      byServerStats.forEach(({ _id, count }) => {
        byServer[_id] = count
      })

      const averageFileSize = fileSizeStats.length > 0 ? fileSizeStats[0].averageSize : 0

      return {
        total,
        withVideo,
        withThumbnails,
        withCaptions,
        byShow,
        byServer,
        averageFileSize
      }
    } catch (error) {
      throw new DatabaseError(`Failed to get episode statistics: ${error}`)
    }
  }

  /**
   * Find episodes that need sync (based on various criteria)
   */
  async findNeedingSync(criteria: {
    missingVideo?: boolean
    missingThumbnails?: boolean
    missingCaptions?: boolean
    olderThan?: Date
    showTitle?: string
    limit?: number
  }): Promise<EpisodeEntity[]> {
    try {
      const conditions: Record<string, any>[] = []

      if (criteria.missingVideo) {
        conditions.push({
          $or: [
            { videoURL: { $exists: false } },
            { videoURL: null },
            { videoURL: '' }
          ]
        })
      }

      if (criteria.missingThumbnails) {
        conditions.push({
          $or: [
            { thumbnailURL: { $exists: false } },
            { thumbnailURL: null },
            { thumbnailURL: '' }
          ]
        })
      }

      if (criteria.missingCaptions) {
        conditions.push({
          $or: [
            { captions: { $exists: false } },
            { captions: { $size: 0 } }
          ]
        })
      }

      if (criteria.olderThan) {
        conditions.push({
          $or: [
            { lastSynced: { $lt: criteria.olderThan } },
            { lastSynced: { $exists: false } }
          ]
        })
      }

      const filter: any = {}

      if (conditions.length > 0) {
        filter.$or = conditions
      }

      if (criteria.showTitle) {
        filter.showTitle = criteria.showTitle
      }

      let query = this.collection.find(filter)

      if (criteria.limit) {
        query = query.limit(criteria.limit)
      }

      return await query.toArray()
    } catch (error) {
      throw new DatabaseError(`Failed to find episodes needing sync: ${error}`)
    }
  }

  /**
   * Validate episode before save
   */
  protected validateEntity(entity: EpisodeEntity): void {
    super.validateEntity(entity)

    if (typeof entity.episodeNumber !== 'number' || entity.episodeNumber <= 0) {
      throw new DatabaseError('Episode number must be a positive number', entity.title)
    }

    if (typeof entity.seasonNumber !== 'number' || entity.seasonNumber < 0) {
      throw new DatabaseError('Season number must be non-negative', entity.title)
    }

    if (!entity.showTitle || entity.showTitle.trim().length === 0) {
      throw new DatabaseError('Show title is required for episodes', entity.title)
    }
  }
}