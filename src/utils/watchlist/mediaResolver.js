import 'server-only'

/**
 * Simplified Media Resolver
 *
 * Uses React's cache() for proper request-scoped memoization.
 * Replaced manual Map cache with React Server Components best practices.
 */

import { cache } from 'react'
import clientPromise from '@src/lib/mongodb'
import { getFullImageUrl } from '@src/utils'
import { isTmdbNotFound, missingFromLibraryMedia, missingFromTmdbMedia } from './tmdbMissing.js'
import { fetchTmdbFromBackend } from '@src/utils/tmdb/backendClient'
import { mediaLinkKey } from '@src/utils/media/urlParser'
import { libraryMovieFilter, libraryShowFilter } from '@src/utils/mediaVisibility'
import { assertLibraryAccess } from '@src/lib/roles/libraryScope'
import { isLibraryMediaId, titleKey } from './playlistMerge.js'
import { createLogger, logError } from '@src/lib/logger'

const log = createLogger('MediaResolver')

// A title's key in every map and set here: TMDB ids repeat across media types
// (movie 1399 and show 1399 are different titles), so the type is part of it.
// A title with no TMDB id is asked for, and answered, under its library id.
const keyOf = (mediaType, tmdbId) => titleKey({ mediaType, tmdbId })
const libraryKeyOf = (mediaType, libraryMediaId) => titleKey({ mediaType, libraryMediaId })

// Asked for by library id: a title with no TMDB id
const byLibraryId = (item) => item.tmdbId == null && isLibraryMediaId(item.libraryMediaId)

const LIBRARY_COLLECTION = { movie: 'FlatMovies', tv: 'FlatTVShows' }

// What a resolved library title is built from
const SHARED_PROJECTION = {
  _id: 1,
  mediaId: 1,
  title: 1,
  originalTitle: 1,
  posterURL: 1,
  posterBlurhash: 1,
  backdrop: 1,
  backdropBlurhash: 1,
  'metadata.id': 1,
  'metadata.poster_path': 1,
  'metadata.backdrop_path': 1,
  'metadata.overview': 1,
  'metadata.genres': 1,
  'metadata.vote_average': 1,
}
const LIBRARY_PROJECTION = {
  movie: { ...SHARED_PROJECTION, 'metadata.release_date': 1 },
  tv: { ...SHARED_PROJECTION, 'metadata.first_air_date': 1 },
}

/**
 * The library titles asked for, by TMDB id or by library id, among the ones
 * the viewer can see. Web-hidden titles are left out, so they resolve as if
 * the library didn't have them. Same visibility rule as getUserWatchlist's
 * availability check: the two must agree, or items oscillate.
 */
async function findLibraryTitles(db, mediaType, { tmdbIds, libraryMediaIds }, access) {
  const asked = []
  if (tmdbIds.length > 0) asked.push({ 'metadata.id': { $in: tmdbIds } })
  if (libraryMediaIds.length > 0) asked.push({ mediaId: { $in: libraryMediaIds } })
  if (asked.length === 0) return []

  const visible = mediaType === 'movie' ? libraryMovieFilter(access) : libraryShowFilter(access)
  return db
    .collection(LIBRARY_COLLECTION[mediaType])
    .find({ $and: [asked.length === 1 ? asked[0] : { $or: asked }, visible] }, { projection: LIBRARY_PROJECTION[mediaType] })
    .toArray()
}

