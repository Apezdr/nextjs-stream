/**
 * Media Fetching Helpers
 *
 * What the player and not-found views fetch beside the page's own cached
 * fetch (src/utils/cache/mediaFetching.js). Uses React's cache() so a render
 * that asks twice queries once.
 */

import { cache } from 'react'
import { getFlatRequestedMedia } from '@src/utils/flatDatabaseUtils'

// One lookup per render for the same show and viewer
const getCachedRequestedMedia = cache(getFlatRequestedMedia)

// Create a cached version of video URL validation to avoid repeated HEAD requests.
// Timeout-bounded: a slow origin must degrade to "assume playable and let the
// player's own load be the real test", never hang the server render.
const PREFLIGHT_TIMEOUT_MS = 4000
const getCachedVideoValidation = cache(async (url) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PREFLIGHT_TIMEOUT_MS)
  try {
    const response = await fetch(url, { method: 'HEAD', signal: controller.signal })
    return response.ok
  } catch (error) {
    // Timeout/abort ≠ proven-dead: fail open so the player still tries.
    // A genuinely dead URL fails visibly in the player either way.
    return error?.name === 'AbortError'
  } finally {
    clearTimeout(timer)
  }
})

/**
 * Validate video URL with HEAD request
 *
 * @param {string} url - Video URL to validate
 * @returns {Promise<boolean>} Whether the video URL is accessible
 */
export async function validateVideoURL(url) {
  if (!url) return false

  // NEVER preflight a JIT manifest URL. The transcoder's first master
  // request for a large direct-play-eligible source can block on a one-time
  // keyframe scan (minutes for a big remux) — a HEAD here would misreport a
  // warming service as dead. The player's manifest GET is the real test,
  // and the serve layer already health-checked the transcoder.
  if (/\.m3u8($|\?)/i.test(url)) return true

  return await getCachedVideoValidation(url)
}

/**
 * Fetch contextual media for error pages
 * Used to show available seasons when a specific season/episode isn't found
 *
 * @param {string} mediaTitle - TV show title
 * @param {import('@src/lib/roles/libraryScope').LibraryAccess} access - The viewer's library access:
 *   a show outside it has no context to show
 * @returns {Promise<Object|null>} Show data with seasons or null
 */
export async function fetchContextualMediaForError(mediaTitle, access) {
  try {
    return await getCachedRequestedMedia({
      access,
      type: 'tv',
      title: mediaTitle,
    })
  } catch (error) {
    console.error('Error fetching contextual media:', error)
    return null
  }
}
