import { Suspense, cache } from 'react'
import HorizontalScroll from '@src/components/MediaScroll/HorizontalScroll'
import { getFlatRecommendations } from '@src/utils/flatRecommendations'
import { getFlatPosters, getFlatRecentlyAddedMedia, getFlatRecentlyWatchedForUser } from '@src/utils/flatDatabaseUtils'
import { getUserWatchlist, getPlaylistVisibility } from '@src/utils/watchlist'
import HorizontalScrollSkeleton from './HorizontalScrollSkeleton'

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
  user = null, // Accept user as prop instead of calling auth()
}) {
  let moviePosters = 0,
    tvPosters = 0,
    items = 0,
    limit = null

  switch (type) {
    case 'movie':
      // Use cached function for request-level deduplication
      items = await getCachedPosters('movie', true)
      break
    case 'tv':
      items = await getCachedPosters('tv', true)
      break
    case 'recentlyWatched':
      limit = 50
      items = await getCachedRecentlyWatched({
        userId: user?.id,
        countOnly: true,
        limit: limit,
      })
      break
    case 'recentlyAdded':
      limit = 32
      items = await getCachedRecentlyAdded({ limit: limit, countOnly: true })
      break
    case 'recommendations': {
      limit = 30
      // Fetch count from recommendations using cached function
      const recommendationsData = await getCachedRecommendations(user?.id, 0, limit, true)
      items = recommendationsData.count || 0
      break
    }
    case 'playlist':
      // Count playlist items respecting user visibility settings (same logic as horizontal-list API)
      if (playlistId) {
        // OPTIMIZATION: Use Promise.allSettled to run visibility and watchlist queries in parallel
        const [visibilityResult, watchlistResult] = await Promise.allSettled([
          getCachedPlaylistVisibility(user?.id, playlistId),
          getCachedWatchlist({
            playlistId,
            countOnly: true,
            internalOnly: false, // Get all items initially
            userId: user?.id,
          })
        ])
        
        const hideUnavailable = visibilityResult.status === 'fulfilled' 
          ? visibilityResult.value?.hideUnavailable ?? false 
          : false
        
        if (watchlistResult.status === 'fulfilled') {
          // If we need to hide unavailable items and got all items, re-fetch with filtering
          if (hideUnavailable) {
            items = await getCachedWatchlist({
              playlistId,
              countOnly: true,
              internalOnly: true,
              userId: user?.id,
            })
          } else {
            items = watchlistResult.value
          }
        } else {
          console.error('Error fetching playlist items for count:', watchlistResult.reason)
          items = 0
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
      moviePosters = moviePostersResult
      tvPosters = tvPostersResult
      items = moviePosters + tvPosters
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
    <div className="py-12 flex flex-col gap-2 text-center text-gray-500">
      <span className="text-2xl text-white">{message}</span>
    </div>
  )
}

// Main component with Suspense boundary for PPR
export default function HorizontalScrollContainer({
  type = 'all',
  sort = 'id',
  sortOrder = 'desc',
  playlistId = null,
  user = null, // Accept user as prop
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
          user={user}
        />
      </Suspense>
    </div>
  )
}
