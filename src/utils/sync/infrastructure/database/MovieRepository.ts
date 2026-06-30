/**
 * Movie-specific repository implementation
 * Handles all database operations for movie entities
 */

import { MongoClient } from 'mongodb'
import { MovieEntity, BackdropFocal, DatabaseError } from '../../core/types'
import { BaseRepository } from './BaseRepository'

export class MovieRepository extends BaseRepository<MovieEntity> {
  constructor(client: MongoClient) {
    super(client, 'FlatMovies')  // Use current FlatMovies collection 
  }

  /**
   * Create optimal indexes for movie queries
   */
  async createIndexes(): Promise<boolean> {
    try {
      await Promise.all([
        // Primary lookup indexes — names must match flatSync/initializeDatabase.js
        // to avoid "Index already exists with a different name" conflicts
        this.createIndexSafely({ title: 1 }, { unique: true, name: 'title_index' }),
        this.createIndexSafely({ originalTitle: 1 }, { unique: true, name: 'originalTitle_index' }),
        this.createIndexSafely({ title: 1, serverId: 1 }),
        
        // Performance indexes
        this.createIndexSafely({ serverId: 1 }),
        this.createIndexSafely({ lastSynced: 1 }),

        // "Recently Added" landing row sorts movies by mediaLastModified desc.
        // Without this the sort COLLSCANs FlatMovies (same gap as FlatEpisodes);
        // the index lets it walk the most recent entries directly.
        this.createIndexSafely({ mediaLastModified: -1 }),
        
        // Asset availability indexes
        this.createIndexSafely({ videoURL: 1 }),
        this.createIndexSafely({ posterURL: 1 }),
        this.createIndexSafely({ backdrop: 1 }),
        this.createIndexSafely({ logo: 1 }),

        // Video-lookup indexes — the watch-history hydration path queries
        // find({ $or: [{ metadata.trailer_url }, { normalizedVideoId: {$in} }, { videoURL: {$in} }] }).
        // An $or only avoids a COLLSCAN when EVERY branch is indexed: videoURL is
        // covered above, but normalizedVideoId and metadata.trailer_url were not,
        // so the whole $or COLLSCANned FlatMovies (SigNoz slow-query log, 7d).
        // Names match normalized_id_index / trailer_url_index in
        // flatSync/initializeDatabase.js to avoid IndexOptionsConflict.
        this.createIndexSafely({ normalizedVideoId: 1 }, { name: 'normalized_id_index' }),
        this.createIndexSafely({ 'metadata.trailer_url': 1 }, { name: 'trailer_url_index' }),

        // Covered-query index for validateWatchHistoryAgainstDatabase() — projects
        // only { videoURL, normalizedVideoId } for an index-only scan. Mirrors
        // videoURL_normalizedId_covered_index in flatSync/initializeDatabase.js.
        this.createIndexSafely(
          { videoURL: 1, normalizedVideoId: 1 },
          { name: 'videoURL_normalizedId_covered_index' }
        ),
        
        // Metadata indexes for search
        this.createIndexSafely({ 'metadata.genre': 1 }),
        this.createIndexSafely({ 'metadata.year': 1 }),
        this.createIndexSafely({ 'metadata.rating': 1 }),
        
        // Text search index
        this.createIndexSafely({
          title: 'text',
          'metadata.description': 'text'
        }),

        // Sync-run marker — post-sync cleanup deletes by { syncRunId: { $ne } }.
        // Name must match flatSync/initializeDatabase.js to avoid IndexOptionsConflict.
        this.createIndexSafely({ syncRunId: 1 }, { name: 'sync_run_id_index' })
      ])
      return true
    } catch (error) {
      console.error('Failed to create movie indexes:', error)
      // Don't throw here - missing indexes won't break functionality; returning
      // false lets the adapter re-attempt on the next sync.
      return false
    }
  }

  /**
   * Get all movies with minimal fields for cleanup
   */
  async getAllMoviesForCleanup(): Promise<{ originalTitle: string; videoURL?: string }[]> {
    try {
      return await this.collection
        .find({}, { projection: { originalTitle: 1, videoURL: 1 } })
        .toArray() as unknown as { originalTitle: string; videoURL?: string }[]
    } catch (error) {
      throw new DatabaseError(`Failed to get movies for cleanup: ${error}`)
    }
  }

