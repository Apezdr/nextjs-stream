/**
 * Season-specific repository implementation
 * Handles all database operations for season entities
 */

import { MongoClient, AnyBulkWriteOperation } from 'mongodb'
import { SeasonEntity, DatabaseError } from '../../core/types'
import { BaseRepository } from './BaseRepository'

export class SeasonRepository extends BaseRepository<SeasonEntity> {
  constructor(client: MongoClient) {
    super(client, 'FlatSeasons')
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

        // showId-based indexes — bulkUpsertShow filters on { showId, seasonNumber }
        // when showId is present. Without this index every season upsert scans the
        // collection, causing write lock contention (Slow query in production).
        this.createIndexSafely({ showId: 1, seasonNumber: 1 }),
        this.createIndexSafely({ showId: 1 }),

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
      const operations = seasons.map(season => {
        // Strip _id so MongoDB preserves existing _id on matched docs
        // and auto-generates for new upserted docs
        const { _id, ...seasonWithoutId } = season as any

        // Use showId + seasonNumber as filter when showId is available.
        // This matches the legacy show_season_index {showId, seasonNumber}
        // and avoids E11000 when showTitle changed between syncs.
        const filter = (season as any).showId
          ? { showId: (season as any).showId, seasonNumber: season.seasonNumber }
          : { showTitle: season.showTitle, seasonNumber: season.seasonNumber }

        return {
          replaceOne: {
            filter,
            replacement: {
              ...seasonWithoutId,
              lastSynced: now,
              updatedAt: now
            },
            upsert: true
          }
        }
      })

      await this.collection.bulkWrite(operations, { ordered: false })
    } catch (error) {
      throw new DatabaseError(`Failed to bulk upsert seasons: ${error}`)
    }
  }

  /**
   * Write-optimal bulk upsert for a show's seasons.
   *
   * Each op is classified as:
   *   - New (existing=null)      → $setOnInsert upsert (race-safe)
   *   - Unchanged (diff empty)   → skipped entirely (zero write-ticket cost)
   *   - Changed (diff non-empty) → $set of changed fields only
   */
  async smartBulkUpsert(ops: Array<{
    filter: Record<string, any>
    existing: SeasonEntity | null
    merged: SeasonEntity
  }>): Promise<void> {
    if (ops.length === 0) return
    const now = new Date()
    const operations: AnyBulkWriteOperation<SeasonEntity>[] = []

    for (const { filter, existing, merged } of ops) {
      const { _id, ...mergedNoId } = merged as any

      if (!existing) {
        operations.push({
          updateOne: {
            filter,
            update: { $setOnInsert: { ...mergedNoId, lastSynced: now, updatedAt: now } },
            upsert: true,
          },
        })
        continue
      }

      const diff = BaseRepository.computeDiff(existing, merged)
      if (Object.keys(diff).length === 0) continue  // unchanged — skip write

      operations.push({
        updateOne: {
          filter,
          update: { $set: { ...diff, lastSynced: now, updatedAt: now } },
          upsert: false,
        },
      })
    }

    if (operations.length === 0) return  // all seasons unchanged
    try {
      await this.collection.bulkWrite(operations, { ordered: false })
    } catch (error) {
      throw new DatabaseError(`Failed to smart bulk upsert seasons: ${error}`)
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
   * Update season blurhash fields.
   * Uses the composite key {showTitle, seasonNumber} — the only unique identifier for a season.
   */
  async updateBlurhash(
    showTitle: string,
    seasonNumber: number,
    data: { posterBlurhash?: string; posterBlurhashSource?: string }
  ): Promise<void> {
    try {
      const updates: Record<string, unknown> = { lastSynced: new Date(), updatedAt: new Date() }
      if (data.posterBlurhash !== undefined) updates.posterBlurhash = data.posterBlurhash
      if (data.posterBlurhashSource !== undefined) updates.posterBlurhashSource = data.posterBlurhashSource

      await this.collection.updateOne(
        { showTitle, seasonNumber },
        { $set: updates }
      )
    } catch (error) {
      throw new DatabaseError(
        `Failed to update blurhash for ${showTitle} S${seasonNumber}: ${error}`,
        showTitle
      )
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