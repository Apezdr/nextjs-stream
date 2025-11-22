import Link from 'next/link'
import { auth } from '../../lib/auth'
import UnauthenticatedPage from '@components/system/UnauthenticatedPage'
import SkeletonCard from '@components/SkeletonCard'
import SyncClientWithServerWatched from '@components/SyncClientWithServerWatched'
import { memo, Suspense, cache } from 'react'
import Loading from '@src/app/loading'
import MovieList from './cache/MovieList'
import { 
  getFlatAvailableMoviesCount,
  getFlatPosters 
} from '@src/utils/flatDatabaseUtils'
import { unstable_noStore as noStore } from 'next/cache'

// Use partial prerendering
export const dynamic = 'force-dynamic'
export const runtime = 'edge'

// Predetermined widths for skeleton genre buttons to avoid Math.random() during render
const GENRE_SKELETON_WIDTHS = [80, 95, 70, 88, 75, 92, 68, 85]

// Cached count function that can be reused across requests
const getCachedMovieCount = cache(
  async () => {
    const data = await getFlatAvailableMoviesCount();
    // Handle both old (number) and new (object) return types for backward compatibility
    return typeof data === 'object' ? data : { count: data, totalDuration: 0 };
  },
  ['movie-count'],
  { revalidate: 60 } // Revalidate every minute
);

// Function to fetch the dynamic movie data - this will be loaded after the static shell
async function MovieData() {
  // Mark this component as dynamic - it won't be part of the static shell
  noStore();
  
  // Define the custom projection - include the full metadata
  const customProjection = {
    duration: 1,
    dimensions: 1,
    captionURLs: 1,
    metadata: 1 // Include all metadata which will have genres and release_date
  };

  // Get all movies with the enhanced projection
  const movieList = await getFlatPosters('movie', false, 1, 0, customProjection);
  
  return (
    <MovieList movieList={movieList} />
  );
}

async function MovieListComponent() {
  const session = await auth()
  if (!session || !session.user) {
    // Handle the case where the user is not authenticated
    // For example, redirect to login or show an error message
    return (
      <UnauthenticatedPage callbackUrl={'/list/movie'}>
        <h2 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight text-white sm:text-4xl pb-8 xl:pb-0 px-4 xl:px-0">
          Please Sign in first
        </h2>
        <div className="border border-white border-opacity-30 rounded-lg p-3 overflow-hidden skeleton-container">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 overflow-hidden">
            <SkeletonCard />
            <SkeletonCard className="hidden md:block" />
            <SkeletonCard className="hidden lg:block" />
          </div>
        </div>
      </UnauthenticatedPage>
    )
  }
  
  // This part is static and will be part of the initial HTML
  const {
    user: { name, email },
  } = session
  
  // Get movie data - this is cached and can be part of the static shell
  const movieData = await getCachedMovieCount();
  const moviesCount = movieData.count;
  const movieHours = Math.round(movieData.totalDuration / (1000 * 60 * 60));
  
  return (
    <div className="flex min-h-screen flex-col items-center justify-between xl:p-24">
      <SyncClientWithServerWatched />
      <div className="h-auto flex items-center justify-center py-32 lg:py-0 px-4 xl:px-0 sm:mt-20">
        <ul className="grid grid-cols-1 gap-x-4 gap-y-8 sm:gap-x-6 sm:grid-cols-2 xl:grid-cols-4 xl:gap-x-8">
          <li>
            <h2 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight text-white sm:text-4xl pb-8 xl:pb-0 px-4 xl:px-0">
              <Suspense fallback={<Loading />}>
                {movieHours > 0 && (
                  <span className="block text-sm text-gray-100">
                    {movieHours.toLocaleString()} hours total
                  </span>
                )}
                ({moviesCount})
              </Suspense> Available Movies
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
          {/* Dynamic part - will be loaded after the static shell with a proper loading state */}
          <Suspense
            fallback={
              <>
                {/* Skeleton for filtering UI */}
                <li className="col-span-full mb-6 border-b border-gray-700 pb-6">
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    {/* Sort dropdown skeleton */}
                    <div>
                      <div className="block text-sm font-medium text-gray-300 mb-1 w-40 h-5 bg-gray-700 animate-pulse rounded"></div>
                      <div className="w-36 h-9 bg-gray-800 animate-pulse rounded"></div>
                    </div>
                    
                    {/* Genre filter buttons skeleton */}
                    <div className="w-full md:w-auto">
                      <div className="block text-sm font-medium text-gray-300 mb-1 w-32 h-5 bg-gray-700 animate-pulse rounded"></div>
                      <div className="flex flex-wrap gap-2 max-w-3xl">
                        {Array.from({ length: 8 }, (_, i) => (
                          <div key={`genre-skeleton-${i}`} className="h-6 bg-gray-700 animate-pulse rounded-full" style={{ width: `${GENRE_SKELETON_WIDTHS[i]}px` }}></div>
                        ))}
                      </div>
                    </div>
                  </div>
                  
                  {/* Pagination status skeleton */}
                  <div className="mt-3 flex items-center justify-between">
                    <div className="w-40 h-5 bg-gray-700 animate-pulse rounded"></div>
                    
                    {/* Pagination controls skeleton */}
                    <div className="flex items-center space-x-2">
                      <div className="w-8 h-8 bg-gray-700 animate-pulse rounded"></div>
                      {Array.from({ length: 3 }, (_, i) => (
                        <div key={`page-skeleton-${i}`} className="w-8 h-8 bg-gray-700 animate-pulse rounded"></div>
                      ))}
                      <div className="w-8 h-8 bg-gray-700 animate-pulse rounded"></div>
                    </div>
                  </div>
                </li>

                {/* Loading line animation */}
                <li className="col-span-full py-2">
                  <div className="w-full h-1 bg-gray-800 overflow-hidden">
                    <div className="h-full bg-indigo-600 w-full animate-[pulse_1.5s_ease-in-out_infinite]"></div>
                  </div>
                </li>
                
                {/* Movie card skeletons */}
                {Array.from({ length: 16 }, (_, i) => (
                  <li key={i + '-skeleton'} className="relative min-w-[250px]">
                    <SkeletonCard key={i} heightClass={'h-[582px]'} />
                  </li>
                ))}
              </>
            }
          >
            <MovieData />
          </Suspense>
        </ul>
      </div>
    </div>
  )
}

export default memo(MovieListComponent)
