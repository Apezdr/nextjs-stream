/**
 * Watch History Database Operations
 * 
 * Centralized MongoDB operations for WatchHistory collection.
 * Handles all CRUD operations for user playback tracking.
 */

import clientPromise from '@src/lib/mongodb'
import { ObjectId } from 'mongodb'
import { generateNormalizedVideoId } from '@src/utils/flatDatabaseUtils'
import { createLogger } from '@src/lib/logger'

const log = createLogger('WatchHistory.Database')

/**
 * Upsert a single playback entry for a user
 * Atomic operation: updates existing or creates new
 * 
 * @param {Object} options
 * @param {string|ObjectId} options.userId - User ID
 * @param {string} options.videoId - Video URL
 * @param {number} options.playbackTime - Current playback position
 * @param {Object} options.metadata - Media metadata (type, id, season, episode, etc)
 * @param {Object} options.deviceInfo - Device information from User-Agent
 * @returns {Promise<Object>} Updated document
 */
export async function upsertPlayback({
  userId,
  videoId,
  playbackTime,
  metadata = {},
  deviceInfo = null
}) {
  try {
    const client = await clientPromise
    const db = client.db('Media')
    const collection = db.collection('WatchHistory')

    const userIdObj = typeof userId === 'string' ? new ObjectId(userId) : userId
    const normalizedVideoId = generateNormalizedVideoId(videoId)

    const result = await collection.updateOne(
      { userId: userIdObj, normalizedVideoId },
      {
        $set: {
          videoId,
          playbackTime,
          lastUpdated: new Date(),
          ...metadata,
          ...(deviceInfo && { deviceInfo })
        }
      },
      { upsert: true }
    )

    log.debug(
      { userId: userIdObj.toString(), normalizedVideoId, matched: result.matchedCount, upserted: result.upsertedCount },
      'Playback upserted'
    )

    return result
  } catch (error) {
    log.error({ error, userId, videoId }, 'Failed to upsert playback')
    throw error
  }
}

/**
 * Get all playback entries for a user
 * 
 * @param {string|ObjectId} userId - User ID
 * @returns {Promise<Array>} Array of watch history documents
 */
export async function getPlaybackForUser(userId) {
  try {
    const client = await clientPromise
    const db = client.db('Media')
    const collection = db.collection('WatchHistory')

    const userIdObj = typeof userId === 'string' ? new ObjectId(userId) : userId

    const entries = await collection.find({ userId: userIdObj }).toArray()

    log.debug({ userId: userIdObj.toString(), count: entries.length }, 'Retrieved playback entries')

    return entries
  } catch (error) {
    log.error({ error, userId }, 'Failed to get playback for user')
    throw error
  }
}

/**
 * Get playback entry for a specific video
 * 
 * @param {string|ObjectId} userId - User ID
 * @param {string} videoId - Video URL
 * @returns {Promise<Object|null>} Playback document or null
 */
export async function getPlaybackForVideo(userId, videoId) {
  try {
    const client = await clientPromise
    const db = client.db('Media')
    const collection = db.collection('WatchHistory')

    const userIdObj = typeof userId === 'string' ? new ObjectId(userId) : userId
    const normalizedVideoId = generateNormalizedVideoId(videoId)

    const entry = await collection.findOne({ userId: userIdObj, normalizedVideoId })

    return entry
  } catch (error) {
    log.error({ error, userId, videoId }, 'Failed to get playback for video')
    throw error
  }
}

/**
 * Get recently watched media for a user
 * 
 * @param {Object} options
 * @param {string|ObjectId} options.userId - User ID
 * @param {number} options.limit - Max results
 * @param {number} options.skip - Documents to skip (pagination)
 * @returns {Promise<Array>} Recently watched entries sorted by lastUpdated
 */
export async function getRecentlyWatchedForUser({ userId, limit = 50, skip = 0 }) {
  try {
    const client = await clientPromise
    const db = client.db('Media')
    const collection = db.collection('WatchHistory')

    const userIdObj = typeof userId === 'string' ? new ObjectId(userId) : userId

    const entries = await collection
      .find({ userId: userIdObj })
      .sort({ lastUpdated: -1 })
      .skip(skip)
      .limit(limit)
      .toArray()

    log.debug({ userId: userIdObj.toString(), count: entries.length, skip, limit }, 'Retrieved recently watched')

    return entries
  } catch (error) {
    log.error({ error, userId, limit, skip }, 'Failed to get recently watched')
    throw error
  }
}

