import { Suspense } from 'react'
import HorizontalScroll from '@src/components/MediaScroll/HorizontalScroll'
import { getFlatRecommendations } from '@src/utils/flatRecommendations'
import { getFlatPosters, getFlatRecentlyAddedMedia, getFlatRecentlyWatchedForUser } from '@src/utils/flatDatabaseUtils'
import { getUserWatchlist, getPlaylistVisibility } from '@src/utils/watchlist'
import HorizontalScrollSkeleton from './HorizontalScrollSkeleton'
import EmptyStateWithRetry from './EmptyStateWithRetry'

// Import already cached functions directly - no need to double-wrap with cache()
// These functions are already cached in their respective modules
const getCachedPosters = getFlatPosters
const getCachedRecentlyWatched = getFlatRecentlyWatchedForUser
const getCachedRecentlyAdded = getFlatRecentlyAddedMedia
const getCachedRecommendations = getFlatRecommendations
const getCachedWatchlist = getUserWatchlist
const getCachedPlaylistVisibility = getPlaylistVisibility

// Define personalized messages for each type
const NO_CONTENT_MESSAGES = {
  movie: "🎬 No movies available at the moment.",
  tv: "📺 No TV shows available at the moment.",
  recentlyWatched: "👀 You haven't watched anything recently.",
  recentlyAdded: "🆕 No recently added media available.",
  recommendations: "🎯 No personalized recommendations available right now.",
  playlist: "📂 No items in this playlist yet.",
  all: "📦 No media available at the moment.",
}

// Dynamic component that performs fresh database queries
async function DynamicMediaContent({
  type = 'all',
  sort = 'id',
  sortOrder = 'desc',
  playlistId = null,
  userId = null, // Accept userId as prop instead of calling auth()
}) {
  let items = 0

  switch (type) {
    case 'movie':
      // Use cached function for request-level deduplication
      items = await getCachedPosters('movie', true)
      break
    case 'tv':
      items = await getCachedPosters('tv', true)
      break
    case 'recentlyWatched': {
      const limit = 50
      items = await getCachedRecentlyWatched({
        userId: userId,
        countOnly: true,
        limit: limit,
      })
      break
    }
    case 'recentlyAdded': {
      const limit = 32
      items = await getCachedRecentlyAdded({ limit: limit, countOnly: true })
      break
    }
    case 'recommendations': {
      const limit = 30
      // Fetch count from recommendations using cached function
      const recommendationsData = await getCachedRecommendations(userId, 0, limit, true)
      items = recommendationsData.count || 0
      break
    }
    case 'playlist':
      // Count playlist items respecting user visibility settings (same logic as horizontal-list API)
      if (playlistId) {
        // OPTIMIZATION: Fetch visibility + both watchlist variants (all and filtered) in parallel
        // to eliminate conditional waterfalls. React.cache() will deduplicate identical calls.
        const [visibilityResult, allItemsResult, filteredItemsResult] = await Promise.allSettled([
          getCachedPlaylistVisibility(userId, playlistId),
          getCachedWatchlist({
            playlistId,
            countOnly: true,
            internalOnly: false,
            userId: userId,
          }),
          getCachedWatchlist({
            playlistId,
            countOnly: true,
            internalOnly: true,
            userId: userId,
          })
        ])
        
        const hideUnavailable = visibilityResult.status === 'fulfilled' 
          ? visibilityResult.value?.hideUnavailable ?? false 
          : false
        
        // Use the appropriate result based on hideUnavailable setting
        if (hideUnavailable) {
          items = filteredItemsResult.status === 'fulfilled' ? filteredItemsResult.value : 0
        } else {
          items = allItemsResult.status === 'fulfilled' ? allItemsResult.value : 0
        }
        
        if (allItemsResult.status === 'rejected' && filteredItemsResult.status === 'rejected') {
          console.error('Error fetching playlist items for count')
        }
      } else {
        items = 0
      }
      break
    case 'all':
    default: {
      // CRITICAL FIX: Run movie and TV queries in parallel (async-parallel pattern)
      const [moviePostersResult, tvPostersResult] = await Promise.all([
        getCachedPosters('movie', true),
        getCachedPosters('tv', true)
      ])
      items = moviePostersResult + tvPostersResult
      break
    }
  }

  // Determine if there are items to display
  const hasItems = items > 0

  // Get the appropriate message based on type
  const message = NO_CONTENT_MESSAGES[type] || "📭 No content available."

  return hasItems ? (
    <HorizontalScroll
      numberOfItems={items}
      listType={type}
      sort={sort}
      sortOrder={sortOrder}
      playlistId={playlistId}
    />
  ) : (
    <EmptyStateWithRetry
      message={message}
      listType={type}
      sort={sort}
      sortOrder={sortOrder}
      playlistId={playlistId}
    />
  )
}

// Main component with Suspense boundary for PPR
export default function HorizontalScrollContainer({
  type = 'all',
  sort = 'id',
  sortOrder = 'desc',
  playlistId = null,
  userId = null, // Accept userId as prop (primitive, not full user object)
}) {
  return (
    <div className="my-8 w-full">
      {/* Suspense boundary - static shell shows immediately, content streams in */}
      <Suspense fallback={<HorizontalScrollSkeleton type={type} />}>
        <DynamicMediaContent
          type={type}
          sort={sort}
          sortOrder={sortOrder}
          playlistId={playlistId}
          userId={userId}
        />
      </Suspense>
    </div>
  )
}
