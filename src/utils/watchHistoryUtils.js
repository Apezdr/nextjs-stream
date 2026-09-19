import clientPromise from '@src/lib/mongodb'
import { ObjectId } from 'mongodb'
import { generateNormalizedVideoId } from '@src/utils/flatDatabaseUtils'
import { findPlaybackForUser } from '@src/utils/watchHistory/database'
import { isDurableMediaId, resolveWatchEntry, buildWatchHistoryObject } from '@src/utils/watchHistory/resolve'
import { cache } from 'react'

/**
 * Builds the multi-key lookup map (normalizedVideoId + raw videoId + durable
 * mediaId) from raw WatchHistory documents. Shared by the full and bounded
 * fetch paths.
 *
 * @param {Array} watchHistoryEntries - Raw WatchHistory documents
 * @returns {Map} Map keyed by normalizedVideoId, raw videoId, and mediaId ('mid:…')
 */
function buildWatchHistoryLookupMap(watchHistoryEntries) {
  const lookupMap = new Map()

  if (watchHistoryEntries && watchHistoryEntries.length > 0) {
    // Process each watch history entry and create lookup map
    watchHistoryEntries.forEach(entry => {
        // Use normalizedVideoId if available, otherwise generate it
        let normalizedId = entry.normalizedVideoId
        if (!normalizedId && entry.videoId) {
          normalizedId = generateNormalizedVideoId(entry.videoId)
        }

        const watchData = {
          playbackTime: entry.playbackTime || 0,
          lastWatched: entry.lastUpdated,
          isWatched: true,
          normalizedVideoId: normalizedId,
          mediaId: isDurableMediaId(entry.mediaId) ? entry.mediaId : null,
          // Include additional metadata for TV shows
          ...(entry.mediaType === 'tv' && {
            showId: entry.showId,
            seasonNumber: entry.seasonNumber,
            episodeNumber: entry.episodeNumber
          })
        }

        if (normalizedId) {
          lookupMap.set(normalizedId, watchData)
        }

        // Also add entry by direct videoId for fallback matching
        if (entry.videoId) {
          lookupMap.set(entry.videoId, watchData)
        }

        // Durable-identity key ('mid:…'): rename-proof arm for item-side
        // lookups. Two rows can share a mediaId pre-backfill (quality swap
        // duplicates) — the row with the newer lastUpdated wins the key.
        if (isDurableMediaId(entry.mediaId)) {
          const existing = lookupMap.get(entry.mediaId)
          if (
            !existing ||
            new Date(entry.lastUpdated || 0) >= new Date(existing.lastWatched || 0)
          ) {
            lookupMap.set(entry.mediaId, watchData)
          }
        }
      })
  }

  return lookupMap
}

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

    // Fetch user's watch history from WatchHistory collection
    // Each document is a separate video entry (no arrays)
    const watchHistoryEntries = await db
      .collection('WatchHistory')
      .find(
        { userId: userObjectId, isValid: { $ne: false } },
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
            episodeNumber: 1
          }
        }
      )
      .toArray()

    return buildWatchHistoryLookupMap(watchHistoryEntries)
  } catch (error) {
    console.error('Error creating watch history lookup map:', error)
    return new Map() // Return empty map on error to allow graceful degradation
  }
})

/**
 * Augments media items with watch history data.
 *
 * Every item comes back with a `watchHistory` object of the same shape —
 * matched or not — so no client has to tell "absent" from "null" from
 * "zeroed". Matching goes through resolveWatchEntry (mediaId → nid → hashed
 * URLs → raw URLs), the same precedence every other surface uses.
 *
 * @param {Array} items - Array of media items to augment
 * @param {Map} watchHistoryMap - Lookup map created by createWatchHistoryLookupMap
 * @returns {Array} Array of items augmented with watch history
 */
export function augmentItemsWithWatchHistory(items, watchHistoryMap) {
  if (!items || !Array.isArray(items)) {
    return items
  }

  return items.map(item => ({
    ...item,
    watchHistory: buildWatchHistoryObject(item, resolveWatchEntry(item, watchHistoryMap)),
  }))
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

/**
 * Adds watch history to media items using a bounded query — fetches only the
 * WatchHistory entries whose normalizedVideoId matches one of the given items,
 * instead of the user's entire history.
 *
 * Only suitable for items that carry a stored `normalizedVideoId` (e.g. cards
 * produced by sanitizeCardData). Items matched by raw videoURL or by the
 * JS-generated hash fallback need addWatchHistoryToItems' full fetch instead.
 *
 * @param {Array} items - Array of media items (each with normalizedVideoId)
 * @param {string|ObjectId} userId - User ID
 * @returns {Promise<Array>} Items augmented with watch history
 */
export async function addWatchHistoryToItemsBounded(items, userId) {
  try {
    if (!items || !Array.isArray(items) || items.length === 0) {
      return items
    }

    if (process.env.DEBUG) {
      console.time('addWatchHistoryToItemsBounded:total')
      console.log(`[PERF] Adding bounded watch history to ${items.length} items for user ${userId}`)
    }

    const normalizedIds = [...new Set(items.map(item => item?.normalizedVideoId).filter(Boolean))]

    // Durable identities carried by the items — fetch rows keyed under a prior
    // URL/nid (quality swaps, renames) that only the mediaId arm can match.
    const itemMediaIds = [...new Set(items.map(item => item?.mediaId).filter(isDurableMediaId))]

    const rowFilter =
      itemMediaIds.length > 0
        ? {
            isValid: { $ne: false },
            $or: [
              { normalizedVideoId: { $in: normalizedIds } },
              { mediaId: { $in: itemMediaIds } }
            ]
          }
        : { isValid: { $ne: false }, normalizedVideoId: { $in: normalizedIds } }

    const entries = normalizedIds.length > 0 || itemMediaIds.length > 0
      ? await findPlaybackForUser(userId, {
          filter: rowFilter,
          projection: {
            videoId: 1,
            normalizedVideoId: 1,
            playbackTime: 1,
            lastUpdated: 1,
            mediaType: 1,
            mediaId: 1,
            showId: 1,
            seasonNumber: 1,
            episodeNumber: 1
          }
        })
      : []

    // Same shape whether or not anything matched (see augmentItemsWithWatchHistory).
    const augmentedItems = augmentItemsWithWatchHistory(items, buildWatchHistoryLookupMap(entries))

    if (process.env.DEBUG) {
      const itemsWithHistory = augmentedItems.filter(item => item.watchHistory?.isWatched).length
      console.log(`[PERF] Bounded: ${entries.length} history entries fetched, ${itemsWithHistory} of ${augmentedItems.length} items matched`)
      console.timeEnd('addWatchHistoryToItemsBounded:total')
    }

    return augmentedItems
  } catch (error) {
    console.error('Error adding bounded watch history to items:', error)
    // Return original items on error for graceful degradation
    return items
  }
}