'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import { fetcher } from '@src/utils'
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
 * While the list is empty it asks the horizontal-list API for a one-item page
 * every 30 seconds, through the shared fetcher, so an unchanged answer is a 304.
 * SWR's focus detection keeps background tabs from polling.
 *
 * Once content appears it stops polling and refreshes the route: the server
 * render is what counts the list's items (and so its pages), and this probe
 * only ever sees one. Until the refreshed render arrives it shows the list's
 * first page. A server section that is still cached as empty renders this
 * component again; it keeps its state and goes on showing that first page.
 */
export default function EmptyStateWithRetry({
  message,
  listType = 'all',
  sort = 'id',
  sortOrder = 'desc',
  playlistId = null,
}) {
  const router = useRouter()
  // Items seen by the probe; 0 while the list is still empty
  const [foundItems, setFoundItems] = useState(0)

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

  // A null key once content is found stops the polling
  useSWR(foundItems > 0 ? null : `/api/authenticated/horizontal-list?${queryParams}`, fetcher, {
    refreshInterval: 30000, // Poll every 30 seconds
    revalidateOnFocus: true, // Check when tab regains focus
    revalidateOnReconnect: true, // Check when connection restored
    dedupingInterval: 5000, // Don't spam same request within 5s
    errorRetryInterval: 60000, // If error, retry in 60s
    errorRetryCount: 5, // Stop retrying after 5 failures
    onSuccess: (data) => {
      const count = data?.currentItems?.length ?? 0
      if (count > 0) {
        setFoundItems(count)
        router.refresh()
      }
    },
  })

  if (foundItems > 0) {
    return (
      <HorizontalScroll
        numberOfItems={foundItems}
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
