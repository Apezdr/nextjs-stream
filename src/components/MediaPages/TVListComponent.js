import Link from 'next/link'
import SkeletonCard from '@components/SkeletonCard'
import SyncClientWithServerWatched from '@components/SyncClientWithServerWatched'
import { memo, Suspense } from 'react'
import Loading from '@src/app/loading'
import TVList from './cache/TVList'
import { getFlatAvailableTVShowsCount } from '@src/utils/flatDatabaseUtils'
import { getCachedTVList } from '@src/utils/cache/horizontalListData'
import { cacheLife, cacheTag } from 'next/cache'

// Predetermined widths for skeleton genre buttons to avoid Math.random() during render
const GENRE_SKELETON_WIDTHS = [80, 95, 70, 88, 75, 92, 68, 85]

// Cached count function using 'use cache' directive
async function getCachedTVShowCount() {
  'use cache'
  cacheLife('mediaLists')
  cacheTag('media-library', 'tv', 'tv-show-count')

  const data = await getFlatAvailableTVShowsCount()
  // Handle both old (number) and new (object) return types for backward compatibility
  return typeof data === 'object' ? data : { count: data, totalDuration: 0 }
}

async function TVListComponent() {
  // Auth is now handled by AuthGuard in page.js - no need to check again
  // This allows the static shell to render immediately

  // Get TV show data - now using 'use cache' for cross-request caching
  const tvShowData = await getCachedTVShowCount()
  const tvprogramsCount = tvShowData.count
  const tvHours = Math.round(tvShowData.totalDuration / (1000 * 60 * 60))
  
  // Fetch cached TV list - this uses 'use cache' so it's part of the static shell
  const tvList = await getCachedTVList(1, 0, null)

  return (
    <div className="flex min-h-screen flex-col items-center justify-between xl:p-24">
      <SyncClientWithServerWatched />
      <div className="h-auto flex items-center justify-center py-32 lg:py-0 px-4 xl:px-0 sm:mt-20">
        <ul className="grid grid-cols-1 gap-x-4 gap-y-8 sm:gap-x-6 sm:grid-cols-2 xl:grid-cols-4 xl:gap-x-8">
          <li>
            <h2 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight text-white sm:text-4xl pb-8 xl:pb-0 px-4 xl:px-0">
              {tvHours > 0 && (
                <span className="block text-sm text-gray-100">
                  {tvHours.toLocaleString()} hours total
                </span>
              )}
              ({tvprogramsCount}) Available TV Programs
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
          {/* Cached TV list - included in static shell for instant display */}
          <TVList tvList={tvList} />
        </ul>
      </div>
    </div>
  )
}

export default memo(TVListComponent)
