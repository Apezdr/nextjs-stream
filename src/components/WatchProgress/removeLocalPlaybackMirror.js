// What a key of the old mirror looked like: a durable id, or a video URL
const MIRROR_KEY = /^(mid:|https?:\/\/)/

/** Whether a stored value is a mirrored position: an object with a `playbackTime`. */
function holdsPosition(raw) {
  try {
    const value = JSON.parse(raw)
    return value !== null && typeof value === 'object' && !Array.isArray(value) && 'playbackTime' in value
  } catch {
    return false
  }
}

function browserStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    // Storage blocked for this origin: there is nothing of ours in it
    return null
  }
}

/**
 * Removes the playback positions that versions of the app before the
 * positions store (playbackStore.js) kept in the browser's storage: one entry
 * per title, `{ playbackTime, lastUpdated }`, under the title's durable id
 * ('mid:…') or its video URL. They named no user, so the next account on a
 * shared browser saw the last one's progress and resumed from it.
 *
 * Nothing reads those entries now, not even as a fallback. This only takes
 * them away, in every browser that loads the app, without anyone doing
 * anything:
 * - It removes a key only when it starts with `mid:`, `http://` or `https://`
 *   AND its value parses to an object with a `playbackTime` field. No other
 *   feature stores under those prefixes, and everything else is left alone
 *   (volume, captions, the list/grid choices, the Cast breadcrumb, …).
 * - It keeps no "done" flag: with nothing left to remove it does nothing. It
 *   runs on every load, so the entries a tab from before this change writes
 *   once more are gone on the next load.
 * - A storage that cannot be read or written (private mode, blocked) is not
 *   an error: it holds nothing to remove.
 *
 * @removeAtVersion 2026.10.0 Removal of the playback positions older versions
 *   kept in the browser's storage; delete this file, its call in
 *   src/components/providers/ClientProviders.js and its test
 *   (__tests__/watchHistory/removeLocalPlaybackMirror.test.js).
 * @param {Storage|null} [storage] - defaults to this browser's own
 * @returns {number} how many entries it removed
 */
export function removeLocalPlaybackMirror(storage = browserStorage()) {
  let removed = 0
  try {
    if (!storage) return 0
    // Collected first: removing while walking the index would skip entries
    const keys = []
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index)
      if (typeof key === 'string' && MIRROR_KEY.test(key) && holdsPosition(storage.getItem(key))) keys.push(key)
    }
    for (const key of keys) {
      storage.removeItem(key)
      removed += 1
    }
  } catch {
    // What could not be removed this time is tried again on the next load
  }
  return removed
}
