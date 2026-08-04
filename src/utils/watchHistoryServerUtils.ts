'use server'

import { createWatchHistoryLookupMap } from './watchHistoryUtils'
import { generateNormalizedVideoId } from '@src/utils/videoIdentity'

/**
 * Resolve a video's watch data from the lookup map: exact URL key first
 * (row.videoId === videoURL), then the normalized id (nid). The nid arm heals
 * URL-shape mismatches — e.g. a row written while playing through the JIT
 * transcoder canonicalizes to the same nid as the source videoURL, so the
 * saved position is found instead of reading 0.
 */
function lookupWatchData(watchMap: Map<string, any>, videoURL: string) {
  const direct = watchMap.get(videoURL)
  if (direct) return direct

  const normalizedVideoId = generateNormalizedVideoId(videoURL)
  return normalizedVideoId ? watchMap.get(normalizedVideoId) : undefined
}

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
    const watchData = lookupWatchData(watchMap, videoURL)
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
    const watchData = lookupWatchData(watchMap, videoURL)

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
