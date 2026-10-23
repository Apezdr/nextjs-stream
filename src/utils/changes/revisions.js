import { randomBytes } from 'node:crypto'
import { after } from 'next/server'

/**
 * Revision counters behind GET /api/authenticated/changes.
 *
 * Clients poll /changes (every few seconds) instead of refetching every list,
 * and refetch a list only when its stamp moves. A stamp is built from these
 * counters, so a poll costs the session check and a few memory reads, never a
 * list build. Every place that changes what a list shows bumps the matching
 * revision:
 *
 * - LIBRARY: the media library (sync, admin edits, wipe). Every list shows it.
 * - PLAYLISTS: any playlist or watchlist write, by anyone. One revision for
 *   all playlists: several writes (remove by item id, move, coming soon) don't
 *   know which playlists they touch, and writes are human-paced.
 * - watchHistoryRevision(userId): that person's playback.
 * - homeRowsRevision(userId): that person's home-screen rows.
 *
 * The counters live in this process. Production runs one nextjs-stream
 * instance; a second one would need them in a shared store. A restart starts a
 * new boot id, so every stamp changes and clients refetch once. They are kept
 * on globalThis so every route bundle shares one set.
 */

const STATE_KEY = Symbol.for('nextjs-stream.changes.revisions')

function state() {
  if (!globalThis[STATE_KEY]) {
    globalThis[STATE_KEY] = { boot: randomBytes(4).toString('hex'), counters: new Map() }
  }
  return globalThis[STATE_KEY]
}

export const REVISION = Object.freeze({
  LIBRARY: 'library',
  PLAYLISTS: 'playlists',
})

export const watchHistoryRevision = (userId) => `watch-history:${userId}`
export const homeRowsRevision = (userId) => `home-rows:${userId}`

/**
 * An opaque stamp over one or more revisions: it changes whenever any of them
 * is bumped, and on restart.
 * @param {...string} keys
 * @returns {string}
 */
export function stamp(...keys) {
  const { boot, counters } = state()
  return [boot, ...keys.map((key) => counters.get(key) ?? 0)].join('.')
}

/** Bumps a revision now. */
export function bumpRevision(key) {
  const { counters } = state()
  counters.set(key, (counters.get(key) ?? 0) + 1)
}

/**
 * Bumps a revision once the current request has finished. A cache tag that
 * the same request expired is applied when its handler returns, and after()
 * runs later still, so a client that refetches on the new stamp reads fresh
 * data rather than the copy being replaced. Outside a request (no after()
 * scope) it bumps now.
 */
export function bumpRevisionAfterResponse(key) {
  try {
    after(() => bumpRevision(key))
  } catch {
    bumpRevision(key)
  }
}
