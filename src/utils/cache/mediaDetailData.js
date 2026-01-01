import { cacheLife, cacheTag } from 'next/cache'
import { getFlatRequestedMedia } from '@src/utils/flatDatabaseUtils'
import {
  movieDetailsTag,
  tvShowDetailsTag,
  seasonDetailsTag,
  episodeDetailsTag,
  MEDIA_CACHE_TAGS,
} from './mediaPagesTags'

/**
 * Serialize MongoDB objects to plain objects for client transfer
 * (Same as horizontalListData.js)
 */
function serializeForClient(data) {
  if (!data) return data
  
  if (Array.isArray(data)) {
    return data.map(item => serializeForClient(item))
  }
  
  if (typeof data === 'object' && data !== null) {
    const serialized = {}
    for (const [key, value] of Object.entries(data)) {
      if (key === '_id' && value?.buffer) {
        // Convert MongoDB ObjectId to string
        serialized[key] = value.toString()
      } else if (typeof value === 'object' && value !== null) {
        serialized[key] = serializeForClient(value)
      } else {
        serialized[key] = value
      }
    }
    return serialized
  }
  
  return data
}

/**
 * Cached movie details - uses mediaLists cache profile (2 minute stale, revalidates in background)
 */
export async function getCachedMovieDetails(movieTitle) {
  'use cache'
  cacheLife('mediaLists') // Matches your existing media list caching
  cacheTag('media-library', 'movies', MEDIA_CACHE_TAGS.MOVIE_DETAILS, movieDetailsTag(movieTitle))
  
  const data = await getFlatRequestedMedia({
    type: 'movie',
    title: movieTitle,
  })
  
  return serializeForClient(data)
}

/**
 * Cached TV show details (seasons list)
 */
export async function getCachedTVShowDetails(showTitle) {
  'use cache'
  cacheLife('mediaLists')
  cacheTag('media-library', 'tv', MEDIA_CACHE_TAGS.TV_DETAILS, tvShowDetailsTag(showTitle))
  
  const data = await getFlatRequestedMedia({
    type: 'tv',
    title: showTitle,
  })
  
  return serializeForClient(data)
}

/**
 * Cached season details (episodes list)
 */
export async function getCachedSeasonDetails(showTitle, seasonNumber) {
  'use cache'
  cacheLife('mediaLists')
  cacheTag(
    'media-library',
    'tv',
    MEDIA_CACHE_TAGS.SEASON_DETAILS,
    tvShowDetailsTag(showTitle),
    seasonDetailsTag(showTitle, seasonNumber)
  )
  
  const data = await getFlatRequestedMedia({
    type: 'tv',
    title: showTitle,
    season: seasonNumber,
  })
  
  return serializeForClient(data)
}

/**
 * Cached episode details
 */
export async function getCachedEpisodeDetails(showTitle, seasonNumber, episodeNumber) {
  'use cache'
  cacheLife('mediaLists')
  cacheTag(
    'media-library',
    'tv',
    MEDIA_CACHE_TAGS.EPISODE_DETAILS,
    tvShowDetailsTag(showTitle),
    seasonDetailsTag(showTitle, seasonNumber),
    episodeDetailsTag(showTitle, seasonNumber, episodeNumber)
  )
  
  const data = await getFlatRequestedMedia({
    type: 'tv',
    title: showTitle,
    season: seasonNumber,
    episode: episodeNumber,
  })
  
  return serializeForClient(data)
}