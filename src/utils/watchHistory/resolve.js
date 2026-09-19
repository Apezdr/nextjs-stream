/**
 * The one way a catalog item finds its WatchHistory row.
 *
 * Every read surface used to carry its own key logic: the media API tried
 * mediaId then hash then URL, the web player page tried URL then hash, the
 * web list pages compared the raw URL string only, and the card join could
 * only see the hash. The same row therefore resumed on the TV app and read
 * as unwatched on the web list, or resumed on the web player and vanished
 * after a quality swap. This module is the single precedence every surface
 * now uses:
 *
 *   1. durable content identity (`mid:…`) — rename- and re-encode-proof
 *   2. the item's stored normalizedVideoId
 *   3. the hash of every URL the item can be played through (raw file, JIT
 *      manifest, nested episode) — the server canonicalizes all of them to
 *      the same key, which is what makes a row written by one client under
 *      one transport resolvable by the other
 *   4. the raw URL strings, last, for rows that predate hashing
 *
 * The lookup map comes from watchHistoryUtils.buildWatchHistoryLookupMap and
 * is keyed by normalizedVideoId, raw videoId and `mid:` mediaId.
 */

import { generateNormalizedVideoId } from '@src/utils/videoIdentity'
import { computeWatchProgress, durationMsForItem } from './progress'

/**
 * Durable content identity check ('mid:…', backend folder-derived). Rows may
 * also carry legacy client-sent ObjectId-hex mediaIds (doc _id) — those never
 * key catalog items' `mediaId` field and are excluded from identity keying.
 *
 * @param {*} id - Candidate mediaId value
 * @returns {boolean} True when the value is a 'mid:…' durable identity
 */
export function isDurableMediaId(id) {
  return typeof id === 'string' && id.startsWith('mid:')
}

/**
 * Every key under which this item's row could have been written, in
 * precedence order.
 *
 * @param {Object|null|undefined} item
 * @returns {string[]}
 */
export function candidateKeysForItem(item) {
  if (!item || typeof item !== 'object') return []
  const keys = []
  const push = (value) => {
    if (typeof value === 'string' && value && !keys.includes(value)) keys.push(value)
  }

  if (isDurableMediaId(item.mediaId)) push(item.mediaId)
  push(item.normalizedVideoId)

  const urls = [item.rawVideoURL, item.videoURL, item.jitUrl, item.episode?.videoURL]
  for (const url of urls) {
    if (typeof url !== 'string' || !url) continue
    try {
      push(generateNormalizedVideoId(url))
    } catch {
      // An unparseable URL simply contributes no hash key.
    }
  }
  for (const url of urls) push(url)
  return keys
}

/**
 * Resolve the watch data for one catalog item from a lookup map.
 *
 * @param {Object} item - catalog item (movie, episode, card, recently-watched record)
 * @param {Map<string, Object>} lookupMap - from buildWatchHistoryLookupMap
 * @returns {Object|null} the map's watch data, or null when no arm matches
 */
export function resolveWatchEntry(item, lookupMap) {
  if (!lookupMap || typeof lookupMap.get !== 'function' || lookupMap.size === 0) return null
  for (const key of candidateKeysForItem(item)) {
    const hit = lookupMap.get(key)
    if (hit) return hit
  }
  return null
}

/**
 * The `watchHistory` object every client receives — always the same shape,
 * whether or not a row matched. `isWatched` keeps its historical meaning
 * ("has any history"); `completed` and `progressPercent` are the fields to
 * render from.
 *
 * @param {Object} item - catalog item, for its duration and identity
 * @param {Object|null} watchData - resolveWatchEntry's result
 * @returns {Object}
 */
export function buildWatchHistoryObject(item, watchData) {
  const durationMs = durationMsForItem(item)
  if (!watchData) {
    return {
      playbackTime: 0,
      lastWatched: null,
      isWatched: false,
      completed: false,
      progressPercent: 0,
      normalizedVideoId: item?.normalizedVideoId ?? null,
      mediaId: isDurableMediaId(item?.mediaId) ? item.mediaId : null,
    }
  }
  const playbackTime = Number.isFinite(watchData.playbackTime) ? watchData.playbackTime : 0
  const { progressPercent, completed } = computeWatchProgress(playbackTime, durationMs)
  return {
    playbackTime,
    lastWatched: watchData.lastWatched ?? watchData.lastUpdated ?? null,
    isWatched: true,
    completed,
    progressPercent,
    normalizedVideoId: watchData.normalizedVideoId ?? item?.normalizedVideoId ?? null,
    mediaId: isDurableMediaId(watchData.mediaId)
      ? watchData.mediaId
      : isDurableMediaId(item?.mediaId)
        ? item.mediaId
        : null,
    // TV grouping, when the row carries it
    ...(watchData.showId && {
      showId: watchData.showId,
      seasonNumber: watchData.seasonNumber,
      episodeNumber: watchData.episodeNumber,
    }),
  }
}
