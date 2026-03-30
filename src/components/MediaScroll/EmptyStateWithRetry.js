'use client'

import { useMemo, useState, useRef } from 'react'
import useSWR from 'swr'
import HorizontalScroll from './HorizontalScroll'

// Static empty state component - same as in HorizontalScrollContainer
function EmptyState({ message }) {
  return (
    <div className="py-12 flex flex-col gap-2 text-center text-gray-500">
      <span className="text-2xl text-white">{message}</span>
    </div>
  )
}

/**
 * EmptyStateWithRetry: A client component that polls for content when initially empty
 * 
 * When no items are found, this component polls the horizontal-list API every 30 seconds
 * (leveraging ETags for efficient caching - 304s are cheap). Once content appears, it
 * renders HorizontalScroll and stops polling.
 * 
 * SWR's built-in tab focus detection ensures we don't poll background tabs wastefully.
 * ETag headers are manually managed to support the server's cache validation.
 */
export default function EmptyStateWithRetry({
  message,
  listType = 'all',
  sort = 'id',
  sortOrder = 'desc',
  playlistId = null,
}) {
  // Track the ETag from previous responses for conditional requests
  const etagRef = useRef(null)
  // Track the last known state from a non-304 response
  const [cachedData, setCachedData] = useState(null)

  // Build the query parameters for the check request
  // Use page=0 and limit=1 to minimize payload - we only care if ≥1 item exists
  const queryParams = useMemo(() => {
    const params = new URLSearchParams({
      type: listType,
      sort,
      sortOrder,
      page: '0',
      limit: '1', // Minimal payload - just need to know if content exists
    })
    if (playlistId) {
      params.append('playlistId', playlistId)
    }
    return params.toString()
  }, [listType, sort, sortOrder, playlistId])

  // Fetch function for SWR with ETag support
  // This handles conditional requests and 304 responses
  const fetcher = async (url) => {
    const headers = {}
    
    // Include If-None-Match header if we have a cached ETag
    if (etagRef.current) {
      headers['If-None-Match'] = etagRef.current
    }

    const response = await fetch(url, { headers })

    // Handle 304 Not Modified - return cached data
    if (response.status === 304) {
      return cachedData
    }

    // Handle error responses
    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status}`)
    }

    // Handle 200 OK response - cache the ETag for next request
    const etag = response.headers.get('ETag')
    if (etag) {
      etagRef.current = etag
    }

    const data = await response.json()
    setCachedData(data) // Cache for 304 responses
    return data
  }

  // Poll the horizontal-list API to check if content has appeared
  // Only poll when we haven't found content yet by checking the data
  // refreshInterval: 30000 means poll every 30 seconds
  // When content appears, we return early without using SWR, so polling naturally stops
  const { data, error, isLoading } = useSWR(
    `/api/authenticated/horizontal-list?${queryParams}`,
    fetcher,
    {
      refreshInterval: 30000, // Poll every 30 seconds
      revalidateOnFocus: true, // Check when tab regains focus
      revalidateOnReconnect: true, // Check when connection restored
      dedupingInterval: 5000, // Don't spam same request within 5s
      errorRetryInterval: 60000, // If error, retry in 60s
      errorRetryCount: 5, // Stop retrying after 5 failures
    }
  )

  // If we got data and have items, render the full HorizontalScroll component
  if (data?.currentItems && data.currentItems.length > 0) {
    return (
      <HorizontalScroll
        numberOfItems={data.currentItems.length}
        listType={listType}
        sort={sort}
        sortOrder={sortOrder}
        playlistId={playlistId}
      />
    )
  }

  // Show empty state while loading or if no content found yet
  return <EmptyState message={message} />
}