/** A library title as resolved media. */
function libraryMedia(document, mediaType) {
  const { metadata } = document
  return {
    tmdbId: metadata?.id ?? null,
    mediaType,
    currentMediaId: document._id.toString(),
    title: document.title,
    originalTitle: document.originalTitle || null,
    posterURL: document.posterURL || (metadata?.poster_path
      ? getFullImageUrl(metadata.poster_path, 'w500')
      : '/sorry-image-not-available.jpg'),
    posterBlurhash: document.posterBlurhash,
    backdropURL: document.backdrop || (metadata?.backdrop_path
      ? getFullImageUrl(metadata.backdrop_path, 'original')
      : null),
    backdropBlurhash: document.backdropBlurhash,
    overview: metadata?.overview,
    releaseDate: mediaType === 'movie' ? metadata?.release_date : metadata?.first_air_date,
    genres: metadata?.genres || [],
    voteAverage: metadata?.vote_average,
    isInternal: true,
    url: `/list/${mediaType}/${encodeURIComponent(mediaLinkKey(document))}`,
    link: encodeURIComponent(mediaLinkKey(document))
  }
}

/**
 * Internal implementation (not cached) - does the actual work
 */
async function batchResolveMediaInternal(items, options = {}) {
  let { precomputedAvailability = null, authHeaders = null } = options
  // The viewer's library access: a title outside it resolves as if the library
  // didn't have it (a TMDB-only card, nothing that plays)
  const { access } = options
  assertLibraryAccess(access)

  // Convert Array back to Set if needed (from JSON deserialization)
  if (precomputedAvailability && Array.isArray(precomputedAvailability)) {
    precomputedAvailability = new Set(precomputedAvailability)
  }

  log.debug({ itemCount: items.length }, 'Resolving media batch')

  const results = new Map()
  const uniqueItems = new Map()

  // Deduplicate items
  for (const item of items) {
    const key = titleKey(item)
    if (!uniqueItems.has(key)) {
      uniqueItems.set(key, item)
    }
  }

  const itemsArray = Array.from(uniqueItems.values())

  // What to ask the library for, by media type. With pre-computed availability
  // (an optimization that avoids duplicate queries), only the titles already
  // known to be there are asked for.
  const wanted = {
    movie: { tmdbIds: [], libraryMediaIds: [] },
    tv: { tmdbIds: [], libraryMediaIds: [] },
  }
  for (const item of itemsArray) {
    const side = wanted[item.mediaType]
    if (!side) continue
    if (precomputedAvailability && !precomputedAvailability.has(titleKey(item))) continue
    if (byLibraryId(item)) {
      side.libraryMediaIds.push(item.libraryMediaId)
    } else if (Number.isFinite(parseInt(item.tmdbId))) {
      side.tmdbIds.push(parseInt(item.tmdbId))
    }
  }

  let movies = []
  let tvShows = []
  const anythingWanted = Object.values(wanted).some(
    (side) => side.tmdbIds.length > 0 || side.libraryMediaIds.length > 0
  )
  if (anythingWanted) {
    const client = await clientPromise
    const db = client.db('Media')
    ;[movies, tvShows] = await Promise.all([
      findLibraryTitles(db, 'movie', wanted.movie, access),
      findLibraryTitles(db, 'tv', wanted.tv, access),
    ])
  }

  // Process internal media (available in our library)
  const foundKeys = new Set()

  for (const [mediaType, documents] of [['movie', movies], ['tv', tvShows]]) {
    const askedLibraryIds = new Set(wanted[mediaType].libraryMediaIds)
    for (const document of documents) {
      const media = libraryMedia(document, mediaType)
      if (media.tmdbId) {
        foundKeys.add(keyOf(mediaType, media.tmdbId))
        results.set(keyOf(mediaType, media.tmdbId), media)
      }
      if (askedLibraryIds.has(document.mediaId)) {
        const key = libraryKeyOf(mediaType, document.mediaId)
        foundKeys.add(key)
        // Carries the TMDB id the title has been given since it was added, if
        // any: the item's cue to move to the TMDB key (promoteToTmdbKey)
        results.set(key, { ...media, libraryMediaId: document.mediaId })
      }
    }
  }

  // A title asked for by library id that the library doesn't have has nowhere
  // else to come from: it resolves to the placeholder that says so. The query
  // above ran and didn't find it; a query that fails throws instead.
  for (const item of itemsArray) {
    if (byLibraryId(item) && !foundKeys.has(titleKey(item))) {
      results.set(titleKey(item), missingFromLibraryMedia(item.libraryMediaId, item.mediaType))
    }
  }

  // For items not found in our library, fetch directly from TMDB
  const externalItems = itemsArray.filter(item => !byLibraryId(item) && !foundKeys.has(keyOf(item.mediaType, item.tmdbId)))
  
  if (externalItems.length > 0) {
    log.debug({ externalCount: externalItems.length }, 'Fetching external items from TMDB')
    
    // Use cached TMDB fetching per item to avoid duplicate API calls within the same request
    const tmdbPromises = externalItems.map(item => getCachedTMDBDetails(parseInt(item.tmdbId), item.mediaType, authHeaders))
    const tmdbResults = await Promise.allSettled(tmdbPromises)
    
    // Process results
    externalItems.forEach((item, index) => {
      const tmdbId = parseInt(item.tmdbId)
      const result = tmdbResults[index]
      
      if (result.status === 'fulfilled' && result.value) {
        const tmdbData = result.value
        
        const mediaData = {
          tmdbId,
          mediaType: item.mediaType,
          currentMediaId: null,
          title: tmdbData.title || tmdbData.name,
          posterURL: tmdbData.poster_path
            ? getFullImageUrl(tmdbData.poster_path, 'w500')
            : '/sorry-image-not-available.jpg',
          posterBlurhash: tmdbData.poster_blurhash,
          backdropURL: tmdbData.backdrop_path
            ? getFullImageUrl(tmdbData.backdrop_path, 'original')
            : null,
          backdropBlurhash: tmdbData.backdrop_blurhash,
          overview: tmdbData.overview,
          releaseDate: tmdbData.release_date || tmdbData.first_air_date,
          genres: tmdbData.genres || [],
          voteAverage: tmdbData.vote_average,
          isInternal: false,
          isExternal: true,
          url: null,
          link: null,
          // Store complete TMDB metadata for rich display
          tmdbMetadata: {
            // Core identifiers
            id: tmdbData.id,
            imdb_id: tmdbData.imdb_id || null,
            
            // Basic info
            title: tmdbData.title || tmdbData.name,
            original_title: tmdbData.original_title || tmdbData.original_name || null,
            original_language: tmdbData.original_language || null,
            tagline: tmdbData.tagline || null,
            overview: tmdbData.overview || null,
            
            // Dates
            release_date: tmdbData.release_date || null,
            first_air_date: tmdbData.first_air_date || null,
            
            // Media
            poster_path: tmdbData.poster_path || null,
            backdrop_path: tmdbData.backdrop_path || null,
            
            // Ratings
            vote_average: tmdbData.vote_average || 0,
            vote_count: tmdbData.vote_count || 0,
            popularity: tmdbData.popularity || 0,
            
            // Classification
            genres: tmdbData.genres || [],
            status: tmdbData.status || null,
            adult: tmdbData.adult || false,
            
            // Production (movies)
            budget: tmdbData.budget || null,
            revenue: tmdbData.revenue || null,
            runtime: tmdbData.runtime || null,
            production_companies: tmdbData.production_companies || [],
            production_countries: tmdbData.production_countries || [],
            spoken_languages: tmdbData.spoken_languages || [],
            belongs_to_collection: tmdbData.belongs_to_collection || null,
            
            // TV-specific
            number_of_seasons: tmdbData.number_of_seasons || null,
            number_of_episodes: tmdbData.number_of_episodes || null,
            episode_run_time: tmdbData.episode_run_time || [],
            networks: tmdbData.networks || [],
            origin_country: tmdbData.origin_country || [],
            
            // Cast and crew - transform with full image URLs
            cast: (tmdbData.cast || []).map(castMember => ({
              ...castMember,
              profile_path: castMember.profile_path ? (
                castMember.profile_path.startsWith('https://')
                  ? castMember.profile_path
                  : `https://image.tmdb.org/t/p/original${castMember.profile_path}`
              ) : null
            })),
            
            // Links and media
            homepage: tmdbData.homepage || null,
            trailer_url: tmdbData.trailer_url || null,
            logo_path: tmdbData.logo_path ?? null,
            rating: tmdbData.rating || null,
            
            // Additional metadata
            video: tmdbData.video || false
          }
        }
        
        results.set(keyOf(item.mediaType, tmdbId), mediaData)
      } else if (result.status === 'rejected' && isTmdbNotFound(result.reason)) {
        // TMDB has no such title (the media processor's 404): label it rather
        // than leave it unresolved, where it showed as "Unknown Title"
        log.warn({ mediaType: item.mediaType, tmdbId: item.tmdbId }, 'Title is no longer on TMDB')
        results.set(keyOf(item.mediaType, tmdbId), missingFromTmdbMedia(tmdbId, item.mediaType))
      } else {
        logError(log, result.reason, { context: 'Failed to fetch TMDB data', mediaType: item.mediaType, tmdbId: item.tmdbId })
      }
    })
  }

  return results
}

