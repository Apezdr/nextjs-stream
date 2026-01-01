import { Suspense } from 'react'
import HorizontalScroll from '@src/components/MediaScroll/HorizontalScroll'
import { getFlatRecommendations } from '@src/utils/flatRecommendations'
import { getFlatPosters, getFlatRecentlyAddedMedia, getFlatRecentlyWatchedForUser } from '@src/utils/flatDatabaseUtils'
import { getUserWatchlist, getPlaylistVisibility } from '@src/utils/watchlist'
import HorizontalScrollSkeleton from './HorizontalScrollSkeleton'

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
      // Assuming getPosters returns a count when countOnly is true
      items = await getFlatPosters('movie', true)
      break
    case 'tv':
      items = await getFlatPosters('tv', true)
      break
    case 'recentlyWatched':
      limit = 50
      items = await getFlatRecentlyWatchedForUser({
        userId: user?.id,
        countOnly: true,
        limit: limit,
      })
      break
    case 'recentlyAdded':
      limit = 32
      items = await getFlatRecentlyAddedMedia({ limit: limit, countOnly: true })
      break
    case 'recommendations': {
      limit = 30
      // Fetch count from recommendations
      const recommendationsData = await getFlatRecommendations(user?.id, 0, limit, true)
      items = recommendationsData.count || 0
      break
    }
    case 'playlist':
      // Count playlist items respecting user visibility settings (same logic as horizontal-list API)
      if (playlistId) {
        // Check user's visibility settings for this playlist to determine if they want to hide unavailable items
        let hideUnavailable = false
        try {
          const visibility = await getPlaylistVisibility(user?.id, playlistId)
          hideUnavailable = visibility?.hideUnavailable ?? false
        } catch (e) {
          console.error('Error fetching playlist visibility for count:', e)
          // Default to showing all content if visibility fetch fails
        }
        
        // Use same internalOnly logic as horizontal-list API
        items = await getUserWatchlist({
          playlistId,
          countOnly: true,
          internalOnly: hideUnavailable,  // Conditional filtering based on user preference
          userId: user?.id,
        })
      } else {
        items = 0
      }
      break
    case 'all':
    default:
      // Assuming getPosters returns a count when countOnly is true
      moviePosters = await getFlatPosters('movie', true)
      tvPosters = await getFlatPosters('tv', true)
      items = moviePosters + tvPosters
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
