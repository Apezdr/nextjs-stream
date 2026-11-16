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
 *
 * The per-title read (GET /api/authenticated/sync/playback) also asks the
 * other way round, from a durable id to the title's current file and runtime
 * (resolveTitleForMediaId), under the same cache rules.
 */

import clientPromise from '@src/lib/mongodb'
import { createLogger } from '@src/lib/logger'
import { durationMsForItem } from '@src/utils/watchHistory/progress'

const log = createLogger('WatchHistory.MediaIdResolver')

const POSITIVE_TTL_MS = 10 * 60_000
const NEGATIVE_TTL_MS = 60_000
const MAX_ENTRIES = 500

/**
 * nid -> { mediaId: string|null, mediaType: 'movie'|'tv'|null, durationMs: number|null,
 *          showId: ObjectId|null, seasonNumber: number|null, episodeNumber: number|null,
 *          expiresAt }
 */
const cache = new Map()

/** mediaId -> { title: object|null, expiresAt } */
const titleCache = new Map()

// The catalog fields a resolution reads: the two identities, and what
// durationMsForItem takes the runtime from
const MOVIE_FIELDS = { mediaId: 1, normalizedVideoId: 1, duration: 1, length: 1, 'metadata.runtime': 1 }
const EPISODE_FIELDS = { ...MOVIE_FIELDS, showId: 1, seasonNumber: 1, episodeNumber: 1 }

const wholeNumber = (value) => (Number.isInteger(value) ? value : null)

/**
 * The movie or episode one identity field names, as a resolution. The runtime
 * is the one every list join computes with (durationMsForItem): the file's
 * `duration`, else TMDB's `metadata.runtime`. With the file's alone, a title
 * whose runtime is known only from TMDB read as finished on a list and as
 * unfinished here.
 *
 * @param {import('mongodb').Db} db
 * @param {{ normalizedVideoId: string } | { mediaId: string }} identity
 */
async function findCatalogTitle(db, identity) {
  const movie = await db.collection('FlatMovies').findOne(identity, { projection: MOVIE_FIELDS })
  if (movie?.mediaId) {
    return {
      mediaId: movie.mediaId,
      mediaType: 'movie',
      normalizedVideoId: movie.normalizedVideoId ?? null,
      durationMs: durationMsForItem(movie),
      showId: null,
      seasonNumber: null,
      episodeNumber: null,
    }
  }
  const episode = await db.collection('FlatEpisodes').findOne(identity, { projection: EPISODE_FIELDS })
  if (episode?.mediaId) {
    return {
      mediaId: episode.mediaId,
      mediaType: 'tv',
      normalizedVideoId: episode.normalizedVideoId ?? null,
      durationMs: durationMsForItem(episode),
      showId: episode.showId ?? null,
      seasonNumber: wholeNumber(episode.seasonNumber),
      episodeNumber: wholeNumber(episode.episodeNumber),
    }
  }
  return null
}

function remember(map, key, entry, found) {
  if (map.size >= MAX_ENTRIES) {
    map.delete(map.keys().next().value)
  }
  map.set(key, { ...entry, expiresAt: Date.now() + (found ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS) })
}

/**
 * @param {string} normalizedVideoId
 * @returns {Promise<{ mediaId: string, mediaType: 'movie'|'tv', durationMs: number|null, showId: ObjectId|null,
 *   seasonNumber: number|null, episodeNumber: number|null } | null>}
 *   `durationMs` is the catalog runtime, carried along so callers that hold a
 *   position can compute completion without a second lookup. `showId`,
 *   `seasonNumber` and `episodeNumber` place an episode in its catalog show
 *   (FlatEpisodes); all null for a movie.
 */
export async function resolveMediaIdForNid(normalizedVideoId) {
  if (!normalizedVideoId) return null

  const cached = cache.get(normalizedVideoId)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.mediaId
      ? {
          mediaId: cached.mediaId,
          mediaType: cached.mediaType,
          durationMs: cached.durationMs ?? null,
          showId: cached.showId ?? null,
          seasonNumber: cached.seasonNumber ?? null,
          episodeNumber: cached.episodeNumber ?? null,
        }
      : null
  }

  let result = null
  try {
    const client = await clientPromise
    const title = await findCatalogTitle(client.db('Media'), { normalizedVideoId })
    if (title) {
      const { normalizedVideoId: _nid, ...resolution } = title
      result = resolution
    }
  } catch (error) {
    // Resolution is best-effort; the write path must never fail on it.
    log.warn({ error, normalizedVideoId }, 'mediaId resolve failed — row will lack mediaId this beat')
    return null
  }

  remember(
    cache,
    normalizedVideoId,
    {
      mediaId: result?.mediaId ?? null,
      mediaType: result?.mediaType ?? null,
      durationMs: result?.durationMs ?? null,
      showId: result?.showId ?? null,
      seasonNumber: result?.seasonNumber ?? null,
      episodeNumber: result?.episodeNumber ?? null,
    },
    Boolean(result)
  )

  return result
}

/**
 * The catalog title a durable id names: the hash of the file it plays today,
 * and its runtime. For a read that is asked by `mediaId`, which has no URL to
 * hash: it finds a row written under the title's current file but never
 * stamped with the id, and gives the runtime the completion flag needs.
 *
 * Fail-open like the resolver above: an error or an unknown id is null, and
 * the caller reads without it.
 *
 * @param {string} mediaId - a durable 'mid:…' id
 * @returns {Promise<{ mediaId: string, mediaType: 'movie'|'tv', normalizedVideoId: string|null,
 *   durationMs: number|null } | null>}
 */
export async function resolveTitleForMediaId(mediaId) {
  if (typeof mediaId !== 'string' || !mediaId.startsWith('mid:')) return null

  const cached = titleCache.get(mediaId)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.title ? { ...cached.title } : null
  }

  let title = null
  try {
    const client = await clientPromise
    const found = await findCatalogTitle(client.db('Media'), { mediaId })
    if (found) {
      title = {
        mediaId: found.mediaId,
        mediaType: found.mediaType,
        normalizedVideoId: found.normalizedVideoId,
        durationMs: found.durationMs,
      }
    }
  } catch (error) {
    log.warn({ error, mediaId }, 'Title resolve by mediaId failed — the read goes on without the catalog')
    return null
  }

  remember(titleCache, mediaId, { title }, Boolean(title))

  return title ? { ...title } : null
}

/** Test hook. */
export function _resetMediaIdResolverCacheForTests() {
  cache.clear()
  titleCache.clear()
}
