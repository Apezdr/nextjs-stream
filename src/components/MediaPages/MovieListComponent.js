import Link from 'next/link'
import SkeletonCard from '@components/SkeletonCard'
import SyncClientWithServerWatched from '@components/SyncClientWithServerWatched'
import { memo, Suspense } from 'react'
import Loading from '@src/app/loading'
import MovieList from './cache/MovieList'
import { getCachedMovieList } from '@src/utils/cache/horizontalListData'
import { cacheLife, cacheTag } from 'next/cache'
import { getFlatAvailableMoviesCount } from '@src/utils/flatDatabaseUtils'

// Predetermined widths for skeleton genre buttons to avoid Math.random() during render
const GENRE_SKELETON_WIDTHS = [80, 95, 70, 88, 75, 92, 68, 85]

// Define projection as a constant to ensure stable cache keys
const MOVIE_LIST_PROJECTION = {
  duration: 1,
  dimensions: 1,
  captionURLs: 1,
  metadata: 1 // Include all metadata which will have genres and release_date
}

// Cached count function using 'use cache' directive
async function getCachedMovieCount() {
  'use cache'
  cacheLife('mediaLists')
  cacheTag('media-library', 'movies', 'movie-count')

  const data = await getFlatAvailableMoviesCount()
  // Handle both old (number) and new (object) return types for backward compatibility
  return typeof data === 'object' ? data : { count: data, totalDuration: 0 }
}

async function MovieListComponent() {
  // Auth is now handled by AuthGuard in page.js - no need to check again
  // This allows the static shell to render immediately
  
  // Get movie data - now using 'use cache' for cross-request caching
  const movieData = await getCachedMovieCount()
  const moviesCount = movieData.count
  const movieHours = Math.round(movieData.totalDuration / (1000 * 60 * 60))
  
  // Fetch cached movie list - uses constant projection for stable cache keys
  const movieList = await getCachedMovieList(1, 0, MOVIE_LIST_PROJECTION)
  
  return (
    <div className="flex min-h-screen flex-col items-center justify-between xl:p-24">
      <SyncClientWithServerWatched />
      <div className="h-auto flex items-center justify-center py-32 lg:py-0 px-4 xl:px-0 sm:mt-20">
        <ul className="grid grid-cols-1 gap-x-4 gap-y-8 sm:gap-x-6 sm:grid-cols-2 xl:grid-cols-4 xl:gap-x-8">
          <li>
            <h2 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight text-white sm:text-4xl pb-8 xl:pb-0 px-4 xl:px-0">
              {movieHours > 0 && (
                <span className="block text-sm text-gray-100">
                  {movieHours.toLocaleString()} hours total
                </span>
              )}
              ({moviesCount}) Available Movies
            </h2>
            <div className="flex flex-row gap-x-4 mt-4 justify-center">
              <Link href="/list" className="self-center">
                <button
                  type="button"
                  className="flex flex-row gap-x-2 rounded bg-indigo-600 px-2 py-1 text-base font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    className="w-6 h-6"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"
                    />
                  </svg>
                  Go Back
                </button>
              </Link>
            </div>
          </li>
          {/* Cached movie list - included in static shell for instant display */}
          <MovieList movieList={movieList} />
        </ul>
      </div>
    </div>
  )
}

export default memo(MovieListComponent)
