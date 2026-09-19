'use client'

import { useCallback, useSyncExternalStore } from 'react'
import { getPlaybackStorageKey } from '@src/utils/playbackStorageKey'
import { readProgress } from './progress'

/** How often the localStorage mirror is re-read; matches SyncClientWithServerWatched's poll. */
export const MIRROR_TICK_MS = 5000

/**
 * Live watch progress for one title, on any surface.
 *
 * Two sources feed it. The server's `watchHistory` object arrives with the
 * payload that rendered the surface and is exact but frozen. localStorage is
 * kept current by two writers: the player, every second, for whatever is
 * playing in this browser, and SyncClientWithServerWatched, every five
 * seconds, mirroring the server's rows — including rows the TV app is
 * writing right now. Whichever of the two is newer wins, so a bar on the
 * landing page moves while the film plays on the Shield.
 *
 * localStorage is read through useSyncExternalStore: the snapshot is the raw
 * stored string (stable by value), re-read on a five-second tick, on focus,
 * and on cross-tab storage events. No render-time side effects, no state.
 *
 * @param {Object} options
 * @param {Object|null} [options.watchHistory] - the server object, if the payload carried one
 * @param {string|null} [options.mediaId] - durable 'mid:…' identity (the mirror's preferred key)
 * @param {string|null} [options.videoURL] - legacy key
 * @param {number|null} [options.durationMs]
 * @param {boolean} [options.enabled] - false skips the subscription entirely
 * @returns {ReturnType<typeof readProgress>}
 */
export default function useLiveProgress({
  watchHistory = null,
  mediaId = null,
  videoURL = null,
  durationMs = null,
  enabled = true,
}) {
  const stableKey = enabled ? getPlaybackStorageKey({ mediaId, videoURL }) : null
  const legacyKey = enabled && videoURL && videoURL !== stableKey ? videoURL : null

  const subscribe = useCallback(
    (onChange) => {
      if (!stableKey || typeof window === 'undefined') return () => {}
      const id = setInterval(onChange, MIRROR_TICK_MS)
      window.addEventListener('focus', onChange)
      window.addEventListener('storage', onChange)
      return () => {
        clearInterval(id)
        window.removeEventListener('focus', onChange)
        window.removeEventListener('storage', onChange)
      }
    },
    [stableKey]
  )

  const getSnapshot = useCallback(() => readRawEntry(stableKey, legacyKey), [stableKey, legacyKey])

  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const local = parseLocalEntry(raw)

  return pickLiveProgress({ watchHistory, local, durationMs })
}

function getServerSnapshot() {
  return null
}

function readRawEntry(stableKey, legacyKey) {
  if (!stableKey || typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(stableKey) ?? (legacyKey ? window.localStorage.getItem(legacyKey) : null)
  } catch {
    return null
  }
}

/**
 * @param {string|null} raw - the stored JSON string
 * @returns {{ playbackTime: number, lastUpdated: number|null }|null}
 */
export function parseLocalEntry(raw) {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    const playbackTime = parseFloat(parsed?.playbackTime)
    if (!Number.isFinite(playbackTime) || playbackTime <= 0) return null
    const lastUpdated = parsed?.lastUpdated ? new Date(parsed.lastUpdated).getTime() : NaN
    return { playbackTime, lastUpdated: Number.isFinite(lastUpdated) ? lastUpdated : null }
  } catch {
    return null
  }
}

/**
 * The newer of the server's object and the local entry, as a progress reading.
 * Pure, so the rule is testable: local wins only when it carries a timestamp
 * newer than the server's (or the server has none); otherwise the server's
 * exact `progressPercent` / `completed` are kept.
 */
export function pickLiveProgress({ watchHistory = null, local = null, durationMs = null }) {
  const serverTime = Number.isFinite(watchHistory?.playbackTime) ? watchHistory.playbackTime : 0
  const serverAt = watchHistory?.lastWatched ? new Date(watchHistory.lastWatched).getTime() : NaN
  const hasServer = serverTime > 0
  const hasLocal = Boolean(local && local.playbackTime > 0)

  if (hasLocal && (!hasServer || (local.lastUpdated !== null && (!Number.isFinite(serverAt) || local.lastUpdated > serverAt)))) {
    return readProgress({ playbackTime: local.playbackTime, durationMs })
  }
  return readProgress({ watchHistory, durationMs })
}
