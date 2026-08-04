/**
 * Server-side resolution of a WatchHistory row's durable content identity.
 *
 * The P5 cutover keys watch history on the backend-sourced `mediaId`
 * ("mid:…", folder-derived, rename/re-encode-proof) instead of the URL-hash
 * `normalizedVideoId`. Clients keep reporting played URLs — the SERVER
 * resolves nid → catalog doc → mediaId at write time, so neither the web
 * player nor the RN app needs a contract change.
 *
 * Heartbeats arrive at ~1Hz per active web player, so the resolve is cached
 * module-level: positive hits for 10 minutes (catalog identity changes at
 * sync cadence, not request cadence), misses for 60 seconds (a miss is
 * usually "sync hasn't ingested this title's mediaId yet" and should retry
 * soon). Bounded to ~500 entries — insertion-order eviction is fine at this
 * library scale.
 *
 * Fail-open by construction: any error returns null and the row simply
 * lacks mediaId until a later heartbeat or the backfill supplies it. Never
 * synthesize an id from a URL or title.
 */

import clientPromise from '@src/lib/mongodb'
import { createLogger } from '@src/lib/logger'

const log = createLogger('WatchHistory.MediaIdResolver')

const POSITIVE_TTL_MS = 10 * 60_000
const NEGATIVE_TTL_MS = 60_000
const MAX_ENTRIES = 500

/** nid -> { mediaId: string|null, mediaType: 'movie'|'tv'|null, expiresAt } */
const cache = new Map()

/**
 * @param {string} normalizedVideoId
 * @returns {Promise<{ mediaId: string, mediaType: 'movie'|'tv' } | null>}
 */
export async function resolveMediaIdForNid(normalizedVideoId) {
  if (!normalizedVideoId) return null

  const cached = cache.get(normalizedVideoId)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.mediaId ? { mediaId: cached.mediaId, mediaType: cached.mediaType } : null
  }

  let result = null
  try {
    const client = await clientPromise
    const db = client.db('Media')
    const projection = { projection: { mediaId: 1 } }

    const movie = await db
      .collection('FlatMovies')
      .findOne({ normalizedVideoId }, projection)
    if (movie?.mediaId) {
      result = { mediaId: movie.mediaId, mediaType: 'movie' }
    } else {
      const episode = await db
        .collection('FlatEpisodes')
        .findOne({ normalizedVideoId }, projection)
      if (episode?.mediaId) {
        result = { mediaId: episode.mediaId, mediaType: 'tv' }
      }
    }
  } catch (error) {
    // Resolution is best-effort; the write path must never fail on it.
    log.warn({ error, normalizedVideoId }, 'mediaId resolve failed — row will lack mediaId this beat')
    return null
  }

  if (cache.size >= MAX_ENTRIES) {
    cache.delete(cache.keys().next().value)
  }
  cache.set(normalizedVideoId, {
    mediaId: result?.mediaId ?? null,
    mediaType: result?.mediaType ?? null,
    expiresAt: Date.now() + (result ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS),
  })

  return result
}

/** Test hook. */
export function _resetMediaIdResolverCacheForTests() {
  cache.clear()
}
