import Link from 'next/link'
import { auth } from '../../lib/auth'
import UnauthenticatedPage from '@components/system/UnauthenticatedPage'
import SignOutButton from '@components/SignOutButton'
import SkeletonCard from '@components/SkeletonCard'
import SyncClientWithServerWatched from '@components/SyncClientWithServerWatched'
import { memo, Suspense, cache } from 'react'
import Loading from '@src/app/loading'
import TVList from './cache/TVList'
import { 
  getFlatAvailableTVShowsCount, 
  getFlatTVList 
} from '@src/utils/flatDatabaseUtils'
import { unstable_noStore as noStore } from 'next/cache'

// Use partial prerendering
export const dynamic = 'force-dynamic'
export const runtime = 'edge'

// Cached count function that can be reused across requests
const getCachedTVShowCount = cache(
  async () => {
    const data = await getFlatAvailableTVShowsCount();
    // Handle both old (number) and new (object) return types for backward compatibility
    return typeof data === 'object' ? data : { count: data, totalDuration: 0 };
  },
  ['tv-show-count'],
  { revalidate: 60 } // Revalidate every minute
);

// Function to fetch the dynamic TV show data - this will be loaded after the static shell
async function TVData() {
  // Mark this component as dynamic - it won't be part of the static shell
  noStore();
  
  // Get all TV shows
  const tvList = await getFlatTVList();
  
  return (
    <TVList tvList={tvList} />
  );
}

async function TVListComponent() {
  const session = await auth()
  if (!session || !session.user) {
    // Handle the case where the user is not authenticated
    // For example, redirect to login or show an error message
    return (
      <UnauthenticatedPage callbackUrl={`/list/tv`}>
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
  const {
    user: { name, email },
  } = session
  
  // Get TV show data - this is cached and can be part of the static shell
  const tvShowData = await getCachedTVShowCount();
  const tvprogramsCount = tvShowData.count;
  const tvHours = Math.round(tvShowData.totalDuration / (1000 * 60 * 60));
  
  return (
    <div className="flex min-h-screen flex-col items-center justify-between xl:p-24">
      <SyncClientWithServerWatched />
      <div className="h-auto flex items-center justify-center py-32 lg:py-0 px-4 xl:px-0 sm:mt-20">
        <ul className="grid grid-cols-1 gap-x-4 gap-y-8 sm:gap-x-6 sm:grid-cols-2 xl:grid-cols-4 xl:gap-x-8">
          <Suspense fallback={<Loading />}>
            <li>
              <h2 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight text-white sm:text-4xl pb-8 xl:pb-0 px-4 xl:px-0">
                <Suspense fallback={<Loading />}>
                  {tvHours > 0 && (
                    <span className="block text-sm text-gray-100">
                      {tvHours.toLocaleString()} hours total
                    </span>
                  )}
                  ({tvprogramsCount})
                </Suspense> Available TV Programs
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
                <SignOutButton
                  className="self-center bg-gray-600 hover:bg-gray-500 focus-visible:outline-gray-600"
                  signoutProps={{ callbackUrl: '/' }}
                />
              </div>
            </li>
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
                            <div key={`genre-skeleton-${i}`} className="h-6 bg-gray-700 animate-pulse rounded-full" style={{ width: `${Math.floor(Math.random() * 40) + 60}px` }}></div>
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
                  
                  {/* TV show card skeletons */}
                  {Array.from({ length: 16 }, (_, i) => (
                    <li key={i + '-skeleton'} className="relative min-w-[250px]">
                      <SkeletonCard key={i} heightClass={'h-[582px]'} />
                    </li>
                  ))}
                </>
              }
            >
              <TVData />
            </Suspense>
          </Suspense>
        </ul>
      </div>
    </div>
  )
}

export default memo(TVListComponent)
