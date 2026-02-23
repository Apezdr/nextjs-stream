'use server'

import { createWatchHistoryLookupMap } from './watchHistoryUtils'

/**
 * Get watch history lookup map for a specific user
 * IMPORTANT: userId MUST be passed - this function never calls auth() to avoid issues in cached scopes
 *
 * @param {string|null|undefined} userId - User ID (pass null/undefined for unauthenticated users)
 * @returns {Promise<Map>} Watch history lookup map
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
 * @returns {Promise<number>} Watch time in seconds (0 if not watched)
 */
export async function getWatchTimeForVideo(videoURL: string, userId: string | null | undefined): Promise<number> {
  if (!videoURL) return 0
  
  try {
    const watchMap = await getCurrentUserWatchHistory(userId)
    const watchData = watchMap.get(videoURL)
    return watchData?.playbackTime ?? 0
  } catch (error) {
    console.error('[watchHistoryServerUtils] Error getting watch time:', error)
    return 0
  }
}

/**
 * Get watch history data for a specific video (current user) 
 * Server Component only
 * 
 * @param {string} videoURL - The video URL
 * @param {string|null|undefined} userId - User ID (pass null/undefined for unauthenticated users)
 * @returns {Promise<object|null>} Watch history object or null if not found
 */
export async function getWatchDataForVideo(videoURL: string, userId: string | null | undefined) {
  if (!videoURL) return null
  
  try {
    const watchMap = await getCurrentUserWatchHistory(userId)
    const watchData = watchMap.get(videoURL)
    
    if (!watchData) return null
    
    return {
      playbackTime: watchData.playbackTime || 0,
      lastWatched: watchData.lastWatched,
      isWatched: watchData.isWatched,
      normalizedVideoId: watchData.normalizedVideoId
    }
  } catch (error) {
    console.error('[watchHistoryServerUtils] Error getting watch data:', error)
    return null
  }
}

/**
 * Check if a video has been watched (> 0 playback time)
 * Server Component only
 * 
 * @param {string} videoURL - The video URL
 * @param {string|null|undefined} userId - User ID (pass null/undefined for unauthenticated users)
 * @returns {Promise<boolean>} True if watched
 */
export async function hasWatchedVideo(videoURL: string, userId: string | null | undefined): Promise<boolean> {
  const playbackTime = await getWatchTimeForVideo(videoURL, userId)
  return playbackTime > 0
}
