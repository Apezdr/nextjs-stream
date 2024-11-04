import {
  getPosters,
  getRecentlyAddedMedia,
  getRecentlyWatchedForUser,
} from '@src/utils/auth_database'
import dynamic from 'next/dynamic'
import { auth } from '@src/lib/auth'
const HorizontalScroll = dynamic(() => import('./HorizontalScroll'), { ssr: false })

export default async function HorizontalScrollContainer({
  type = 'all',
  sort = 'id',
  sortOrder = 'desc',
}) {
  let moviePosters = [],
    tvPosters = [],
    items = [],
    limit = null
  const session = await auth()

  switch (type) {
    case 'movie':
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
      moviePosters = await getPosters('movie', true)
      tvPosters = await getPosters('tv', true)
      items = moviePosters + tvPosters
  }

  return (
    <HorizontalScroll numberOfItems={items} listType={type} sort={sort} sortOrder={sortOrder} />
  )
}
