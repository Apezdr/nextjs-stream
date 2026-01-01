/**
 * Base repository implementation for MongoDB
 * Provides common database operations and patterns for all media entities
 */

import { MongoClient, Collection, UpdateResult, DeleteResult } from 'mongodb'
import { BaseMediaEntity, MediaRepository, DatabaseError } from '../../core/types'

export abstract class BaseRepository<T extends BaseMediaEntity> implements MediaRepository<T> {
  protected client: MongoClient
  protected collection: Collection<T>
  protected collectionName: string

  constructor(client: MongoClient, collectionName: string) {
    this.client = client
    this.collectionName = collectionName
    this.collection = client.db('Media').collection<T>(collectionName)  // Use 'Media' database
  }

  /**
   * Find entity by display title (pretty title from TMDB)
   */
  async findByTitle(title: string): Promise<T | null> {
    try {
      console.log(`🔍 Looking for movie in ${this.collectionName} with title: "${title}"`)
      const result = await this.collection.findOne({ title } as any)
      console.log(`🔍 Found movie: ${result ? 'YES' : 'NO'}`)
      return result as T | null
    } catch (error) {
      throw new DatabaseError(
        `Failed to find ${this.collectionName} by title: ${error}`,
        title
      )
    }
  }

  /**
   * Find entity by original title (filesystem key)
   */
  async findByOriginalTitle(originalTitle: string): Promise<T | null> {
    try {
      console.log(`🔍 Looking for movie in ${this.collectionName} with originalTitle: "${originalTitle}"`)
      const result = await this.collection.findOne({ originalTitle } as any)
      console.log(`🔍 Found movie by originalTitle: ${result ? 'YES' : 'NO'}`)
      return result as T | null
    } catch (error) {
      throw new DatabaseError(
        `Failed to find ${this.collectionName} by originalTitle: ${error}`,
        originalTitle
      )
    }
  }

  /**
   * Find entity by either title (fallback lookup)
   * Tries display title first, then original title
   */
  async findByEitherTitle(title: string, originalTitle?: string): Promise<T | null> {
    try {
      // First try by display title
      let entity = await this.findByTitle(title)
      
      // If not found and originalTitle is different, try by originalTitle
      if (!entity && originalTitle && originalTitle !== title) {
        console.log(`🔄 Fallback: Trying originalTitle "${originalTitle}" since title "${title}" not found`)
        entity = await this.findByOriginalTitle(originalTitle)
      }
      
      return entity
    } catch (error) {
      throw new DatabaseError(
        `Failed to find ${this.collectionName} by either title: ${error}`,
        title
      )
    }
  }

  /**
   * Find entity by title and server
   */
  async findByTitleAndServer(title: string, serverId: string): Promise<T | null> {
    try {
      const result = await this.collection.findOne({ title, serverId } as any)
      return result as T | null
    } catch (error) {
      throw new DatabaseError(
        `Failed to find ${this.collectionName} by title and server: ${error}`,
        title
      )
    }
  }

  /**
   * Save new entity
   */
  async save(entity: T): Promise<void> {
    try {
      const now = new Date()
      const entityWithTimestamp = {
        ...entity,
        lastSynced: now,
        createdAt: entity.metadata?.createdAt || now,
        updatedAt: now
      }

      await this.collection.insertOne(entityWithTimestamp as any)
    } catch (error) {
      throw new DatabaseError(
        `Failed to save ${this.collectionName}: ${error}`,
        entity.title
      )
    }
  }

