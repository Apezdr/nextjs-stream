'use server'

/**
 * Simplified Media Resolver
 * 
 * Uses React's cache() for proper request-scoped memoization.
 * Replaced manual Map cache with React Server Components best practices.
 */

import { cache } from 'react'
import clientPromise from '@src/lib/mongodb'
import { getFullImageUrl } from '@src/utils'
import { getComprehensiveDetails } from '@src/utils/tmdb/client'

/**
 * Internal implementation (not cached) - does the actual work
 */
async function batchResolveMediaInternal(items, options = {}) {
  let { precomputedAvailability = null } = options
  
  // Convert Array back to Set if needed (from JSON deserialization)
  if (precomputedAvailability && Array.isArray(precomputedAvailability)) {
    precomputedAvailability = new Set(precomputedAvailability)
  }
  
  console.log(`[batchResolveMediaInternal] Called with ${items.length} items:`, items.map(i => `${i.mediaType}/${i.tmdbId}`))
  
  const results = new Map()
  const uniqueItems = new Map()
  
  // Deduplicate items
  for (const item of items) {
    const key = `${item.mediaType}-${item.tmdbId}`
    if (!uniqueItems.has(key)) {
      uniqueItems.set(key, item)
    }
  }
  
  const itemsArray = Array.from(uniqueItems.values())
  
  // Group by media type for efficient DB queries
  const movieTmdbIds = itemsArray
    .filter(item => item.mediaType === 'movie')
    .map(item => parseInt(item.tmdbId))
  
  const tvTmdbIds = itemsArray
    .filter(item => item.mediaType === 'tv')
    .map(item => parseInt(item.tmdbId))

  let movies = []
  let tvShows = []

  // Use pre-computed availability if provided (optimization to avoid duplicate queries)
  if (precomputedAvailability) {
    // Filter to only query items we know are available
    const availableMovieIds = movieTmdbIds.filter(id => precomputedAvailability.has(id))
    const availableTvIds = tvTmdbIds.filter(id => precomputedAvailability.has(id))
    
    if (availableMovieIds.length === 0 && availableTvIds.length === 0) {
      // No items are available in library, skip DB queries entirely
      movies = []
      tvShows = []
    } else {
      // Query only the items we know exist
      const client = await clientPromise
      const db = client.db('Media')
      
      ;[movies, tvShows] = await Promise.all([
        availableMovieIds.length > 0
          ? db.collection('FlatMovies').find(
              { 'metadata.id': { $in: availableMovieIds } },
              {
                projection: {
                  _id: 1,
                  title: 1,
                  posterURL: 1,
                  posterBlurhash: 1,
                  backdrop: 1,
                  backdropBlurhash: 1,
                  'metadata.id': 1,
                  'metadata.poster_path': 1,
                  'metadata.backdrop_path': 1,
                  'metadata.overview': 1,
                  'metadata.release_date': 1,
                  'metadata.genres': 1,
                  'metadata.vote_average': 1
                }
              }
            ).toArray()
          : [],
        
        availableTvIds.length > 0
          ? db.collection('FlatTVShows').find(
              { 'metadata.id': { $in: availableTvIds } },
              {
                projection: {
                  _id: 1,
                  title: 1,
                  posterURL: 1,
                  posterBlurhash: 1,
                  backdrop: 1,
                  backdropBlurhash: 1,
                  'metadata.id': 1,
                  'metadata.poster_path': 1,
                  'metadata.backdrop_path': 1,
                  'metadata.overview': 1,
                  'metadata.first_air_date': 1,
                  'metadata.genres': 1,
                  'metadata.vote_average': 1
                }
              }
            ).toArray()
          : []
      ])
    }
  } else {
    // Fallback: fetch from database without pre-computed data
    const client = await clientPromise
    const db = client.db('Media')
    
    ;[movies, tvShows] = await Promise.all([
      movieTmdbIds.length > 0
        ? db.collection('FlatMovies').find(
            { 'metadata.id': { $in: movieTmdbIds } },
            {
              projection: {
                _id: 1,
                title: 1,
                posterURL: 1,
                posterBlurhash: 1,
                backdrop: 1,
                backdropBlurhash: 1,
                'metadata.id': 1,
                'metadata.poster_path': 1,
                'metadata.backdrop_path': 1,
                'metadata.overview': 1,
                'metadata.release_date': 1,
                'metadata.genres': 1,
                'metadata.vote_average': 1
              }
            }
          ).toArray()
        : [],
      
      tvTmdbIds.length > 0
        ? db.collection('FlatTVShows').find(
            { 'metadata.id': { $in: tvTmdbIds } },
            {
              projection: {
                _id: 1,
                title: 1,
                posterURL: 1,
                posterBlurhash: 1,
                backdrop: 1,
                backdropBlurhash: 1,
                'metadata.id': 1,
                'metadata.poster_path': 1,
                'metadata.backdrop_path': 1,
                'metadata.overview': 1,
                'metadata.first_air_date': 1,
                'metadata.genres': 1,
                'metadata.vote_average': 1
              }
            }
          ).toArray()
        : []
    ])
  }

  // Process internal media (available in our library)
  const foundTmdbIds = new Set()
  
  for (const movie of movies) {
    const tmdbId = movie.metadata?.id
    if (tmdbId) {
      foundTmdbIds.add(tmdbId)
      results.set(tmdbId, {
        tmdbId,
        mediaType: 'movie',
        currentMediaId: movie._id.toString(),
        title: movie.title,
        posterURL: movie.posterURL || (movie.metadata?.poster_path
          ? getFullImageUrl(movie.metadata.poster_path, 'w500')
          : '/sorry-image-not-available.jpg'),
        posterBlurhash: movie.posterBlurhash,
        backdropURL: movie.backdrop || (movie.metadata?.backdrop_path
          ? getFullImageUrl(movie.metadata.backdrop_path, 'original')
          : null),
        backdropBlurhash: movie.backdropBlurhash,
        overview: movie.metadata?.overview,
        releaseDate: movie.metadata?.release_date,
        genres: movie.metadata?.genres || [],
        voteAverage: movie.metadata?.vote_average,
        isInternal: true,
        url: `/list/movie/${encodeURIComponent(movie.title)}`,
        link: encodeURIComponent(movie.title)
      })
    }
  }
  
  for (const show of tvShows) {
    const tmdbId = show.metadata?.id
    if (tmdbId) {
      foundTmdbIds.add(tmdbId)
      results.set(tmdbId, {
        tmdbId,
        mediaType: 'tv',
        currentMediaId: show._id.toString(),
        title: show.title,
        posterURL: show.posterURL || (show.metadata?.poster_path 
          ? getFullImageUrl(show.metadata.poster_path, 'w500') 
          : '/sorry-image-not-available.jpg'),
        posterBlurhash: show.posterBlurhash,
        backdropURL: show.backdrop || (show.metadata?.backdrop_path 
          ? getFullImageUrl(show.metadata.backdrop_path, 'original') 
          : null),
        backdropBlurhash: show.backdropBlurhash,
        overview: show.metadata?.overview,
        releaseDate: show.metadata?.first_air_date,
        genres: show.metadata?.genres || [],
        voteAverage: show.metadata?.vote_average,
        isInternal: true,
        url: `/list/tv/${encodeURIComponent(show.title)}`,
        link: encodeURIComponent(show.title)
      })
    }
  }

  // For items not found in our library, fetch directly from TMDB
  const externalItems = itemsArray.filter(item => !foundTmdbIds.has(parseInt(item.tmdbId)))
  
  if (externalItems.length > 0) {
    console.log(`[batchResolveMediaInternal] Fetching ${externalItems.length} external items from TMDB API`)
    
    // Use cached TMDB fetching per item to avoid duplicate API calls within the same request
    const tmdbPromises = externalItems.map(item => getCachedTMDBDetails(parseInt(item.tmdbId), item.mediaType))
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
        
        results.set(tmdbId, mediaData)
      } else {
        console.error(`Failed to fetch TMDB data for ${item.mediaType} ${item.tmdbId}:`, result.reason)
      }
    })
  }

  return results
}