/**
 * Get all users who have watched a specific video
 * 
 * @param {string} videoId - Video URL
 * @returns {Promise<Array>} User IDs who have watched this video
 */
export async function getUsersWhoWatched(videoId) {
  try {
    const client = await clientPromise
    const db = client.db('Media')
    const collection = db.collection('WatchHistory')

    const normalizedVideoId = generateNormalizedVideoId(videoId)

    const userIds = await collection.distinct('userId', { normalizedVideoId })

    log.debug({ normalizedVideoId, userCount: userIds.length }, 'Retrieved users who watched video')

    return userIds
  } catch (error) {
    log.error({ error, videoId }, 'Failed to get users who watched')
    throw error
  }
}

/**
 * Get count of unique users who have watched a video
 * 
 * @param {string} normalizedVideoId - Normalized video ID
 * @returns {Promise<number>} Count of unique viewers
 */
export async function getViewCount(normalizedVideoId) {
  try {
    const client = await clientPromise
    const db = client.db('Media')
    const collection = db.collection('WatchHistory')

    const count = await collection.countDocuments({ normalizedVideoId })

    return count
  } catch (error) {
    log.error({ error, normalizedVideoId }, 'Failed to get view count')
    throw error
  }
}

/**
 * Delete all playback entries for a user (e.g., on account deletion)
 *
 * @param {string|ObjectId} userId - User ID
 * @param {Object} session - Optional MongoDB session for transactions
 * @returns {Promise<Object>} DeleteResult with deletedCount
 */
export async function deletePlaybackForUser(userId, session = null) {
  try {
    const client = await clientPromise
    const db = client.db('Media')
    const collection = db.collection('WatchHistory')

    const userIdObj = typeof userId === 'string' ? new ObjectId(userId) : userId

    const options = session ? { session } : {}
    const result = await collection.deleteMany({ userId: userIdObj }, options)

    log.info({ userId: userIdObj.toString(), deletedCount: result.deletedCount }, 'Deleted playback for user')

    return result
  } catch (error) {
    log.error({ error, userId }, 'Failed to delete playback for user')
    throw error
  }
}

/**
 * Bulk update validation status for multiple entries
 * Used by: validation processes that need to update many entries atomically
 *
 * @example
 * import { bulkUpdateValidationStatus } from '@src/utils/watchHistory/database'
 * await bulkUpdateValidationStatus([
 *   { userId: 'user1', normalizedVideoId: 'hash1', isValid: { $ne: false } },
 *   { userId: 'user2', normalizedVideoId: 'hash2', isValid: false }
 * ])
 *
 * @param {Array<Object>} updates - Array of update objects
 * @param {string|ObjectId} updates[].userId - User ID
 * @param {string} updates[].normalizedVideoId - Normalized video ID
 * @param {boolean} updates[].isValid - Whether the video is valid
 * @returns {Promise<Object>} BulkWriteResult
 */
export async function bulkUpdateValidationStatus(updates) {
  try {
    const client = await clientPromise
    const db = client.db('Media')
    const collection = db.collection('WatchHistory')

    const bulkOps = updates.map(({ userId, normalizedVideoId, isValid }) => ({
      updateOne: {
        filter: {
          userId: typeof userId === 'string' ? new ObjectId(userId) : userId,
          normalizedVideoId
        },
        update: {
          $set: {
            isValid,
            lastScanned: new Date().toISOString()
          }
        }
      }
    }))

    const result = await collection.bulkWrite(bulkOps)

    log.info(
      {
        requestedUpdates: updates.length,
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount
      },
      'Bulk validation status updated'
    )

    return result
  } catch (error) {
    log.error({ error, updateCount: updates.length }, 'Failed to bulk update validation status')
    throw error
  }
}

/**
 * Clear validation status for a user's entries
 * Called when media validity needs re-checking
 *
 * @param {string|ObjectId} userId - User ID
 * @returns {Promise<Object>} UpdateResult
 */
export async function clearValidationForUser(userId) {
  try {
    const client = await clientPromise
    const db = client.db('Media')
    const collection = db.collection('WatchHistory')

    const userIdObj = typeof userId === 'string' ? new ObjectId(userId) : userId

    const result = await collection.updateMany(
      { userId: userIdObj },
      {
        $unset: { isValid: '', lastScanned: '' }
      }
    )

    log.debug({ userId: userIdObj.toString(), modifiedCount: result.modifiedCount }, 'Cleared validation status')

    return result
  } catch (error) {
    log.error({ error, userId }, 'Failed to clear validation')
    throw error
  }
}

