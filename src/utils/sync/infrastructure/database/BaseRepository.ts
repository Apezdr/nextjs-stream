/**
 * Base repository implementation for MongoDB
 * Provides common database operations and patterns for all media entities
 */

import { MongoClient, Collection, UpdateResult, DeleteResult } from 'mongodb'
import { BaseMediaEntity, MediaRepository, DatabaseError } from '../../core/types'
import isEqual from 'lodash/isEqual'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — sibling JS module with no .d.ts; it exports plain functions
import { getCurrentSyncRunId } from '../../../flatSync/syncContext'

// Fields that must never appear in a diff — either MongoDB internals or
// system timestamps that always change and should not trigger a write.
// `syncRunId` is also excluded so a run-id refresh on an otherwise unchanged
// doc still falls through to the "no diff → no write" fast path; the marker
// gets re-applied via the explicit add-on at every write site below.
const DIFF_EXCLUDED_FIELDS = new Set(['_id', 'lastSynced', 'updatedAt', 'createdAt', 'syncRunId'])

/**
 * Whether a top-level field is locked according to a doc's nested `lockedFields`
 * map (e.g. { posterURL: true, metadata: { overview: true } }).
 *
 * A nested-object lock (metadata.overview) is treated as locking the WHOLE
 * top-level key here. computeDiff emits whole-object `$set` for changed nested
 * objects, so honoring a sub-path lock by partially rebuilding the object would
 * drop the locked sub-value on write — locking the whole key is the safe,
 * never-lose-data behavior. The default flatSync path (filterLockedFields) does
 * sub-path-precise dot-path writes; the new architecture is coarser but never
 * overwrites an admin's locked value.
 */
