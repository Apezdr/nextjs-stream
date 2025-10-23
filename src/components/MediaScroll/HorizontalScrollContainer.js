import {
  getPosters,
  getRecentlyAddedMedia,
  getRecentlyWatchedForUser,
} from '@src/utils/auth_database'
import { getRecommendations } from '@src/utils/recommendations'
import { auth } from '@src/lib/auth'
import HorizontalScroll from '@src/components/MediaScroll/HorizontalScroll'
import { getFlatRecommendations } from '@src/utils/flatRecommendations'
import { getFlatPosters, getFlatRecentlyAddedMedia, getFlatRecentlyWatchedForUser } from '@src/utils/flatDatabaseUtils'
import { getUserWatchlist, getPlaylistVisibility } from '@src/utils/watchlist'

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

export default async function HorizontalScrollContainer({
  type = 'all',
  sort = 'id',
  sortOrder = 'desc',
  playlistId = null,
}) {
  let moviePosters = 0,
    tvPosters = 0,
    items = 0,
    limit = null
  const session = await auth()

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
        userId: session.user?.id,
        countOnly: true,
        limit: limit,
      })
      break
    case 'recentlyAdded':
      limit = 32
      items = await getFlatRecentlyAddedMedia({ limit: limit, countOnly: true })
      break
    case 'recommendations':
      limit = 30
      // Fetch count from recommendations
      const recommendationsData = await getFlatRecommendations(session.user?.id, 0, limit, true)
      items = recommendationsData.count || 0
      break
    case 'playlist':
      // Count playlist items respecting user visibility settings (same logic as horizontal-list API)
      if (playlistId) {
        // Check user's visibility settings for this playlist to determine if they want to hide unavailable items
        let hideUnavailable = false
        try {
          const visibility = await getPlaylistVisibility(session.user?.id, playlistId)
          hideUnavailable = visibility?.hideUnavailable ?? false
        } catch (e) {
          console.error('Error fetching playlist visibility for count:', e)
          // Default to showing all content if visibility fetch fails
        }
        
        // Use same internalOnly logic as horizontal-list API
        items = await getUserWatchlist({
          playlistId,
          countOnly: true,
          internalOnly: hideUnavailable  // Conditional filtering based on user preference
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

  return (
    <div className="my-8 w-full">
      {hasItems ? (
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
      )}
    </div>
  )
}