  /**
   * Update existing entity
   */
  async update(title: string, updates: Partial<T>): Promise<void> {
    try {
      console.log(`🔄 Updating ${this.collectionName} with title: "${title}"`)
      
      const updateDoc = {
        ...updates,
        lastSynced: new Date(),
        updatedAt: new Date()
      }

      const result: UpdateResult = await this.collection.updateOne(
        { title } as any,
        { $set: updateDoc }
      )

      console.log(`🔄 Update result: matchedCount=${result.matchedCount}, modifiedCount=${result.modifiedCount}`)

      if (result.matchedCount === 0) {
        // Let's see what's actually in the collection
        const count = await this.collection.countDocuments()
        const sample = await this.collection.findOne()
        console.log(`🔍 Database: Media, Collection: ${this.collectionName}, Documents: ${count}`)
        console.log(`🔍 Sample document:`, sample ? Object.keys(sample) : 'none')
        
        throw new DatabaseError(
          `${this.collectionName} not found for update`,
          title
        )
      }
    } catch (error) {
      throw new DatabaseError(
        `Failed to update ${this.collectionName}: ${error}`,
        title
      )
    }
  }

  /**
   * Update with upsert capability using originalTitle as key
   */
  async upsert(entity: T): Promise<void> {
    console.log(`🔍 TRACE: BaseRepository.upsert received entity with ${Object.keys(entity).length} fields:`, Object.keys(entity).sort())
    console.log(`🔍 TRACE: Critical fields - type: ${(entity as any).type}, initialDiscoveryDate: ${(entity as any).initialDiscoveryDate}, videoURL: ${(entity as any).videoURL}`)
    
    const originalTitle = (entity as any).originalTitle
    const title = (entity as any).title
    
    try {
      const now = new Date()
      const entityWithTimestamp = {
        ...entity,
        lastSynced: now,
        updatedAt: now
      }
      
      
      // For backwards compatibility, fall back to title if originalTitle is missing
      if (!originalTitle && !title) {
        throw new DatabaseError('Entity must have either originalTitle or title for upsert', 'unknown')
      }
      
      const queryField = originalTitle || title
      const queryKey = originalTitle ? 'originalTitle' : 'title'
      
      console.log(`🔍 Upserting using ${queryKey}: "${queryField}"`)

      const result = await this.collection.replaceOne(
        { [queryKey]: queryField } as any,
        entityWithTimestamp as any,
        { upsert: true }
      )
      
      if (result.modifiedCount > 0) {
        console.log(`✅ Updated existing ${this.collectionName}: "${queryField}"`)
      } else if (result.upsertedCount > 0) {
        console.log(`🆕 Created new ${this.collectionName}: "${queryField}"`)
      }
    } catch (error) {
      throw new DatabaseError(
        `Failed to upsert ${this.collectionName}: ${error}`,
        originalTitle || title || 'unknown'
      )
    }
  }

  /**
   * Delete entity
   */
  async delete(title: string): Promise<void> {
    try {
      const result: DeleteResult = await this.collection.deleteOne({ title } as any)
      
      if (result.deletedCount === 0) {
        throw new DatabaseError(
          `${this.collectionName} not found for deletion`,
          title
        )
      }
    } catch (error) {
      throw new DatabaseError(
        `Failed to delete ${this.collectionName}: ${error}`,
        title
      )
    }
  }

  /**
   * Check if entity exists
   */
  async exists(title: string): Promise<boolean> {
    try {
      const count = await this.collection.countDocuments({ title } as any)
      return count > 0
    } catch (error) {
      throw new DatabaseError(
        `Failed to check existence of ${this.collectionName}: ${error}`,
        title
      )
    }
  }

  /**
   * Find all entities with optional filtering
   */
  async findAll(filter: Record<string, any> = {}): Promise<T[]> {
    try {
      const results = await this.collection.find(filter).toArray()
      return results as T[]
    } catch (error) {
      throw new DatabaseError(
        `Failed to find all ${this.collectionName}: ${error}`
      )
    }
  }

  /**
   * Find entities by server ID
   */
  async findByServerId(serverId: string): Promise<T[]> {
    try {
      const results = await this.collection.find({ serverId } as any).toArray()
      return results as T[]
    } catch (error) {
      throw new DatabaseError(
        `Failed to find ${this.collectionName} by server ID: ${error}`
      )
    }
  }