function isTopLevelFieldLocked(lockedFields: any, key: string): boolean {
  if (!lockedFields || typeof lockedFields !== 'object') return false
  const lock = lockedFields[key]
  return lock === true || (lock !== null && typeof lock === 'object')
}

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
      const result = await this.collection.findOne({ title } as any)
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
      const result = await this.collection.findOne({ originalTitle } as any)
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
      const syncRunId = getCurrentSyncRunId()
      const entityWithTimestamp = {
        ...entity,
        lastSynced: now,
        createdAt: entity.metadata?.createdAt || now,
        updatedAt: now,
        ...(syncRunId ? { syncRunId } : {})
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
      const syncRunId = getCurrentSyncRunId()
      const updateDoc = {
        ...updates,
        lastSynced: new Date(),
        updatedAt: new Date(),
        ...(syncRunId ? { syncRunId } : {})
      }

      const result: UpdateResult = await this.collection.updateOne(
        { title } as any,
        { $set: updateDoc }
      )

      if (result.matchedCount === 0) {
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
    const originalTitle = (entity as any).originalTitle
    const title = (entity as any).title

    if (!originalTitle && !title) {
      throw new DatabaseError('Entity must have either originalTitle or title for upsert', 'unknown')
    }

    const queryField = originalTitle || title
    const queryKey = originalTitle ? 'originalTitle' : 'title'

    try {
      const now = new Date()
      const syncRunId = getCurrentSyncRunId()
      // Strip _id so MongoDB preserves existing _id on matched docs
      // and auto-generates for new upserted docs
      const { _id, ...entityWithoutId } = entity as any
      const entityWithTimestamp = {
        ...entityWithoutId,
        lastSynced: now,
        updatedAt: now,
        ...(syncRunId ? { syncRunId } : {})
      }

      await this.collection.replaceOne(
        { [queryKey]: queryField } as any,
        entityWithTimestamp as any,
        { upsert: true }
      )
    } catch (error) {
      throw new DatabaseError(
        `Failed to upsert ${this.collectionName}: ${error}`,
        originalTitle || title || 'unknown'
      )
    }
  }

  /**
   * Compute a key-level diff between two entities.
   *
   * Returns an object containing only the top-level keys whose values differ
   * between `existing` and `merged`, excluding system fields that should never
   * drive a write decision (timestamps, MongoDB _id).
   *
   * Uses lodash isEqual for deep comparison so nested objects (metadata,
   * captionURLs, videoInfo) are compared correctly without path-level diffing.
   */
  protected static computeDiff<T extends Record<string, any>>(
    existing: T,
    merged: T
  ): Partial<T> {
    const diff: Partial<T> = {}
    // Honor admin field locks: a changed-but-locked field is omitted from the
    // diff, so the existing (manually-set) value is preserved on write. This is
    // the new architecture's lock enforcement point — both smartUpsert (movies,
    // TV shows) and smartBulkUpsert (episodes) flow through here, mirroring the
    // protection filterLockedFields provides on the default flatSync path.
    const lockedFields = (existing as any)?.lockedFields
    for (const key of Object.keys(merged)) {
      if (DIFF_EXCLUDED_FIELDS.has(key)) continue
      if (isTopLevelFieldLocked(lockedFields, key)) continue
      if (!isEqual(existing[key], (merged as any)[key])) {
        (diff as any)[key] = (merged as any)[key]
      }
    }
    return diff
  }

  /**
   * Write-optimal single-document upsert.
   *
   * - New document (existing=null): $setOnInsert so concurrent syncs
   *   don't overwrite each other (first writer wins, second is a no-op).
   * - Unchanged document (diff empty): returns immediately — zero writes,
   *   zero write-ticket acquisition.
   * - Changed document: updateOne $set with only the changed fields +
   *   lastSynced/updatedAt. Ticket hold time is proportional to change
   *   volume, not document size.
   */
  async smartUpsert(
    entity: T,
    existing: T | null,
    options?: {
      /**
       * Field names to $unset on an existing doc (field-absence cleanup). The
       * caller has already gated these on the authoritative pass + lock checks.
       * Ignored for new docs (nothing to clear). When present the write fires
       * even if the $set diff is empty — and still carries the syncRunId marker
       * so post-sync cleanup doesn't reap the doc.
       */
      unset?: string[]
    }
  ): Promise<void> {
    const originalTitle = (entity as any).originalTitle
    const title = (entity as any).title
    if (!originalTitle && !title) {
      throw new DatabaseError('Entity must have either originalTitle or title for smartUpsert', 'unknown')
    }
    const queryField = originalTitle || title
    const queryKey = originalTitle ? 'originalTitle' : 'title'
    const now = new Date()
    const syncRunId = getCurrentSyncRunId()
    const { _id, ...entityWithoutId } = entity as any

    try {
      if (!existing) {
        // New document — $setOnInsert is a no-op if doc already exists (race safety)
        await this.collection.updateOne(
          { [queryKey]: queryField } as any,
          {
            $setOnInsert: {
              ...entityWithoutId,
              lastSynced: now,
              updatedAt: now,
              ...(syncRunId ? { syncRunId } : {})
            }
          } as any,
          { upsert: true }
        )
        return
      }

      const diff = BaseRepository.computeDiff(existing, entity)
      // Only $unset fields that actually have a value on the existing doc.
      const unsetFields = (options?.unset || []).filter(f => (existing as any)[f] !== undefined)
      if (Object.keys(diff).length === 0 && unsetFields.length === 0) return  // Nothing changed — skip write

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

      await this.collection.updateOne(
        { [queryKey]: queryField } as any,
        update as any
      )
    } catch (error) {
      throw new DatabaseError(
        `Failed to smartUpsert ${this.collectionName}: ${error}`,
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
      const syncRunId = getCurrentSyncRunId()
      const operations = updates.map(({ title, updates }) => ({
        updateOne: {
          filter: { title } as any,
          update: {
            $set: {
              ...updates,
              lastSynced: new Date(),
              updatedAt: new Date(),
              ...(syncRunId ? { syncRunId } : {})
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
  // Returns true only if every index was created (or already existed). A repo that
  // returns false had a build dropped by a transient connection close that didn't
  // recover; the adapter leaves indexesCreated=false so the next sync re-attempts.
  abstract createIndexes(): Promise<boolean>

  /**
   * Safely create an index: ignore "already exists" conflicts, and RETRY
   * transient transport errors.
   *
   * The pooled connection tearing down mid-build (`connection N to host:27017
   * closed`, `ECONNRESET`, `pool was cleared`) is endemic in this deployment.
   * Without a retry a single drop rejects the repo's `createIndexes()` Promise.all
   * and leaves the WHOLE collection un-indexed — after which every query/upsert
   * COLLSCANs, which piles more pressure on the pool and causes MORE drops
   * (observed 2026-06-20: all four repos failed index creation on one drop, then
   * the un-indexed cleanup `{syncRunId:{$ne}}` COLLSCAN kept the contention alive).
   * `createIndex` is idempotent, so re-issuing a dropped build is safe. Mirrors
   * `withTransientRetry` in preTagSyncRunId.js.
   */
  protected async createIndexSafely(indexSpec: Record<string, any>, options?: Record<string, any>): Promise<void> {
    const isAlreadyExists = (error: any): boolean =>
      error?.code === 85 || error?.code === 86 ||
      error?.codeName === 'IndexOptionsConflict' || error?.codeName === 'IndexKeySpecsConflict'

    const isTransient = (error: any): boolean => {
      if (!error) return false
      if (
        typeof error.hasErrorLabel === 'function' &&
        (error.hasErrorLabel('TransientTransactionError') || error.hasErrorLabel('RetryableWriteError'))
      ) {
        return true
      }
      return /connection .* closed|ECONNRESET|socket hang up|socket|network|pool (was )?(cleared|closed)|server is closed|MongoNetworkError/i.test(
        error?.message || ''
      )
    }

    const MAX_TRIES = 4
    for (let attempt = 1; ; attempt++) {
      try {
        await this.collection.createIndex(indexSpec, options)
        return
      } catch (error: any) {
        // Already exists (possibly with different options/name) — not an error.
        if (isAlreadyExists(error)) return
        // Transient transport drop — back off (which also de-bursts the retry
        // wave) and try again before giving up.
        if (attempt < MAX_TRIES && isTransient(error)) {
          await new Promise((resolve) => setTimeout(resolve, 250 * attempt))
          continue
        }
        throw error
      }
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