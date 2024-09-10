import {
  getPosters,
  getRecentlyAddedMedia,
  getRecentlyWatchedForUser,
} from '@src/utils/admin_frontend_database'
import HorizontalScroll from './HorizontalScroll'
import { auth } from '@src/lib/auth'

const sortFunctions = {
  id: (a, b, order) => (order === 'asc' ? a - b : b - a),
  title: (a, b, order) =>
    order === 'asc' ? a.title.localeCompare(b.title) : b.title.localeCompare(a.title),
  date: (a, b, order) =>
    order === 'asc' ? new Date(a.date) - new Date(b.date) : new Date(b.date) - new Date(a.date),
  // Add more sorting functions as needed
}

export default async function HorizontalScrollContainer({
  type = 'all',
  sort = 'id',
  sortOrder = 'desc',
}) {
  let moviePosters = [],
    tvPosters = [],
    watched = [],
    addedMedia = [],
    items = []
  const session = await auth()

  const sortList = (a, b) => sortFunctions[sort](a, b, sortOrder)

  switch (type) {
    case 'movie':
      moviePosters = await getPosters('movie')
      if (moviePosters && moviePosters.length > 0) {
        items = moviePosters.sort(sortList)
      }
      break
    case 'tv':
      tvPosters = await getPosters('tv')
      if (tvPosters && tvPosters.length > 0) {
        items = tvPosters.sort(sortList)
      }
      break
    case 'recentlyWatched':
      watched = await getRecentlyWatchedForUser(session.user?.id)
      if (watched && watched.length > 0) {
        items = watched.sort(sortList)
      }
      break
    case 'recentlyAdded':
      addedMedia = await getRecentlyAddedMedia({ limit: 30 })
      if (addedMedia && addedMedia.length > 0) {
        items = addedMedia
      }
      break
    case 'all':
    default:
      moviePosters = await getPosters('movie')
      tvPosters = await getPosters('tv')
      if (moviePosters && moviePosters.length > 0 && tvPosters && tvPosters.length > 0) {
        items = [...tvPosters, ...moviePosters].sort(sortList)
      }
  }

  return <HorizontalScroll items={items} listtype={type} />
}
