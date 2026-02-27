/**
 * Watch History Lookup Map
 * 
 * Creates an efficient lookup map for user's watch history
 * using React cache() for per-request deduplication
 */

import clientPromise from '@src/lib/mongodb'
import { ObjectId } from 'mongodb'
import { generateNormalizedVideoId } from '@src/utils/flatDatabaseUtils'
import { cache } from 'react'

/**
 * Fetches user's watch history and creates a lookup map for efficient matching
 * Wrapped with React.cache() for per-request deduplication in Server Components
 *
 * @param {string|ObjectId} userId - The user ID
 * @returns {Promise<Map>} Map with normalizedVideoId as key and watch data as value
 */
export const createWatchHistoryLookupMap = cache(async function(userId) {
  try {
    const client = await clientPromise
    const db = client.db('Media')
    const userObjectId = typeof userId === 'object' ? userId : new ObjectId(userId)

    // Fetch user's watch history with projection for efficiency
    const entries = await db
      .collection('WatchHistory')
      .find(
        { userId: userObjectId },
        {
          projection: {
            videoId: 1,
            normalizedVideoId: 1,
            playbackTime: 1,
            lastUpdated: 1,
            mediaType: 1,
            mediaId: 1,
            showId: 1,
            seasonNumber: 1,
            episodeNumber: 1,
            isValid: 1
          }
        }
      )
      .toArray()

    // Create map for O(1) lookups by normalizedVideoId
    const lookupMap = new Map()
    for (const entry of entries) {
      lookupMap.set(entry.normalizedVideoId, {
        videoId: entry.videoId,
        playbackTime: entry.playbackTime,
        lastUpdated: entry.lastUpdated,
        mediaType: entry.mediaType,
        mediaId: entry.mediaId,
        showId: entry.showId,
        seasonNumber: entry.seasonNumber,
        episodeNumber: entry.episodeNumber,
        isValid: entry.isValid
      })
    }

    return lookupMap
  } catch (error) {
    console.error('[createWatchHistoryLookupMap] Error:', error)
    return new Map() // Return empty map on error for graceful degradation
  }
})