  /**
   * Delete movies by original titles
   */
  async deleteByOriginalTitles(originalTitles: string[]): Promise<number> {
    if (originalTitles.length === 0) return 0

    try {
      const result = await this.collection.deleteMany({
        originalTitle: { $in: originalTitles }
      })
      return result.deletedCount
    } catch (error) {
      throw new DatabaseError(`Failed to delete movies by original titles: ${error}`)
    }
  }

  /**
   * Find movies with video URLs available
   */
  async findWithVideo(): Promise<MovieEntity[]> {
    try {
      const results = await this.collection.find({
        videoURL: { $exists: true, $ne: undefined }
      }).toArray()
      return results as MovieEntity[]
    } catch (error) {
      throw new DatabaseError(`Failed to find movies with video: ${error}`)
    }
  }

  /**
   * Find movies missing specific assets
   */
  async findMissingAssets(assetType: 'poster' | 'backdrop' | 'logo'): Promise<MovieEntity[]> {
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
      throw new DatabaseError(`Failed to find movies missing ${assetType}: ${error}`)
    }
  }

  /**
   * Find movies by quality criteria
   */
  async findByQuality(criteria: {
    format?: string
    bitDepth?: number
    hdrFormat?: string
    enhancedViewing?: boolean
  }): Promise<MovieEntity[]> {
    try {
      const filter: any = {}

      if (criteria.format) {
        filter['videoInfo.mediaQuality.format'] = criteria.format
      }
      if (criteria.bitDepth) {
        filter['videoInfo.mediaQuality.bitDepth'] = criteria.bitDepth
      }
      if (criteria.hdrFormat) {
        filter['videoInfo.mediaQuality.hdrFormat'] = criteria.hdrFormat
      }
      if (criteria.enhancedViewing !== undefined) {
        filter['videoInfo.mediaQuality.enhancedViewing'] = criteria.enhancedViewing
      }

      return await this.collection.find(filter).toArray()
    } catch (error) {
      throw new DatabaseError(`Failed to find movies by quality: ${error}`)
    }
  }

  /**
   * Find movies with captions in specific languages
   */
  async findWithCaptions(languages?: string[]): Promise<MovieEntity[]> {
    try {
      const filter: any = {
        captionURLs: { $exists: true, $ne: {} }
      }

      if (languages && languages.length > 0) {
        // captionURLs is an object where keys are language names
        const languageFilters = languages.map(lang => ({
          [`captionURLs.${lang}`]: { $exists: true }
        }));
        filter['$or'] = languageFilters;
      }

      return await this.collection.find(filter).toArray()
    } catch (error) {
      throw new DatabaseError(`Failed to find movies with captions: ${error}`)
    }
  }

  /**
   * Find movies with chapters
   */
  async findWithChapters(): Promise<MovieEntity[]> {
    try {
      return await this.collection.find({
        chapterURL: { $exists: true, $ne: "" }
      }).toArray()
    } catch (error) {
      throw new DatabaseError(`Failed to find movies with chapters: ${error}`)
    }
  }

  /**
   * Update movie assets (poster, backdrop, logo)
   */
  async updateAssets(title: string, assets: {
    posterURL?: string
    backdrop?: string
    logo?: string
    posterBlurhash?: string
    backdropBlurhash?: string
    posterBlurhashSource?: string
    backdropBlurhashSource?: string
    backdropFocal?: BackdropFocal
    backdropFocalSource?: string
    backdropFocalSuggested?: BackdropFocal
    backdropFocalSuggestedSource?: string
  }): Promise<void> {
    try {
      const updates: any = {}

      if (assets.posterURL !== undefined) updates.posterURL = assets.posterURL
      if (assets.backdrop !== undefined) updates.backdrop = assets.backdrop
      if (assets.logo !== undefined) updates.logo = assets.logo
      if (assets.posterBlurhash !== undefined) updates.posterBlurhash = assets.posterBlurhash
      if (assets.backdropBlurhash !== undefined) updates.backdropBlurhash = assets.backdropBlurhash
      if (assets.posterBlurhashSource !== undefined) updates.posterBlurhashSource = assets.posterBlurhashSource
      if (assets.backdropBlurhashSource !== undefined) updates.backdropBlurhashSource = assets.backdropBlurhashSource
      if (assets.backdropFocal !== undefined) updates.backdropFocal = assets.backdropFocal
      if (assets.backdropFocalSource !== undefined) updates.backdropFocalSource = assets.backdropFocalSource
      if (assets.backdropFocalSuggested !== undefined) updates.backdropFocalSuggested = assets.backdropFocalSuggested
      if (assets.backdropFocalSuggestedSource !== undefined) updates.backdropFocalSuggestedSource = assets.backdropFocalSuggestedSource

      await this.update(title, updates)
    } catch (error) {
      throw new DatabaseError(`Failed to update movie assets: ${error}`, title)
    }
  }

  /**
   * Update movie video information
   */
  async updateVideoInfo(title: string, videoInfo: MovieEntity['videoInfo']): Promise<void> {
    try {
      await this.update(title, { videoInfo })
    } catch (error) {
      throw new DatabaseError(`Failed to update movie video info: ${error}`, title)
    }
  }

  /**
   * Update movie captions
   */
  async updateCaptions(title: string, captionURLs: MovieEntity['captionURLs']): Promise<void> {
    try {
      // Update to match the file server data structure where captionURLs is an object
      // with language keys mapped to URL values
      await this.update(title, { captionURLs })
    } catch (error) {
      throw new DatabaseError(`Failed to update movie captions: ${error}`, title)
    }
  }

  /**
   * Update movie chapters
   */
  async updateChapters(title: string, chapterURL: MovieEntity['chapterURL']): Promise<void> {
    try {
      await this.update(title, { chapterURL })
    } catch (error) {
      throw new DatabaseError(`Failed to update movie chapters: ${error}`, title)
    }
  }

  /**
   * Find movies for quality upgrade opportunities
   */
  async findUpgradeCandidates(): Promise<MovieEntity[]> {
    try {
      return await this.collection.find({
        $or: [
          { 'videoInfo.mediaQuality.format': { $ne: 'HEVC' } },
          { 'videoInfo.mediaQuality.bitDepth': { $lt: 10 } },
          { 'videoInfo.mediaQuality.enhancedViewing': { $ne: true } }
        ]
      }).toArray()
    } catch (error) {
      throw new DatabaseError(`Failed to find upgrade candidates: ${error}`)
    }
  }

  /**
   * Bulk update multiple movies - uses base class implementation
   */

  /**
   * Get movie statistics
   */
  async getMovieStats(): Promise<{
    total: number
    withVideo: number
    withPoster: number
    withBackdrop: number
    withCaptions: number
    withChapters: number
    byQuality: Record<string, number>
  }> {
    try {
      const [
        total,
        withVideo,
        withPoster,
        withBackdrop,
        withCaptions,
        withChapters,
        qualityStats
      ] = await Promise.all([
        this.collection.countDocuments(),
        this.collection.countDocuments({ videoURL: { $exists: true } }),
        this.collection.countDocuments({ posterURL: { $exists: true } }),
        this.collection.countDocuments({ backdrop: { $exists: true } }),
        this.collection.countDocuments({ captionURLs: { $exists: true, $ne: {} } }),
        this.collection.countDocuments({ chapterURL: { $exists: true } }),
        this.collection.aggregate([
          { $group: { _id: '$videoInfo.mediaQuality.format', count: { $sum: 1 } } }
        ]).toArray()
      ])

      const byQuality: Record<string, number> = {}
      qualityStats.forEach((stat: any) => {
        const id = stat._id === null ? 'unknown' : (stat._id?.toString() || 'unknown')
        byQuality[id] = stat.count || 0
      })

      return {
        total,
        withVideo,
        withPoster,
        withBackdrop,
        withCaptions,
        withChapters,
        byQuality
      }
    } catch (error) {
      throw new DatabaseError(`Failed to get movie statistics: ${error}`)
    }
  }

  /**
   * Save movie with validation
   */
  async save(entity: MovieEntity): Promise<void> {
    this.validateEntity(entity)
    await super.save(entity)
  }

  /**
   * Upsert movie with validation
   */
  async upsert(entity: MovieEntity): Promise<void> {
    this.validateEntity(entity)
    await super.upsert(entity)
  }
}
