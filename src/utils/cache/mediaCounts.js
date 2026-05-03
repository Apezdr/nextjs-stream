import { cacheLife, cacheTag } from 'next/cache'
import {
  getFlatAvailableMoviesCount,
  getFlatAvailableTVShowsCount,
} from '@src/utils/flatDatabaseUtils'

async function fetchMovieCounts() {
  const data = await getFlatAvailableMoviesCount()
  return {
    count: data?.count || 0,
    totalMilliseconds: data?.totalDuration || 0,
  }
}

async function fetchTVCounts() {
  const data = await getFlatAvailableTVShowsCount()
  return {
    count: data?.count || 0,
    totalMilliseconds: data?.totalDuration || 0,
  }
}

export async function getCachedMediaCounts(mediaType) {
  'use cache'
  cacheLife('mediaLists')

  if (mediaType === 'movies') {
    cacheTag('media-library', 'movies', 'movie-count')
    return fetchMovieCounts()
  }

  if (mediaType === 'tv') {
    cacheTag('media-library', 'tv', 'tv-show-count')
    return fetchTVCounts()
  }

  if (mediaType === 'all') {
    cacheTag('media-library', 'movies', 'tv', 'media-counts')
    const [movies, tv] = await Promise.all([fetchMovieCounts(), fetchTVCounts()])
    return {
      count: movies.count + tv.count,
      totalMilliseconds: movies.totalMilliseconds + tv.totalMilliseconds,
    }
  }

  throw new Error(`getCachedMediaCounts: unknown mediaType "${mediaType}"`)
}
