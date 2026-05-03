/**
 * TV List View
 *
 * Displays browseable list of all TV shows with server-side filtering and pagination.
 * Route: /list/tv
 *
 * REFACTORED: Now uses Server Actions for filtering/pagination instead of client-side filtering
 */

import { Suspense } from 'react'
import { cacheLife, cacheTag } from 'next/cache'
import Link from 'next/link'
import SyncClientWithServerWatched from '@components/SyncClientWithServerWatched'
import TVListClient from '@components/MediaPages/TVListClient'
import AsyncMediaListHeader from '@components/MediaPages/AsyncMediaListHeader'
import MediaListGridSkeleton from '@components/MediaPages/MediaListGridSkeleton'
import { getCachedTVListData } from '@src/utils/cache/mediaListData'
import { parseSearchParamsToFilters } from '@src/utils/mediaListUtils/shared'

async function TVListContent({ initialFilters, userId }) {
  'use cache'
  cacheLife('mediaLists')
  cacheTag('media-library', 'tv', 'tv-list', `user-watch-history-${userId}`)

  const initialData = await getCachedTVListData({ ...initialFilters, userId })
  return (
    <TVListClient
      initialFilters={initialFilters}
      initialData={initialData}
    />
  )
}

export default function TVListView({ searchParams = {}, session }) {
  const initialFilters = parseSearchParamsToFilters(searchParams)
  const userId = session?.user?.id

  return (
    <div className="flex min-h-screen flex-col items-center justify-between xl:p-24 bg-[#060916e8]">
      <SyncClientWithServerWatched />
      <div className="h-auto flex items-center justify-center py-32 lg:py-0 px-4 xl:px-0 sm:mt-20">
        <ul className="grid grid-cols-1 gap-x-4 gap-y-8 sm:gap-x-6 sm:grid-cols-2 xl:grid-cols-4 xl:gap-x-8">
          <li>
            <AsyncMediaListHeader mediaType="tv" label="Available TV Programs" />
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
          <Suspense fallback={<MediaListGridSkeleton />}>
            <TVListContent initialFilters={initialFilters} userId={userId} />
          </Suspense>
        </ul>
      </div>
    </div>
  )
}
