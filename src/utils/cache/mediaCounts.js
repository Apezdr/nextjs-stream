import { cacheLife, cacheTag } from 'next/cache'
import {
  getFlatAvailableMoviesCount,
  getFlatAvailableTVShowsCount,
} from '@src/utils/flatDatabaseUtils'

async function fetchMovieCounts(access) {
  const data = await getFlatAvailableMoviesCount(access)
  return {
    count: data?.count || 0,
    totalMilliseconds: data?.totalDuration || 0,
  }
}

async function fetchTVCounts(access) {
  const data = await getFlatAvailableTVShowsCount(access)
  return {
    count: data?.count || 0,
    totalMilliseconds: data?.totalDuration || 0,
  }
}

/** Counts of what the viewer's lists show, by their LibraryAccess (part of the cache key). */
export async function getCachedMediaCounts(mediaType, access) {
  'use cache'
  cacheLife('mediaLists')

  if (mediaType === 'movies') {
    cacheTag('media-library', 'movies', 'movie-count')
    return fetchMovieCounts(access)
  }

  if (mediaType === 'tv') {
    cacheTag('media-library', 'tv', 'tv-show-count')
    return fetchTVCounts(access)
  }

  if (mediaType === 'all') {
    cacheTag('media-library', 'movies', 'tv', 'media-counts')
    const [movies, tv] = await Promise.all([fetchMovieCounts(access), fetchTVCounts(access)])
    return {
      count: movies.count + tv.count,
      totalMilliseconds: movies.totalMilliseconds + tv.totalMilliseconds,
    }
  }

  throw new Error(`getCachedMediaCounts: unknown mediaType "${mediaType}"`)
}