/**
 * Cached TMDB details fetching - uses React cache() with primitives for proper memoization
 * Accepts optional authHeaders for server-to-server authentication
 */
const getCachedTMDBDetails = cache(async function getCachedTMDBDetails(tmdbId, mediaType, authHeaders = null) {
  log.debug({ mediaType, tmdbId, withAuth: !!authHeaders }, 'Fetching TMDB data')

  try {
    // Direct backend call (Redis + ETag revalidation inside) — avoids the
    // previous self-HTTP hop through our own proxy route, which paid Next
    // routing plus two session lookups per item
    const { data: tmdbData } = await fetchTmdbFromBackend(
      `comprehensive/${mediaType}`,
      { blurhash: 'true', tmdb_id: tmdbId },
      { authHeaders }
    )

    if (!tmdbData) {
      log.debug({ mediaType, tmdbId }, 'No data returned from TMDB')
      return null
    }
    
    return tmdbData
  } catch (error) {
    // A title TMDB doesn't have is labeled by the caller, not an error
    if (!isTmdbNotFound(error)) {
      logError(log, error, { context: 'Error fetching TMDB data', mediaType, tmdbId })
    }
    throw error
  }
})

/**
 * Cached wrapper for batchResolveMedia - serializes array parameters for proper cache() functionality
 */
