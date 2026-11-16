import clientPromise from '@src/lib/mongodb'
import { ObjectId } from 'mongodb'
import { generateNormalizedVideoId } from '@src/utils/flatDatabaseUtils'
import { findPlaybackForUser } from '@src/utils/watchHistory/database'
import {
  isDurableMediaId,
  candidateKeysForItem,
  resolveWatchEntry,
  buildWatchHistoryObject,
} from '@src/utils/watchHistory/resolve'
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
 * Throws when the history cannot be read. It used to answer with an empty
 * map, which no caller could tell from "nothing watched": a client that
 * starts playback from that answer starts at 0 and saves over the position
 * it was never shown. What a failed read means is each caller's to decide: a
 * list degrades to no progress bars (addWatchHistoryToItems below,
 * joinEpisodes.js, watchHistoryServerUtils.ts); a request about one title
 * fails (addWatchHistoryToTitle).
 *
 * @param {string|ObjectId} userId - The user ID
 * @returns {Promise<Map>} Map with normalizedVideoId as key and watch data as value
 * @throws when the user's rows cannot be read
 */
export const createWatchHistoryLookupMap = cache(async function(userId) {
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
 * Main function to add watch history to media items: the join for a LIST.
 *
 * A list draws progress bars from it and nothing more, so it degrades: when
 * the history cannot be read every item reads as not watched, as it always
 * has. Not for a request about one title, which a client may start playback
 * from: that is addWatchHistoryToTitle, which fails instead.
 *
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

    let watchHistoryMap
    try {
      watchHistoryMap = await createWatchHistoryLookupMap(userId)
    } catch (error) {
      // Deliberate: no progress bars on this list, rather than no list
      console.error('Error creating watch history lookup map:', error)
      watchHistoryMap = new Map()
    }

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

// What the join reads of a row (buildWatchHistoryLookupMap,
// buildWatchHistoryObject), and the sync's flag on it
const TITLE_ROW_FIELDS = {
  videoId: 1,
  normalizedVideoId: 1,
  playbackTime: 1,
  lastUpdated: 1,
  mediaType: 1,
  mediaId: 1,
  showId: 1,
  seasonNumber: 1,
  episodeNumber: 1,
  isValid: 1,
}

/**
 * One title with its `watchHistory`: the join for a request about that title
 * alone (GET /api/authenticated/media for a movie or an episode), which the TV
 * and mobile apps start playback from.
 *
 * It throws when the history cannot be read, where the list join above
 * degrades. "No row" from a read that failed starts the title at 0, and the
 * player's first save, a few seconds in, replaces the position that was
 * never shown.
 *
 * The match is the list join's (resolveWatchEntry: mediaId, then the stored
 * hash, then the hash of each URL, then the raw URLs), read for this title's
 * keys only instead of from the user's whole history: one indexed read, and
 * one by URL only when that finds nothing (a row from before URLs were
 * hashed as they are now).
 *
 * A row the sync flagged isValid:false counts here, where the list join
 * skips it. The flag says the sync could not match the row to a title. This
 * title was just resolved from the catalog and the row matches it, so the
 * flag is stale; and a client told "no row" starts at 0 and saves over that
 * very row, which a write still updates. A row that is not flagged wins
 * whenever one matches, by any key: the answer changes only where the list
 * join's would have been "no row".
 *
 * @param {Object} item - the movie or episode (mediaId, normalizedVideoId, videoURL…)
 * @param {string|ObjectId} userId - User ID
 * @returns {Promise<Object>} the item with its `watchHistory`
 * @throws when the user's rows cannot be read
 */
export async function addWatchHistoryToTitle(item, userId) {
  const keys = candidateKeysForItem(item)
  const durableIds = keys.filter(isDurableMediaId)
  const hashesAndUrls = keys.filter((key) => !isDurableMediaId(key))

  const read = (identity) => findPlaybackForUser(userId, { filter: identity, projection: TITLE_ROW_FIELDS })
  const match = (rows) => resolveWatchEntry(item, buildWatchHistoryLookupMap(rows))
  const flagged = (row) => row.isValid === false

  let watchData = null
  if (keys.length > 0) {
    const identities = [
      ...(durableIds.length > 0 ? [{ mediaId: { $in: durableIds } }] : []),
      ...(hashesAndUrls.length > 0 ? [{ normalizedVideoId: { $in: hashesAndUrls } }] : []),
    ]
    const byKey = await read({ $or: identities })
    watchData = match(byKey.filter((row) => !flagged(row)))

    let byUrl = []
    if (!watchData && hashesAndUrls.length > 0) {
      byUrl = await read({ videoId: { $in: hashesAndUrls } })
      watchData = match(byUrl.filter((row) => !flagged(row)))
    }

    watchData = watchData ?? match(byKey.filter(flagged)) ?? match(byUrl.filter(flagged))
  }

  return { ...item, watchHistory: buildWatchHistoryObject(item, watchData) }
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