/**
 * Cached TMDB details fetching - uses React cache() with primitives for proper memoization
 */
const getCachedTMDBDetails = cache(async function getCachedTMDBDetails(tmdbId, mediaType) {
  console.log(`[getCachedTMDBDetails] Fetching TMDB data for ${mediaType}/${tmdbId}`)
  
  try {
    const tmdbData = await getComprehensiveDetails({
      tmdbId: tmdbId,
      type: mediaType
    })
    
    if (!tmdbData) {
      console.log(`[getCachedTMDBDetails] No data returned from TMDB for ${mediaType}/${tmdbId}`)
      return null
    }
    
    console.log(`[getCachedTMDBDetails] Successfully fetched TMDB data for ${mediaType}/${tmdbId}:`, {
      title: tmdbData.title || tmdbData.name,
      hasOverview: !!tmdbData.overview,
      hasCast: !!(tmdbData.cast?.length),
      castCount: tmdbData.cast?.length || 0
    })
    
    return tmdbData
  } catch (error) {
    console.error(`[getCachedTMDBDetails] Error fetching TMDB data for ${mediaType} ${tmdbId}:`, error)
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
 * @param {Array} items - Array of {tmdbId, mediaType} objects  
 * @param {Object} options - Optional parameters
 * @returns {Promise<Map>} Map of tmdbId -> media data
 */
export async function batchResolveMedia(items, options = {}) {
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

/**
 * Get a single media item by TMDB ID
 * @param {number} tmdbId - TMDB ID
 * @param {string} mediaType - Media type
 * @returns {Promise<Object|null>} Media data
 */
export async function getMediaByTMDBId(tmdbId, mediaType) {
  const results = await batchResolveMedia([{ tmdbId, mediaType }])
  return results.get(parseInt(tmdbId)) || null
}

/**
 * Clear the media cache (no-op in React cache version)
 */
export async function clearMediaCache() {
  // React cache() is automatically cleared per request, no manual clearing needed
  return { success: true, message: 'React cache cleared per request automatically' }
}

/**
 * No-op function for background updates (removed in simplified version)
 */
export async function scheduleBackgroundUpdate(watchlistItems, resolvedMedia) {
  // No background updates in simplified version
  return { success: true, message: 'Background updates disabled in simplified version' }
}