const batchResolveMediaCached = cache(async function batchResolveMediaCached(itemsJSON, optionsJSON = '{}') {
  const items = JSON.parse(itemsJSON)
  const options = JSON.parse(optionsJSON)
  return await batchResolveMediaInternal(items, options)
})

/**
 * Public API - convenience wrapper that handles JSON serialization
 * @param {Array} items - Array of {tmdbId, mediaType} objects, or {libraryMediaId, mediaType} for a title with no TMDB id
 * @param {Object} options - `access` (required): the viewer's LibraryAccess. `precomputedAvailability` is a Set of titleKey()s ("movie:603") known to be in the library
 * @returns {Promise<Map>} Map of titleKey ("movie:603", "tv:1399", "movie:mid:…") -> media data. Keyed by type too: TMDB ids repeat across media types.
 *   A title asked for by library id that the library no longer has maps to a `libraryMissing` placeholder (tmdbMissing.js)
 */
export async function batchResolveMedia(items, options) {
  // Convert Set to Array for JSON serialization
  const serializedOptions = { ...options }
  if (options.precomputedAvailability instanceof Set) {
    serializedOptions.precomputedAvailability = Array.from(options.precomputedAvailability)
  }
  
  const result = await batchResolveMediaCached(
    JSON.stringify(items), 
    JSON.stringify(serializedOptions)
  )
  
  // Convert Array back to Set if needed
  if (serializedOptions.precomputedAvailability) {
    // Note: The internal function will handle this conversion
  }
  
  return result
}
