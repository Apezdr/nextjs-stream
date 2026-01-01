/**
 * Movie List View
 *
 * Displays browseable list of all movies with server-side filtering and pagination.
 * Route: /list/movie or /list
 *
 * REFACTORED: Now uses Server Actions for filtering/pagination instead of client-side filtering
 */

import Link from 'next/link'
import SyncClientWithServerWatched from '@components/SyncClientWithServerWatched'
import MovieListClient from '@components/MediaPages/MovieListClient'
import { getMovieListData } from '@src/utils/actions/mediaListActions'
import { parseSearchParamsToFilters } from '@src/utils/mediaListUtils/shared'

/**
 * MovieListView Component (Server Component)
 * 
 * Fetches initial movie list data based on search params and renders the client component.
 * Uses Server Actions with 'use cache' for optimal performance.
 * 
 * @param {Object} props
 * @param {Object} props.searchParams - URL search parameters for filtering/pagination
 */
export default async function MovieListView({ searchParams = {} }) {
  // Parse search params into filter options
  const initialFilters = parseSearchParamsToFilters(searchParams);
  
  // Fetch initial data using Server Action (cached)
  const initialData = await getMovieListData(initialFilters);
  
  // Extract statistics for header display
  const { statistics } = initialData;
  const moviesCount = statistics?.count || 0;
  const movieHours = Math.round((statistics?.totalDuration || 0) / (1000 * 60 * 60));

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
          {/* Movie list with client-driven filtering and pagination */}
          <MovieListClient
            initialFilters={initialFilters}
            initialData={initialData}
          />
        </ul>
      </div>
    </div>
  );
}