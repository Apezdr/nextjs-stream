'use server'

import { createWatchHistoryLookupMap } from './lookupMap'

/**
 * Get watch history lookup map for a specific user
 * Server Component only - uses React cache() for per-request deduplication
 * 
 * IMPORTANT: userId MUST be passed - this function never calls auth() to avoid issues in cached scopes
 *
 * @param {string|null|undefined} userId - User ID (pass null/undefined for unauthenticated users)
 * @returns {Promise<Map>} Watch history lookup map (normalizedVideoId -> data)
 */
export async function getCurrentUserWatchHistory(userId: string | null | undefined) {
  try {
    if (!userId) {
      // No user ID provided - return empty map
      return new Map()
    }

    return await createWatchHistoryLookupMap(userId)
  } catch (error) {
    console.error('[watchHistoryServerUtils] Error fetching watch history:', error)
    return new Map() // Return empty map on error for graceful degradation
  }
}

/**
 * Get watch time in seconds for a specific video (current user)
 * Server Component only
 * 
 * @param {string} videoURL - The video URL
 * @param {string|null|undefined} userId - User ID (pass null/undefined for unauthenticated users)
 * @returns {Promise<number>} Watch time in seconds, or 0 if not found
 */
export async function getWatchTimeForVideo(
  videoURL: string,
  userId: string | null | undefined
): Promise<number> {
  try {
    if (!userId || !videoURL) {
      return 0
    }

    const watchHistory = await getCurrentUserWatchHistory(userId)
    if (!watchHistory || watchHistory.size === 0) {
      return 0
    }

    // lookupMap uses normalizedVideoId as key, createWatchHistoryLookupMap handles this
    for (const [_, data] of watchHistory) {
      if (data.videoId === videoURL) {
        return Math.round(data.playbackTime || 0)
      }
    }

    return 0
  } catch (error) {
    console.error('[getWatchTimeForVideo] Error:', error)
    return 0
  }
}

/**
 * Determine if a video has been watched by the user (any amount)
 * Server Component only
 * 
 * @param {string} videoURL - The video URL
 * @param {string|null|undefined} userId - User ID
 * @returns {Promise<boolean>} True if user has any watch history for this video
 */
export async function hasUserWatchedVideo(
  videoURL: string,
  userId: string | null | undefined
): Promise<boolean> {
  const watchTime = await getWatchTimeForVideo(videoURL, userId)
  return watchTime > 0
}
