// `server-only`, NOT `'use server'`. These are plain server-component helpers
// (three importers, all server-rendered). The directive turned every export
// into a registered Server Action — callable by any client with a guessed
// userId, since none of them authenticate the caller — and they showed up in
// the production server-reference manifest under every /list/** page.
// `server-only` keeps them out of client bundles and makes an accidental
// client import a build error, without registering anything as callable.
import 'server-only'

import { createWatchHistoryLookupMap } from './watchHistoryUtils'
import { resolveWatchEntry, buildWatchHistoryObject } from '@src/utils/watchHistory/resolve'

/**
 * What the player pages hand in. A bare URL is still accepted (legacy
 * callers); an object lets the durable `mediaId` arm work, which is the
 * arm that survives a quality swap.
 */
type MediaLike =
  | string
  | {
      videoURL?: string | null
      rawVideoURL?: string | null
      jitUrl?: string | null
      mediaId?: string | null
      normalizedVideoId?: string | null
      duration?: number | null
      metadata?: { runtime?: number | null } | null
    }
  | null
  | undefined

function toItem(media: MediaLike) {
  if (!media) return null
  if (typeof media === 'string') return { videoURL: media }
  return media
}

/**
 * Resolve a media item's watch data from the lookup map through the shared
 * precedence (mediaId → nid → hashed URLs → raw URLs; see
 * watchHistory/resolve.js). The old URL-then-hash lookup here had no mediaId
 * arm, which is why the web player read 0 for a quality-swapped title that
 * the TV app resumed correctly — and then deleted the row with its first
 * heartbeat.
 */
function lookupWatchData(watchMap: Map<string, any>, media: MediaLike) {
  return resolveWatchEntry(toItem(media), watchMap)
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
 * @param {MediaLike} media - The video URL, or the media item (preferred)
 * @param {string|null|undefined} userId - User ID (pass null/undefined for unauthenticated users)
 * @returns {Promise<number>} Watch time in seconds (0 if not watched)
 */
export async function getWatchTimeForVideo(media: MediaLike, userId: string | null | undefined): Promise<number> {
  if (!media) return 0

  try {
    const watchMap = await getCurrentUserWatchHistory(userId)
    const watchData = lookupWatchData(watchMap, media)
    return watchData?.playbackTime ?? 0
  } catch (error) {
    console.error('[watchHistoryServerUtils] Error getting watch time:', error)
    return 0
  }
}

/**
 * Where the player should start for this media: the saved position, or 0
 * when the server considers the title completed (see watchHistory/progress.js)
 * so a finished title never reopens in its credits.
 *
 * @param {MediaLike} media - The media item (needs duration for completion)
 * @param {string|null|undefined} userId
 * @returns {Promise<number>} seconds
 */
export async function getResumePositionForMedia(media: MediaLike, userId: string | null | undefined): Promise<number> {
  const data = await getWatchDataForVideo(media, userId)
  if (!data) return 0
  return data.completed ? 0 : data.playbackTime || 0
}

/**
 * Get watch history data for a specific video (current user)
 * Server Component only
 *
 * @param {MediaLike} media - The video URL, or the media item (preferred)
 * @param {string|null|undefined} userId - User ID (pass null/undefined for unauthenticated users)
 * @returns {Promise<object|null>} Watch history object or null if not found
 */
export async function getWatchDataForVideo(media: MediaLike, userId: string | null | undefined) {
  if (!media) return null

  try {
    const watchMap = await getCurrentUserWatchHistory(userId)
    const watchData = lookupWatchData(watchMap, media)

    if (!watchData) return null

    return buildWatchHistoryObject(toItem(media), watchData)
  } catch (error) {
    console.error('[watchHistoryServerUtils] Error getting watch data:', error)
    return null
  }
}

/**
 * Check if a video has been watched (> 0 playback time)
 * Server Component only
 *
 * @param {MediaLike} media - The video URL, or the media item
 * @param {string|null|undefined} userId - User ID (pass null/undefined for unauthenticated users)
 * @returns {Promise<boolean>} True if watched
 */
export async function hasWatchedVideo(media: MediaLike, userId: string | null | undefined): Promise<boolean> {
  const playbackTime = await getWatchTimeForVideo(media, userId)
  return playbackTime > 0
}
