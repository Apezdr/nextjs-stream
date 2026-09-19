/**
 * "Mark watched" for one episode, from the season page's action dialog.
 *
 * Writes go where every playback write goes: POST updatePlayback with a
 * `kind` from writeKinds ('seek' — a deliberate jump to the end) and the
 * position at the runtime, so the server's own 95% rule marks the row
 * complete. The body mirrors what the web player sends (mediaMetadata with
 * the document `_id`; the server resolves its own durable `mid:`).
 * `isPaused: true` and no sessionId keep it from opening a presence
 * heartbeat.
 *
 * On success the localStorage mirror is primed under the same keys
 * SyncClientWithServerWatched writes (the 'mid:' mediaId and the raw
 * videoURL), so useLiveProgress flips the row at once, and the per-title
 * SWR key is revalidated for any surface reading useWatchPosition.
 *
 * Client-only (fetch, localStorage); no React.
 */

import { mutate } from 'swr'

/** The SWR key useWatchPosition reads this title's position under. */
export const PLAYBACK_POSITION_KEY = (videoURL) => `/api/authenticated/sync/playback?videoId=${encodeURIComponent(videoURL)}`

const UPDATE_ENDPOINT = '/api/authenticated/sync/updatePlayback'

function dropUndefined(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined))
}

function writeMirror(key, value) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Private mode / quota: the server row still reaches the mirror on the next sync.
  }
}

/**
 * @param {Object} episode
 * @param {string|null} [episode._id] - the FlatEpisodes document id (what the player sends as mediaId)
 * @param {string|null} [episode.mediaId] - durable 'mid:…' identity, the mirror's preferred key
 * @param {string|null} episode.videoURL
 * @param {number|null} episode.durationMs
 * @param {string|null} [episode.showId]
 * @param {number} [episode.seasonNumber]
 * @param {number} [episode.episodeNumber]
 * @returns {Promise<{ playbackTime: number }>} the position written, in seconds
 * @throws {Error} 'This episode has no playable file' | 'Runtime unknown' | 'Mark watched failed (<status>)'
 */
export async function markWatched({ _id = null, mediaId = null, videoURL, durationMs, showId = null, seasonNumber, episodeNumber }) {
  if (!videoURL) throw new Error('This episode has no playable file')
  if (!(durationMs > 0)) throw new Error('Runtime unknown')

  const playbackTime = Math.round(durationMs / 1000)

  const res = await fetch(UPDATE_ENDPOINT, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      videoId: videoURL,
      playbackTime,
      kind: 'seek',
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

  if (!res.ok) throw new Error(`Mark watched failed (${res.status})`)

  const entry = JSON.stringify({ playbackTime, lastUpdated: new Date().toISOString() })
  if (typeof mediaId === 'string' && mediaId.startsWith('mid:')) writeMirror(mediaId, entry)
  writeMirror(videoURL, entry)

  await mutate(PLAYBACK_POSITION_KEY(videoURL))

  return { playbackTime }
}
