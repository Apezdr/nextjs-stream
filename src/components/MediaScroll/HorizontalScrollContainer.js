import { getPosters, getRecentlyWatchedForUser } from 'src/utils/admin_frontend_database'
import HorizontalScroll from './HorizontalScroll'
import { auth } from 'src/lib/auth'

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
    items = []
  const session = await auth()

  const sortList = (a, b) => sortFunctions[sort](a, b, sortOrder)

  switch (type) {
    case 'movie':
      moviePosters = await getPosters('movie')
      items = moviePosters.sort(sortList)
      break
    case 'tv':
      tvPosters = await getPosters('tv')
      items = tvPosters.sort(sortList)
      break
    case 'recentlyWatched':
      watched = await getRecentlyWatchedForUser(session.user?.id)
      items = watched.sort(sortList)
      break
    case 'all':
    default:
      moviePosters = await getPosters('movie')
      tvPosters = await getPosters('tv')
      items = [...tvPosters, ...moviePosters].sort(sortList)
  }

  return <HorizontalScroll items={items} listtype={type} />
}