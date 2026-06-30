/**
 * Episode-specific repository implementation
 * Handles all database operations for episode entities
 * Optimized for high-volume episode operations
 */

import { MongoClient, AnyBulkWriteOperation } from 'mongodb'
import { EpisodeEntity, DatabaseError } from '../../core/types'
import { BaseRepository } from './BaseRepository'
import { ResourceManager } from '../../core/ResourceManager'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — sibling JS module with no .d.ts; it exports plain functions
import { getCurrentSyncRunId } from '../../../flatSync/syncContext'

export class EpisodeRepository extends BaseRepository<EpisodeEntity> {
  constructor(client: MongoClient) {
    super(client, 'FlatEpisodes')
  }

  /**
   * Create optimal indexes for episode queries
   * Episodes have the highest volume, so indexing is critical
   */
  async createIndexes(): Promise<boolean> {
    try {
      await Promise.all([
        // Primary lookup indexes - most critical for performance
        this.createIndexSafely({ title: 1 }),
        this.createIndexSafely({ showTitle: 1, seasonNumber: 1, episodeNumber: 1 }, { unique: true }),
        this.createIndexSafely({ showTitle: 1, seasonNumber: 1 }),
        this.createIndexSafely({ showTitle: 1 }),

        // showId-based indexes — critical for bulkUpsertSeason which filters on
        // { showId, seasonNumber, episodeNumber } when showId is present.
        // Without this, every upsert in the hot sync path does a collection scan,
        // causing write lock contention and the Slow query log entries in production.
        //
        // UNIQUE on the showId write-filter tuple so an accidental collision throws
        // E11000 instead of silently duplicating. partialFilterExpression on showId
        // existence: episodes written before their parent show resolves carry no
        // showId, and a plain unique index would collapse every such doc onto one
        // {null, season, ep} key. Built clean on the wiped (dropped) collections;
        // createIndexSafely swallows IndexOptionsConflict if a non-unique same-key
        // index still exists (i.e. a non-drop wipe leaves the upgrade a no-op).
        this.createIndexSafely(
          { showId: 1, seasonNumber: 1, episodeNumber: 1 },
          { unique: true, partialFilterExpression: { showId: { $exists: true } } }
        ),
        this.createIndexSafely({ showId: 1, seasonNumber: 1 }),
        this.createIndexSafely({ showId: 1 }),

        // seasonId lookup — the read paths (season episode listings, next-episode
        // navigation, recommendations, episode counts) filter episodes by
        // { seasonId } alone, e.g. find({ seasonId: season._id }) and
        // findOne({ seasonId }, { sort: { episodeNumber: 1 } }). None of the
        // indexes above are prefixed by seasonId, so every such query COLLSCANs
        // the whole collection (confirmed in production: ~7.2k docs scanned per
        // query, 1s+ durations). The compound key covers both the seasonId match
        // and the episodeNumber sort. Mirrors season_episode_index in
        // flatSync/initializeDatabase.js, which the new-arch sync path never runs;
        // name must match it to avoid IndexOptionsConflict.
        this.createIndexSafely({ seasonId: 1, episodeNumber: 1 }, { name: 'season_episode_index' }),

        // Server and sync indexes
        this.createIndexSafely({ serverId: 1 }),
        this.createIndexSafely({ showTitle: 1, serverId: 1 }),
        this.createIndexSafely({ lastSynced: 1 }),

        // Asset availability indexes
        this.createIndexSafely({ videoURL: 1 }),
        this.createIndexSafely({ thumbnail: 1 }),

        // Video-lookup indexes — the watch-history hydration path queries
        // find({ $or: [{ normalizedVideoId: {$in} }, { videoURL: {$in} }] }).
        // An $or only avoids a COLLSCAN when EVERY branch is indexed: videoURL
        // is covered above, but normalizedVideoId was not, so the whole $or fell
        // back to a full scan — the single worst offender in the SigNoz slow-query
        // log (175 of 200 entries over 7d, ~7.2k docs scanned, 0 keys, up to
        // 541ms each). Adding normalizedVideoId lets MongoDB build an index-OR
        // plan across both branches. Name matches normalized_id_index in
        // flatSync/initializeDatabase.js to avoid IndexOptionsConflict.
        this.createIndexSafely({ normalizedVideoId: 1 }, { name: 'normalized_id_index' }),

        // Covered-query index for validateWatchHistoryAgainstDatabase(), which
        // projects only { videoURL, normalizedVideoId } — an index-only scan with
        // no document fetch. Mirrors videoURL_normalizedId_covered_index in
        // flatSync/initializeDatabase.js (never run by the new-arch sync path).
        this.createIndexSafely(
          { videoURL: 1, normalizedVideoId: 1 },
          { name: 'videoURL_normalizedId_covered_index' }
        ),

        // Performance indexes for aggregations
        this.createIndexSafely({ showTitle: 1, lastSynced: 1 }),
        this.createIndexSafely({ seasonNumber: 1, episodeNumber: 1 }),

        // "Recently Added" landing row sorts episodes by mediaLastModified and
        // groups by showId. Without this the aggregation COLLSCANs every episode
        // and does a blocking in-memory sort (confirmed via explain: all docs
        // scanned, totalKeysExamined: 0). The compound key is covered —
        // mediaLastModified satisfies the sort, showId satisfies the group — so it
        // walks only the most recent entries. Mirrors mediaLastModified_index in
        // flatSync/initializeDatabase.js, which the new-arch sync path never runs.
        this.createIndexSafely({ mediaLastModified: -1, showId: 1 }),

        // Sparse indexes for optional fields
        this.createIndexSafely({ 'videoInfo.duration': 1 }, { sparse: true }),
        this.createIndexSafely({ 'captionURLs': 1 }, { sparse: true }),

        // Sync-run marker — post-sync cleanup deletes by { syncRunId: { $ne } }.
        // Name must match flatSync/initializeDatabase.js to avoid IndexOptionsConflict.
        this.createIndexSafely({ syncRunId: 1 }, { name: 'sync_run_id_index' })
      ])
      return true
    } catch (error) {
      console.error('Failed to create episode indexes:', error)
      return false
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
      // Stamp every write with the active syncRunId so post-sync cleanup
      // (deleteMany({ syncRunId: { $ne: currentRunId } })) doesn't treat
      // freshly-inserted or just-replaced docs as orphans.
      const syncRunId = getCurrentSyncRunId()
      const operations = episodes.map(episode => {
        // Strip _id so MongoDB preserves existing _id on matched docs
        // and auto-generates for new upserted docs
        const { _id, ...episodeWithoutId } = episode as any

        // Use showId + seasonNumber + episodeNumber when showId is available.
        // This avoids E11000 collisions with the legacy show_season_episode_index
        // {showId, seasonId, episodeNumber} when showTitle has changed between syncs.
        const filter = (episode as any).showId
          ? { showId: (episode as any).showId, seasonNumber: episode.seasonNumber, episodeNumber: episode.episodeNumber }
          : { showTitle: episode.showTitle, seasonNumber: episode.seasonNumber, episodeNumber: episode.episodeNumber }

        return {
          replaceOne: {
            filter,
            replacement: {
              ...episodeWithoutId,
              lastSynced: now,
              updatedAt: now,
              ...(syncRunId ? { syncRunId } : {})
            },
            upsert: true
          }
        }
      })

      const limit = ResourceManager.getInstance().dbWriteLimitFor(this.collectionName)
      await limit(() => this.collection.bulkWrite(operations, { ordered: false }))
    } catch (error) {
      throw new DatabaseError(`Failed to bulk upsert episodes: ${error}`)
    }
  }