  /**
   * Count entities with optional filter
   */
  async count(filter: Record<string, any> = {}): Promise<number> {
    try {
      return await this.collection.countDocuments(filter)
    } catch (error) {
      throw new DatabaseError(
        `Failed to count ${this.collectionName}: ${error}`
      )
    }
  }

  /**
   * Find entities modified since a specific date
   */
  async findModifiedSince(date: Date): Promise<T[]> {
    try {
      const results = await this.collection.find({
        lastSynced: { $gte: date }
      } as any).toArray()
      return results as T[]
    } catch (error) {
      throw new DatabaseError(
        `Failed to find modified ${this.collectionName}: ${error}`
      )
    }
  }

  /**
   * Bulk update operations
   */
  async bulkUpdate(updates: Array<{ title: string; updates: Partial<T> }>): Promise<void> {
    try {
      const operations = updates.map(({ title, updates }) => ({
        updateOne: {
          filter: { title } as any,
          update: { 
            $set: { 
              ...updates, 
              lastSynced: new Date(),
              updatedAt: new Date()
            } 
          }
        }
      }))

      if (operations.length > 0) {
        await this.collection.bulkWrite(operations)
      }
    } catch (error) {
      throw new DatabaseError(
        `Failed to bulk update ${this.collectionName}: ${error}`
      )
    }
  }

  /**
   * Find entities with missing fields
   */
  async findWithMissingFields(requiredFields: string[]): Promise<T[]> {
    try {
      const orConditions = requiredFields.map(field => ({
        [field]: { $exists: false }
      }))

      const results = await this.collection.find({
        $or: orConditions
      } as any).toArray()
      return results as T[]
    } catch (error) {
      throw new DatabaseError(
        `Failed to find ${this.collectionName} with missing fields: ${error}`
      )
    }
  }

  /**
   * Get collection statistics
   */
  async getStats(): Promise<{
    totalCount: number
    byServer: Record<string, number>
    recentlyModified: number
  }> {
    try {
      const totalCount = await this.collection.countDocuments()
      
      // Get count by server
      const serverAggregation = await this.collection.aggregate([
        { $group: { _id: '$serverId', count: { $sum: 1 } } }
      ]).toArray()
      
      const byServer: Record<string, number> = {}
      serverAggregation.forEach(({ _id, count }) => {
        byServer[_id] = count
      })

      // Get recently modified count (last 24 hours)
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
      const recentlyModified = await this.collection.countDocuments({
        lastSynced: { $gte: oneDayAgo }
      } as any)

      return {
        totalCount,
        byServer,
        recentlyModified
      }
    } catch (error) {
      throw new DatabaseError(
        `Failed to get ${this.collectionName} statistics: ${error}`
      )
    }
  }

  /**
   * Create database indexes for optimal performance
   */
  abstract createIndexes(): Promise<void>

  /**
   * Safely create an index, ignoring errors if it already exists
   */
  protected async createIndexSafely(indexSpec: Record<string, any>, options?: Record<string, any>): Promise<void> {
    try {
      await this.collection.createIndex(indexSpec, options)
    } catch (error: any) {
      // MongoDB error codes for index already exists
      if (error?.code === 85 || error?.code === 86 || error?.codeName === 'IndexOptionsConflict' || error?.codeName === 'IndexKeySpecsConflict') {
        // Index already exists, this is fine
        return
      }
      // Re-throw other errors
      throw error
    }
  }

  /**
   * Validate entity before database operations
   * Note: Removed serverId validation to support field-level source tracking
   */
  protected validateEntity(entity: T): void {
    if (!entity.title || entity.title.trim().length === 0) {
      throw new DatabaseError('Entity title is required', entity.title)
    }

    // Field-level source tracking means entities don't need a single serverId
    // Individual fields track their sources (e.g., metadataSource, videoSource, etc.)
  }
}