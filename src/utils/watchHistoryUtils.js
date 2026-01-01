import clientPromise from '@src/lib/mongodb'
import { ObjectId } from 'mongodb'
import { generateNormalizedVideoId } from '@src/utils/flatDatabaseUtils'

/**
 * Fetches user's watch history and creates a lookup map for efficient matching
 * @param {string|ObjectId} userId - The user ID
 * @returns {Promise<Map>} Map with normalizedVideoId as key and watch data as value
 */
export async function createWatchHistoryLookupMap(userId) {
  try {
    const client = await clientPromise
    const db = client.db('Media')
    const userObjectId = typeof userId === 'object' ? userId : new ObjectId(userId)

    // Fetch user's watch history with projection for efficiency
    const watchHistory = await db
      .collection('PlaybackStatus')
      .findOne(
        { userId: userObjectId },
        {
          projection: {
            'videosWatched.videoId': 1,
            'videosWatched.normalizedVideoId': 1,
            'videosWatched.playbackTime': 1,
            'videosWatched.lastUpdated': 1,
            'videosWatched.isValid': 1,
            'videosWatched.mediaType': 1,
            'videosWatched.showId': 1,
            'videosWatched.seasonNumber': 1,
            'videosWatched.episodeNumber': 1
          }
        }
      )

    const lookupMap = new Map()

    if (watchHistory?.videosWatched) {
      // Filter valid entries and create lookup map
      watchHistory.videosWatched
        .filter(entry => entry.isValid !== false)
        .forEach(entry => {
          // Use normalizedVideoId if available, otherwise generate it
          let normalizedId = entry.normalizedVideoId
          if (!normalizedId && entry.videoId) {
            normalizedId = generateNormalizedVideoId(entry.videoId)
          }

          if (normalizedId) {
            lookupMap.set(normalizedId, {
              playbackTime: entry.playbackTime || 0,
              lastWatched: entry.lastUpdated,
              isWatched: true,
              normalizedVideoId: normalizedId,
              // Include additional metadata for TV shows
              ...(entry.mediaType === 'tv' && {
                showId: entry.showId,
                seasonNumber: entry.seasonNumber,
                episodeNumber: entry.episodeNumber
              })
            })
          }

          // Also add entry by direct videoId for fallback matching
          if (entry.videoId) {
            lookupMap.set(entry.videoId, {
              playbackTime: entry.playbackTime || 0,
              lastWatched: entry.lastUpdated,
              isWatched: true,
              normalizedVideoId: normalizedId,
              // Include additional metadata for TV shows
              ...(entry.mediaType === 'tv' && {
                showId: entry.showId,
                seasonNumber: entry.seasonNumber,
                episodeNumber: entry.episodeNumber
              })
            })
          }
        })
    }

    return lookupMap
  } catch (error) {
    console.error('Error creating watch history lookup map:', error)
    return new Map() // Return empty map on error to allow graceful degradation
  }
}

/**
 * Augments media items with watch history data
 * @param {Array} items - Array of media items to augment
 * @param {Map} watchHistoryMap - Lookup map created by createWatchHistoryLookupMap
 * @returns {Array} Array of items augmented with watch history
 */
export function augmentItemsWithWatchHistory(items, watchHistoryMap) {
  if (!items || !Array.isArray(items) || watchHistoryMap.size === 0) {
    return items
  }

  return items.map(item => {
    let watchData = null

    // Try to match by normalizedVideoId first (most reliable)
    if (item.normalizedVideoId && watchHistoryMap.has(item.normalizedVideoId)) {
      watchData = watchHistoryMap.get(item.normalizedVideoId)
    }
    // Fallback to videoURL matching
    else if (item.videoURL && watchHistoryMap.has(item.videoURL)) {
      watchData = watchHistoryMap.get(item.videoURL)
    }
    // For TV shows, try to match by episode data if available
    else if (item.type === 'tv' && item.episode?.videoURL && watchHistoryMap.has(item.episode.videoURL)) {
      watchData = watchHistoryMap.get(item.episode.videoURL)
    }
    // Generate normalizedVideoId and try matching if not already present
    else if (item.videoURL && !item.normalizedVideoId) {
      const generatedNormalizedId = generateNormalizedVideoId(item.videoURL)
      if (generatedNormalizedId && watchHistoryMap.has(generatedNormalizedId)) {
        watchData = watchHistoryMap.get(generatedNormalizedId)
      }
    }

    // Add watch history if found
    if (watchData) {
      return {
        ...item,
        watchHistory: {
          playbackTime: watchData.playbackTime,
          lastWatched: watchData.lastWatched,
          isWatched: watchData.isWatched,
          normalizedVideoId: watchData.normalizedVideoId,
          // Include TV-specific metadata if available
          ...(watchData.showId && {
            showId: watchData.showId,
            seasonNumber: watchData.seasonNumber,
            episodeNumber: watchData.episodeNumber
          })
        }
      }
    }

    // Return item without watch history if no match found
    return {
      ...item,
      watchHistory: {
        playbackTime: 0,
        lastWatched: null,
        isWatched: false,
        normalizedVideoId: null
      }
    }
  })
}

/**
 * Main function to add watch history to media items
 * @param {Array} items - Array of media items
 * @param {string|ObjectId} userId - User ID
 * @returns {Promise<Array>} Items augmented with watch history
 */
export async function addWatchHistoryToItems(items, userId) {
  try {
    if (process.env.DEBUG) {
      console.time('addWatchHistoryToItems:total')
      console.log(`[PERF] Adding watch history to ${items?.length || 0} items for user ${userId}`)
    }

    const watchHistoryMap = await createWatchHistoryLookupMap(userId)
    
    if (process.env.DEBUG) {
      console.log(`[PERF] Created watch history map with ${watchHistoryMap.size} entries`)
    }

    const augmentedItems = augmentItemsWithWatchHistory(items, watchHistoryMap)

    if (process.env.DEBUG) {
      const itemsWithHistory = augmentedItems.filter(item => item.watchHistory?.isWatched).length
      console.log(`[PERF] ${itemsWithHistory} out of ${augmentedItems.length} items have watch history`)
      console.timeEnd('addWatchHistoryToItems:total')
    }

    return augmentedItems
  } catch (error) {
    console.error('Error adding watch history to items:', error)
    // Return original items on error for graceful degradation
    return items
  }
}