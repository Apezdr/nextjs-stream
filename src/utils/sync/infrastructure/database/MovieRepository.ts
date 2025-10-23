/**
 * Movie-specific repository implementation
 * Handles all database operations for movie entities
 */

import { MongoClient } from 'mongodb'
import { MovieEntity, DatabaseError } from '../../core/types'
import { BaseRepository } from './BaseRepository'

export class MovieRepository extends BaseRepository<MovieEntity> {
  constructor(client: MongoClient) {
    super(client, 'FlatMovies')  // Use current FlatMovies collection 
  }

  /**
   * Create optimal indexes for movie queries
   */
  async createIndexes(): Promise<void> {
    try {
      await Promise.all([
        // Primary lookup indexes
        this.createIndexSafely({ title: 1 }, { unique: true }),
        this.createIndexSafely({ originalTitle: 1 }, { unique: true }),
        this.createIndexSafely({ title: 1, serverId: 1 }),
        
        // Performance indexes
        this.createIndexSafely({ serverId: 1 }),
        this.createIndexSafely({ lastSynced: 1 }),
        
        // Asset availability indexes
        this.createIndexSafely({ videoURL: 1 }),
        this.createIndexSafely({ posterURL: 1 }),
        this.createIndexSafely({ backdrop: 1 }),
        this.createIndexSafely({ logo: 1 }),
        
        // Metadata indexes for search
        this.createIndexSafely({ 'metadata.genre': 1 }),
        this.createIndexSafely({ 'metadata.year': 1 }),
        this.createIndexSafely({ 'metadata.rating': 1 }),
        
        // Text search index
        this.createIndexSafely({ 
          title: 'text', 
          'metadata.description': 'text' 
        })
      ])
    } catch (error) {
      console.error('Failed to create movie indexes:', error)
      // Don't throw here - missing indexes won't break functionality
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
   * Bulk save multiple movies efficiently
   */
  async bulkSave(movies: MovieEntity[]): Promise<void> {
    if (movies.length === 0) return

    try {
      const operations = movies.map(movie => ({
        replaceOne: {
          filter: { title: movie.title },
          replacement: movie,
          upsert: true
        }
      }))

      await this.collection.bulkWrite(operations, { ordered: false })
    } catch (error) {
      throw new DatabaseError(`Failed to bulk save movies: ${error}`)
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