/**
 * Update validation status for a specific playback entry
 * 
 * @param {Object} options
 * @param {string|ObjectId} options.userId - User ID
 * @param {string} options.normalizedVideoId - Normalized video ID
 * @param {boolean} options.isValid - Whether the video is valid
 * @returns {Promise<Object>} UpdateResult
 */
export async function updateValidationStatus({ userId, normalizedVideoId, isValid }) {
  try {
    const client = await clientPromise
    const db = client.db('Media')
    const collection = db.collection('WatchHistory')

    const userIdObj = typeof userId === 'string' ? new ObjectId(userId) : userId

    const result = await collection.updateOne(
      { userId: userIdObj, normalizedVideoId },
      {
        $set: {
          isValid,
          lastScanned: new Date().toISOString()
        }
      }
    )

    log.debug({ userId: userIdObj.toString(), normalizedVideoId, isValid }, 'Updated validation status')

    return result
  } catch (error) {
    log.error({ error, userId, normalizedVideoId, isValid }, 'Failed to update validation status')
    throw error
  }
}

/**
 * Bulk get watch history for multiple users (admin/analytics)
 *
 * @param {Array<string|ObjectId>} userIds - Array of user IDs
 * @returns {Promise<Map>} Map of userId -> array of watch history entries
 */
export async function getBulkPlaybackForUsers(userIds) {
  try {
    const client = await clientPromise
    const db = client.db('Media')
    const collection = db.collection('WatchHistory')

    const userIdObjs = userIds.map(id => (typeof id === 'string' ? new ObjectId(id) : id))

    const entries = await collection.find({ userId: { $in: userIdObjs } }).toArray()

    // Group by userId
    const result = new Map()
    for (const entry of entries) {
      const userId = entry.userId.toString()
      if (!result.has(userId)) {
        result.set(userId, [])
      }
      result.get(userId).push(entry)
    }

    log.debug({ userCount: userIds.length, entriesCount: entries.length }, 'Retrieved bulk playback')

    return result
  } catch (error) {
    log.error({ error, userCount: userIds.length }, 'Failed to get bulk playback')
    throw error
  }
}

/**
 * Count watch history entries for a user with optional filter
 *
 * @example
 * // Count all entries
 * const total = await countPlaybackForUser(userId)
 *
 * @example
 * // Count only valid entries
 * const valid = await countPlaybackForUser(userId, { isValid: { $ne: false } })
 *
 * @param {string|ObjectId} userId - User ID
 * @param {Object} filter - Additional filter criteria (optional)
 * @returns {Promise<number>} Count of matching documents
 */
export async function countPlaybackForUser(userId, filter = {}) {
  try {
    const client = await clientPromise
    const db = client.db('Media')
    const collection = db.collection('WatchHistory')

    const userIdObj = typeof userId === 'string' ? new ObjectId(userId) : userId

    const count = await collection.countDocuments({ userId: userIdObj, ...filter })

    log.debug({ userId: userIdObj.toString(), filter, count }, 'Counted playback entries')

    return count
  } catch (error) {
    log.error({ error, userId, filter }, 'Failed to count playback for user')
    throw error
  }
}

/**
 * Get distinct user IDs from watch history (for notifications, analytics)
 *
 * @example
 * import { getAllWatchHistoryUserIds } from '@src/utils/watchHistory/database'
 * const userIds = await getAllWatchHistoryUserIds()
 *
 * @returns {Promise<Array<ObjectId>>} Array of unique user IDs
 */
export async function getAllWatchHistoryUserIds() {
  try {
    const client = await clientPromise
    const db = client.db('Media')
    const collection = db.collection('WatchHistory')

    const userIds = await collection.distinct('userId')

    log.debug({ userCount: userIds.length }, 'Retrieved distinct user IDs')

    return userIds
  } catch (error) {
    log.error({ error }, 'Failed to get all watch history user IDs')
    throw error
  }
}

/**
 * Check if user has any watch history (existence check)
 * Used by: flatRecentlyWatchedChecker.js, recommendation systems
 *
 * @example
 * import { hasWatchHistory } from '@src/utils/watchHistory/database'
 * if (await hasWatchHistory(userId)) {
 *   // Show personalized content
 * }
 *
 * @param {string|ObjectId} userId - User ID
 * @returns {Promise<boolean>} True if user has valid watch history
 */
