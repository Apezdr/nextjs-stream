'use client'

import React, { useCallback } from 'react'
import useSWR from 'swr'
import BannerWithVideo from './BannerWithVideo'
import { fetcher } from '@src/utils'
import Loading from '@src/app/loading'

const BannerWithVideoContainer = ({ initialData = null, initialETag = null }) => {
  // The server rendered initialData and sent the ETag the banner route gives
  // it. Seeding the fetcher's shared ETag cache with that pair turns SWR's
  // mount revalidation into a 304 instead of a second download of the banner.
  const bannerFetcher = useCallback(
    (url) => fetcher(url, initialETag ? { seed: { etag: initialETag, data: initialData } } : undefined),
    [initialETag, initialData]
  )

  // Use useSWR to fetch data with a 4-second refresh interval
  // The fetcher revalidates with the shared ETag cache (src/utils/conditionalFetch.js)
  // Frequent 4-second polls result in lightweight 304 Not Modified responses
  // initialData is pre-fetched server-side for instant display
  const { data: bannerMediaList, error } = useSWR('/api/authenticated/banner', bannerFetcher, {
    fallbackData: initialData, // Use server-side data as initial value
    refreshInterval: 4000, // 4 seconds - efficient with ETag caching
    dedupingInterval: 4000, // Prevents duplicate requests within this interval
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    shouldRetryOnError: true,
    errorRetryCount: 5,
    errorRetryInterval: 2000, // Retry every 2 seconds
    onError: (err) => {
      console.error('Error fetching banner data:', err)
    },
  })

  // Handle error state
  if (error && !bannerMediaList) {
    return (
      <div className="w-full h-[40vh] md:h-[79vh] bg-black flex items-center justify-center text-white">
        <div className="py-12 flex flex-col gap-2 text-center">
          <span className="text-2xl">⚠️</span>
          <strong>Error loading banner data. Please try again later.</strong>
        </div>
      </div>
    )
  }

  // Handle loading state
  if (!bannerMediaList) {
    return (
      <div className="w-full h-[40vh] md:h-[79vh] bg-black flex items-center justify-center text-white">
        <Loading fullscreenClasses={false} />
      </div>
    )
  }

  // Render BannerWithVideo component if mediaList is available
  return bannerMediaList.length > 0 ? <BannerWithVideo mediaList={bannerMediaList} /> : null
}

export default BannerWithVideoContainer
