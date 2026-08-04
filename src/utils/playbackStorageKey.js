// Stable localStorage key for per-video client state (playback progress).
//
// Historically this state was keyed by the raw videoURL, but the serve layer
// now swaps videoURL between a direct file URL and a JIT manifest URL per
// request, and files get renamed/re-encoded — so URL keys fork user state.
// The backend-sourced content identity `mediaId` ('mid:…') survives all of
// that, so it is the preferred key; videoURL remains the fallback (exactly
// today's behavior) when identity is unresolved (mediaId null/absent).
//
// Client-safe, no imports. Server-side calls are harmless no-ops.

/**
 * Stable storage key for a media payload: mediaId ('mid:…') when resolved,
 * otherwise the raw videoURL (legacy behavior).
 *
 * @param {{ mediaId?: string|null, videoURL?: string|null }|null} media
 * @returns {string|null}
 */
export function getPlaybackStorageKey(media) {
  if (!media) return null
  return media.mediaId || media.videoURL || null
}

/**
 * Read `stableKey` from localStorage; on a miss, fall back to the legacy
 * videoURL key and migrate the value forward (write it under the stable key).
 * The legacy key is intentionally left in place — SyncClientWithServerWatched
 * still reads/writes/cleans URL-shaped keys against the server contract.
 *
 * Returns the raw stored string (callers parse), or null on a full miss.
 *
 * @param {string|null|undefined} stableKey
 * @param {string|null|undefined} legacyKey
 * @returns {string|null}
 */
export function readWithLegacyFallback(stableKey, legacyKey) {
  if (typeof window === 'undefined' || !stableKey) return null
  const value = window.localStorage.getItem(stableKey)
  if (value !== null) return value
  if (!legacyKey || legacyKey === stableKey) return null
  const legacyValue = window.localStorage.getItem(legacyKey)
  if (legacyValue === null) return null
  try {
    window.localStorage.setItem(stableKey, legacyValue)
  } catch {
    // Quota / private-mode write failure — the read still succeeds.
  }
  return legacyValue
}
