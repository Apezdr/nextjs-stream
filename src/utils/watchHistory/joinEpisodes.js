/**
 * The viewer's watch history joined onto a list of episodes, for the show
 * and season pages. One read precedence (resolve.js) on every page; no
 * surface-local key rules.
 */

import { createWatchHistoryLookupMap, addWatchHistoryToItemsBounded } from '@src/utils/watchHistoryUtils'
import { resolveWatchEntry, buildWatchHistoryObject, isDurableMediaId } from '@src/utils/watchHistory/resolve'

/**
 * Every episode with its `watchHistory` object. No viewer → empty objects,
 * so the pages render "Not watched" rather than nothing. When every episode
 * carries a durable identity the join is one bounded query; legacy docs
 * without one fall back to the viewer's full lookup map.
 *
 * @param {Array<Object>} episodes - episode documents (mediaId, normalizedVideoId, videoURL, duration…)
 * @param {string|null|undefined} userId
 * @returns {Promise<Array<Object>>} the same episodes, each with `watchHistory`
 */
export async function joinEpisodeWatchHistory(episodes, userId) {
  const list = Array.isArray(episodes) ? episodes : []
  if (!userId) return list.map((ep) => ({ ...ep, watchHistory: buildWatchHistoryObject(ep, null) }))
  if (list.length === 0) return []
  if (list.every((ep) => isDurableMediaId(ep?.mediaId) || ep?.normalizedVideoId)) {
    return addWatchHistoryToItemsBounded(list, userId)
  }
  const map = await createWatchHistoryLookupMap(userId)
  return list.map((ep) => ({ ...ep, watchHistory: buildWatchHistoryObject(ep, resolveWatchEntry(ep, map)) }))
}

/**
 * The watch-history object reduced to primitives so it can cross into a
 * client component: a row's `showId` may be an ObjectId and `lastWatched`
 * a Date, neither of which serialises across the boundary.
 *
 * @param {Object|null|undefined} watchHistory
 * @returns {{ playbackTime: number, lastWatched: string|null, isWatched: boolean, completed: boolean, progressPercent: number, normalizedVideoId: string|null, mediaId: string|null }}
 */
export function plainWatchHistory(watchHistory) {
  const wh = watchHistory && typeof watchHistory === 'object' ? watchHistory : null
  const at = wh?.lastWatched ? new Date(wh.lastWatched) : null
  return {
    playbackTime: Number.isFinite(wh?.playbackTime) ? wh.playbackTime : 0,
    lastWatched: at && !Number.isNaN(at.getTime()) ? at.toISOString() : null,
    isWatched: Boolean(wh?.isWatched),
    completed: Boolean(wh?.completed),
    progressPercent: Number.isFinite(wh?.progressPercent) ? wh.progressPercent : 0,
    normalizedVideoId: typeof wh?.normalizedVideoId === 'string' ? wh.normalizedVideoId : null,
    mediaId: typeof wh?.mediaId === 'string' ? wh.mediaId : null,
  }
}
