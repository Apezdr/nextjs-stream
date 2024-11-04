import isAuthenticated from '@src/utils/routeAuth'
import {
  getPosters,
  getRecentlyAddedMedia,
  getRecentlyWatchedForUser,
} from '@src/utils/auth_database'
import { sanitizeCardData, sanitizeCardItems } from '@src/utils/auth_utils'

// Sorting functions
const sortFunctions = {
  id: (a, b, order) => (order === 'asc' ? a.id - b.id : b.id - a.id),
  title: (a, b, order) =>
    order === 'asc' ? a.title.localeCompare(b.title) : b.title.localeCompare(a.title),
  date: (a, b, order) =>
    order === 'asc' ? new Date(a.date) - new Date(b.date) : new Date(b.date) - new Date(a.date),
  // Add more sorting functions as needed
}

// API Route handler
export const GET = async (req) => {
  // Check authentication
  const authResult = await isAuthenticated(req)
  if (authResult instanceof Response) {
    return authResult // Stop execution if not authenticated
  }

  // Parse query parameters for type, sort, and sortOrder
  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type') || 'all'
  const sort = searchParams.get('sort') || 'id'
  const sortOrder = searchParams.get('sortOrder') || 'desc'
  const page = parseInt(searchParams.get('page') || '0')
  const itemsPerPage = parseInt(searchParams.get('limit') || '30')

  let items = []
  let previousItem = null
  let nextItem = null

  // Perform operations based on the type parameter
  const sortList = (a, b) => sortFunctions[sort](a, b, sortOrder)

  try {
    // Function to fetch items for a given page
    const fetchItemsForPage = async (pageNumber, limit) => {
      switch (type) {
        case 'movie':
          return await getPosters('movie', false, pageNumber, limit)
        case 'tv':
          return await getPosters('tv', false, pageNumber, limit)
        case 'recentlyWatched':
          return await getRecentlyWatchedForUser({
            userId: authResult?.id,
            page: pageNumber,
            limit: limit,
          })
        case 'recentlyAdded':
          return await getRecentlyAddedMedia({ page: pageNumber, limit: limit })
        case 'all':
        default: {
          const [moviePosters, tvPosters] = await Promise.all([
            getPosters('movie', false, pageNumber, limit),
            getPosters('tv', false, pageNumber, limit),
          ])
          return [...moviePosters, ...tvPosters]
        }
      }
    }

    // Fetch current items
    items = await fetchItemsForPage(page, itemsPerPage)
    if (items && items.length > 0) {
      const sorted = items.sort(sortList)
      items = await sanitizeCardItems(sorted)
    } else {
      items = []
    }

    // Fetch previous item
    if (page > 0) {
      const prevPageItems = await fetchItemsForPage(page - 1, itemsPerPage)
      if (prevPageItems && prevPageItems.length > 0) {
        prevPageItems.sort(sortList)
        previousItem = prevPageItems[prevPageItems.length - 1] // Get the last item
        previousItem = await sanitizeCardData(previousItem)
      }
    }

    // Fetch next item
    const nextPageItems = await fetchItemsForPage(page + 1, itemsPerPage)
    if (nextPageItems && nextPageItems.length > 0) {
      nextPageItems.sort(sortList)
      nextItem = nextPageItems[0] // Get the first item
      nextItem = await sanitizeCardData(nextItem)
    }

    // Return the items along with previous and next items
    return new Response(
      JSON.stringify({
        currentItems: items,
        previousItem: previousItem || null,
        nextItem: nextItem || null,
      }),
      {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': '*', // Allows all origins
          'Content-Type': 'application/json',
        },
      }
    )
  } catch (error) {
    // Handle any errors during the fetch process
    return new Response(JSON.stringify({ error: error.message || 'Error fetching media' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
