'use client'

import { useCallback, useSyncExternalStore } from 'react'
import { playbackStore, PENDING } from './playbackStore'
import { readProgress } from './progress'

const subscribeNothing = () => () => {}
const pendingTitle = () => PENDING

/**
 * What the positions store says about one title: one subscription, and a
 * render only when something about this title changed. Pending on the server
 * render and in the hydration render, so both agree.
 *
 * @param {string|null} mediaId - the durable 'mid:…' identity
 * @param {string|null} normalizedVideoId - the hash of the title's file, as the server gave it
 * @returns {ReturnType<typeof playbackStore.getTitle>}
 */
export function usePlaybackTitle(mediaId, normalizedVideoId) {
  const known = Boolean(mediaId || normalizedVideoId)
  const getSnapshot = useCallback(() => playbackStore.getTitle(mediaId, normalizedVideoId), [mediaId, normalizedVideoId])
  // A surface with no identity to look up (a show's card) subscribes to nothing, and so causes no request
  return useSyncExternalStore(known ? playbackStore.subscribe : subscribeNothing, getSnapshot, pendingTitle)
}

/**
 * Live watch progress for one title, on any surface.
 *
 * Two sources feed it. The server's `watchHistory` object arrives with the
 * payload that rendered the surface and is exact but frozen. The positions
 * store (playbackStore.js) holds what has happened since: the title playing
 * in a tab of this browser, one of the viewer's own sessions on another
 * device, or a newer row. Whichever the server wrote later wins, so a bar on
 * the landing page moves while the film plays on the television.
 *
 * The title is found by the ids the server handed the surface. A surface
 * that passes neither is given the ones in its `watchHistory` object.
 *
 * @param {Object} options
 * @param {Object|null} [options.watchHistory] - the server object, if the payload carried one
 * @param {string|null} [options.mediaId] - durable 'mid:…' identity
 * @param {string|null} [options.normalizedVideoId] - the hash of the title's file
 * @param {number|null} [options.durationMs]
 * @param {boolean} [options.enabled] - false skips the subscription entirely
 * @returns {ReturnType<typeof readProgress>}
 */
export default function useLiveProgress({
  watchHistory = null,
  mediaId = null,
  normalizedVideoId = null,
  durationMs = null,
  enabled = true,
}) {
  const title = usePlaybackTitle(
    enabled ? (mediaId ?? watchHistory?.mediaId ?? null) : null,
    enabled ? (normalizedVideoId ?? watchHistory?.normalizedVideoId ?? null) : null
  )
  return pickProgress({ watchHistory, entry: title.entry, durationMs })
}

/**
 * The newer of the server's object and the store's entry, as a progress
 * reading. Pure, so the rule is testable. Both times are the server's: the
 * object's `lastWatched`, and the entry's `at` (a row's `lastUpdated`, a
 * session's `positionAt`). No clock of this browser is compared.
 *
 * - What a tab of this browser is playing (`live`) is newer than anything
 *   rendered.
 * - Otherwise the entry wins only when it is dated later than the object, or
 *   the object holds no position; the server's exact `progressPercent` and
 *   `completed` are kept when the object wins.
 *
 * @param {Object} options
 * @param {Object|null} [options.watchHistory]
 * @param {{ source: 'live'|'presence'|'row', playbackTime: number, at?: number|null }|null} [options.entry]
 * @param {number|null} [options.durationMs]
 * @returns {ReturnType<typeof readProgress>}
 */
export function pickProgress({ watchHistory = null, entry = null, durationMs = null }) {
  if (!entry || !Number.isFinite(entry.playbackTime)) return readProgress({ watchHistory, durationMs })
  if (entry.source === 'live') return readProgress({ playbackTime: entry.playbackTime, durationMs })

  const hasServer = Number.isFinite(watchHistory?.playbackTime) && watchHistory.playbackTime > 0
  const serverAt = watchHistory?.lastWatched ? new Date(watchHistory.lastWatched).getTime() : NaN
  const entryAt = Number.isFinite(entry.at) && entry.at > 0 ? entry.at : null
  const entryIsNewer = !hasServer || (entryAt !== null && (!Number.isFinite(serverAt) || entryAt > serverAt))

  return entryIsNewer ? readProgress({ playbackTime: entry.playbackTime, durationMs }) : readProgress({ watchHistory, durationMs })
}