export async function hasWatchHistory(userId) {
  try {
    const client = await clientPromise
    const db = client.db('Media')
    const collection = db.collection('WatchHistory')

    const userIdObj = typeof userId === 'string' ? new ObjectId(userId) : userId

    const entry = await collection.findOne(
      { userId: userIdObj, isValid: { $ne: false } },
      { projection: { _id: 1 } }
    )

    log.debug({ userId: userIdObj.toString(), hasHistory: !!entry }, 'Checked watch history existence')

    return !!entry
  } catch (error) {
    log.error({ error, userId }, 'Failed to check watch history')
    return false // Return false on error for graceful degradation
  }
}

/**
 * Find watch history with custom query options (for complex queries)
 *
 * @example
 * // Get recent valid entries with projection
 * import { findPlaybackForUser } from '@src/utils/watchHistory/database'
 * const entries = await findPlaybackForUser(userId, {
 *   filter: { isValid: { $ne: false } },
 *   sort: { lastUpdated: -1 },
 *   limit: 10,
 *   projection: { videoId: 1, playbackTime: 1, lastUpdated: 1 }
 * })
 *
 * @param {string|ObjectId} userId - User ID
 * @param {Object} options - Query options
 * @param {Object} options.filter - Additional filter criteria (e.g., { isValid: { $ne: false } })
 * @param {Object} options.projection - Fields to return
 * @param {Object} options.sort - Sort order (e.g., { lastUpdated: -1 })
 * @param {number} options.skip - Documents to skip (pagination)
 * @param {number} options.limit - Maximum documents to return
 * @returns {Promise<Array>} Array of watch history documents
 */
export async function findPlaybackForUser(userId, options = {}) {
  try {
    const client = await clientPromise
    const db = client.db('Media')
    const collection = db.collection('WatchHistory')

    const userIdObj = typeof userId === 'string' ? new ObjectId(userId) : userId

    // Build query with user ID and optional filters
    const query = { userId: userIdObj }
    if (options.filter) {
      Object.assign(query, options.filter)
    }

    // Build cursor with projection
    let cursor = collection.find(
      query,
      options.projection ? { projection: options.projection } : {}
    )

    // Apply query modifiers
    if (options.sort) cursor = cursor.sort(options.sort)
    if (options.skip) cursor = cursor.skip(options.skip)
    if (options.limit) cursor = cursor.limit(options.limit)

    const entries = await cursor.toArray()

    log.debug(
      {
        userId: userIdObj.toString(),
        options,
        count: entries.length
      },
      'Found playback entries with custom options'
    )

    return entries
  } catch (error) {
    log.error({ error, userId, options }, 'Failed to find playback for user')
    throw error
  }
}

/**
 * Get ALL playback entries across all users (for analytics, popularity scoring)
 * Use with caution - this queries the entire collection
 *
 * @example
 * // Get all videoIds for popularity analysis
 * import { getAllPlaybackEntries } from '@src/utils/watchHistory/database'
 * const entries = await getAllPlaybackEntries({ projection: { videoId: 1 } })
 *
 * @param {Object} options - Query options
 * @param {Object} options.filter - Filter criteria (e.g., { isValid: { $ne: false } })
 * @param {Object} options.projection - Fields to return
 * @param {Object} options.sort - Sort order
 * @param {number} options.limit - Maximum documents to return
 * @returns {Promise<Array>} Array of watch history documents
 */
export async function getAllPlaybackEntries(options = {}) {
  try {
    const client = await clientPromise
    const db = client.db('Media')
    const collection = db.collection('WatchHistory')

    // Build query with optional filters
    const query = options.filter || {}

    // Build cursor with projection
    let cursor = collection.find(
      query,
      options.projection ? { projection: options.projection } : {}
    )

    // Apply query modifiers
    if (options.sort) cursor = cursor.sort(options.sort)
    if (options.limit) cursor = cursor.limit(options.limit)

    const entries = await cursor.toArray()

    log.debug(
      {
        filter: options.filter,
        count: entries.length
      },
      'Retrieved all playback entries'
    )

    return entries
  } catch (error) {
    log.error({ error, options }, 'Failed to get all playback entries')
    throw error
  }
}