  /**
   * Write-optimal bulk upsert for a season's episodes.
   *
   * Each op is classified as:
   *   - New (existing=null)      → $setOnInsert upsert (race-safe)
   *   - Unchanged (diff empty)   → skipped entirely (zero write-ticket cost)
   *   - Changed (diff non-empty) → $set of changed fields only
   *
   * Replaces bulkUpsertSeason for the sync path. bulkUpsertSeason is kept
   * for any callers that don't have existing docs available.
   */
  async smartBulkUpsert(ops: Array<{
    filter: Record<string, any>
    existing: EpisodeEntity | null
    merged: EpisodeEntity
    /**
     * Field names to $unset on an existing doc (field-absence cleanup). The
     * caller (EpisodeSyncService) has already gated these on the authoritative
     * pass + lock checks. Ignored for new docs (nothing to clear). When present
     * the write fires even if the $set diff is empty — and still carries the
     * syncRunId marker so post-sync cleanup doesn't reap the doc.
     */
    unset?: string[]
  }>): Promise<void> {
    if (ops.length === 0) return
    const now = new Date()
    // Required for post-sync cleanup: every write must carry the active marker
    // or `deleteMany({ syncRunId: { $ne: currentRunId } })` will delete the doc.
    // New-doc $setOnInsert is the critical case — pre-tag couldn't stamp a doc
    // that didn't exist yet, so the marker has to come in on the insert itself.
    const syncRunId = getCurrentSyncRunId()
    const operations: AnyBulkWriteOperation<EpisodeEntity>[] = []

    for (const { filter, existing, merged, unset } of ops) {
      const { _id, ...mergedNoId } = merged as any

      if (!existing) {
        operations.push({
          updateOne: {
            filter,
            update: {
              $setOnInsert: {
                ...mergedNoId,
                lastSynced: now,
                updatedAt: now,
                ...(syncRunId ? { syncRunId } : {})
              }
            },
            upsert: true,
          },
        })
        continue
      }

      const diff = BaseRepository.computeDiff(existing, merged)
      // Only $unset fields that actually have a value on the existing doc — avoids
      // a pointless write when the caller's candidate list is already cleared.
      const unsetFields = (unset || []).filter(f => (existing as any)[f] !== undefined)
      if (Object.keys(diff).length === 0 && unsetFields.length === 0) continue  // unchanged — skip write

      const update: Record<string, any> = {
        $set: {
          ...diff,
          lastSynced: now,
          updatedAt: now,
          ...(syncRunId ? { syncRunId } : {})
        }
      }
      if (unsetFields.length > 0) {
        update.$unset = Object.fromEntries(unsetFields.map(f => [f, '']))
      }

      operations.push({
        updateOne: { filter, update, upsert: false },
      })
    }

    if (operations.length === 0) return  // all episodes unchanged
    try {
      const limit = ResourceManager.getInstance().dbWriteLimitFor(this.collectionName)
      await limit(() => this.collection.bulkWrite(operations, { ordered: false }))
    } catch (error) {
      throw new DatabaseError(`Failed to smart bulk upsert episodes: ${error}`)
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
          { thumbnail: { $exists: false } },
          { thumbnail: null },
          { thumbnail: '' }
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
        this.collection.countDocuments({ thumbnail: { $exists: true, $ne: undefined } }),
        this.collection.countDocuments({ captionURLs: { $exists: true, $ne: null } } as any),
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
            { thumbnail: { $exists: false } },
            { thumbnail: null },
            { thumbnail: '' }
          ]
        })
      }

      if (criteria.missingCaptions) {
        conditions.push({
          $or: [
            { captionURLs: { $exists: false } },
            { captionURLs: null }
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