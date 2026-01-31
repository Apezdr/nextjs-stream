import { cache } from 'react'
import { cacheLife, cacheTag } from 'next/cache'
import { getFlatAvailableMoviesCount, getFlatAvailableTVShowsCount } from '@src/utils/flatDatabaseUtils'

// Cached server-side function to fetch counts using database functions
const getCachedCounts = cache(async () => {
  try {
    const [movieData, tvData] = await Promise.all([
      getFlatAvailableMoviesCount(),
      getFlatAvailableTVShowsCount()
    ])

    const movieHours = Math.round(movieData.totalDuration / (1000 * 60 * 60))
    const tvHours = Math.round(tvData.totalDuration / (1000 * 60 * 60))

    return {
      moviesCount: movieData.count || 0,
      tvProgramsCount: tvData.count || 0,
      movieHours,
      tvHours,
      totalHours: movieHours + tvHours,
    }
  } catch (error) {
    console.error('Error fetching counts:', error)
    return {
      moviesCount: 0,
      tvProgramsCount: 0,
      movieHours: 0,
      tvHours: 0,
      totalHours: 0,
    }
  }
})

// Server component - no client directives needed
export default async function AsyncMediaCounts({suffix = '', showDuration = false}) {
  'use cache'
  cacheLife('mediaLists')
  cacheTag('media-library', 'media-counts')

  const counts = await getCachedCounts()

  return (
    <span>
      {showDuration && (
        <span className="block text-sm text-gray-100">
          {counts.totalHours > 0 
            ? `${counts.totalHours.toLocaleString()} hours total`
            : ''}
        </span>
      )}
      ({counts.moviesCount + counts.tvProgramsCount})
      {suffix}
    </span>
  )
}
