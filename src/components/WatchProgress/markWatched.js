/**
 * "Mark watched" for one episode, from the season page's action dialog.
 *
 * Writes go where every playback write goes: POST updatePlayback, with the
 * `kind` the viewer's own statement has in writeKinds ('mark') and the
 * position at the runtime, so the server's own 95% rule marks the row
 * complete. A mark is no player's report: it creates the row whatever the
 * position, carries no sessionId and opens no presence. The body's
 * mediaMetadata is what the web player sends (the document `_id`; the server
 * resolves its own durable `mid:`). Like every browser playback write it
 * names the user the page was rendered for, and the server refuses it when
 * the session has become someone else's (a sign-in in another tab:
 * src/lib/playbackUser.ts).
 *
 * On success the positions store is given the row from the save's answer
 * (the position sent and the server's `savedAt`), so every surface of this
 * tab flips at once, and the other tabs are told the title changed. No time
 * is made in the browser.
 *
 * Client-only (fetch); no React.
 */

import { playbackWriteHeaders } from '@src/lib/playbackUser'
import { playbackStore } from './playbackStore'

const UPDATE_ENDPOINT = '/api/authenticated/sync/updatePlayback'

function dropUndefined(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined))
}

const isDurable = (id) => typeof id === 'string' && id.startsWith('mid:')

/**
 * @param {Object} episode
 * @param {string|null} [episode._id] - the FlatEpisodes document id (what the player sends as mediaId)
 * @param {string|null} [episode.mediaId] - durable 'mid:…' identity
 * @param {string|null} [episode.normalizedVideoId] - the hash of the episode's file, as the server gave it
 * @param {string|null} episode.videoURL
 * @param {number|null} episode.durationMs
 * @param {string|null} [episode.showId]
 * @param {number} [episode.seasonNumber]
 * @param {number} [episode.episodeNumber]
 * @param {Object} page
 * @param {string|null} page.userId - the user the page was rendered for
 * @returns {Promise<{ playbackTime: number }>} the position written, in seconds
 * @throws {Error} 'This episode has no playable file' | 'Runtime unknown' |
 *   'This page was opened for another account. Reload it.' | 'Mark watched failed (<status>)'
 */
export async function markWatched(
  { _id = null, mediaId = null, normalizedVideoId = null, videoURL, durationMs, showId = null, seasonNumber, episodeNumber },
  { userId = null } = {}
) {
  if (!videoURL) throw new Error('This episode has no playable file')
  if (!(durationMs > 0)) throw new Error('Runtime unknown')

  const playbackTime = Math.round(durationMs / 1000)

  const res = await fetch(UPDATE_ENDPOINT, {
    method: 'POST',
    credentials: 'include',
    headers: playbackWriteHeaders(userId),
    body: JSON.stringify({
      videoId: videoURL,
      playbackTime,
      kind: 'mark',
      isPaused: true,
      mediaMetadata: dropUndefined({
        mediaType: 'tv',
        mediaId: _id || mediaId || undefined,
        showId: showId || undefined,
        seasonNumber,
        episodeNumber,
      }),
    }),
  })

  // Signed in as someone else since this page was rendered: reloading shows their page
  if (res.status === 409) throw new Error('This page was opened for another account. Reload it.')
  if (!res.ok) throw new Error(`Mark watched failed (${res.status})`)

  // The row as the server wrote it: `savedAt` is its lastUpdated, by the server's clock
  const answer = await res.json().catch(() => null)
  const title = { mediaId: isDurable(mediaId) ? mediaId : null, normalizedVideoId: normalizedVideoId || null }
  playbackStore.reportChanged({
    userId,
    keys: [title],
    saved: typeof answer?.savedAt === 'string' ? { ...title, playbackTime, savedAt: answer.savedAt } : null,
  })

  return { playbackTime }
}
