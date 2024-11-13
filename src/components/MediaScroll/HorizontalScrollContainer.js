import {
  getPosters,
  getRecentlyAddedMedia,
  getRecentlyWatchedForUser,
} from '@src/utils/auth_database'
import { auth } from '@src/lib/auth'
import HorizontalScroll from '@src/components/MediaScroll/HorizontalScroll'

// Define personalized messages for each type
const NO_CONTENT_MESSAGES = {
  movie: "🎬 No movies available at the moment.",
  tv: "📺 No TV shows available at the moment.",
  recentlyWatched: "👀 You haven't watched anything recently.",
  recentlyAdded: "🆕 No recently added media available.",
  all: "📦 No media available at the moment.",
}

export default async function HorizontalScrollContainer({
  type = 'all',
  sort = 'id',
  sortOrder = 'desc',
}) {
  let moviePosters = 0,
    tvPosters = 0,
    items = 0,
    limit = null
  const session = await auth()

  switch (type) {
    case 'movie':
      // Assuming getPosters returns a count when countOnly is true
      items = await getPosters('movie', true)
      break
    case 'tv':
      items = await getPosters('tv', true)
      break
    case 'recentlyWatched':
      limit = 50
      items = await getRecentlyWatchedForUser({
        userId: session.user?.id,
        countOnly: true,
        limit: limit,
      })
      break
    case 'recentlyAdded':
      limit = 30
      items = await getRecentlyAddedMedia({ limit: limit, countOnly: true })
      break
    case 'all':
    default:
      // Assuming getPosters returns a count when countOnly is true
      moviePosters = await getPosters('movie', true)
      tvPosters = await getPosters('tv', true)
      items = moviePosters + tvPosters
  }

  // Determine if there are items to display
  const hasItems = items > 0

  // Get the appropriate message based on type
  const message = NO_CONTENT_MESSAGES[type] || "📭 No content available."

  return (
    <div className="my-8 w-full">
      {hasItems ? (
        <HorizontalScroll numberOfItems={items} listType={type} sort={sort} sortOrder={sortOrder} />
      ) : (
        <div className="py-12 flex flex-col gap-2 text-center text-gray-500">
          <span className="text-2xl text-white">{message}</span>
        </div>
      )}
    </div>
  )
}
