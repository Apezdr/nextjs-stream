import isAuthenticated from '@src/utils/routeAuth'
import {
  getFlatPosters,
  getFlatRecentlyAddedMedia,
  getFlatRecentlyWatchedForUser,
} from '@src/utils/flatDatabaseUtils'
import { sanitizeCardData, sanitizeCardItems } from '@src/utils/auth_utils'
import { getRecommendations } from '@src/utils/recommendations'
import { getFlatRecommendations } from '@src/utils/flatRecommendations'
import { getFullImageUrl } from '@src/utils'

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
          return await getFlatPosters('movie', false, pageNumber, limit)
        case 'tv':
          return await getFlatPosters('tv', false, pageNumber, limit)
        case 'recentlyWatched':
          return await getFlatRecentlyWatchedForUser({
            userId: authResult?.id,
            page: pageNumber,
            limit: limit,
          })
        case 'recentlyAdded':
          return await getFlatRecentlyAddedMedia({ 
            page: pageNumber, 
            limit: limit,
          })
        case 'recommendations':
          //const recommendations = await getRecommendations(authResult?.id, pageNumber, limit)
          const recommendations = await getFlatRecommendations(
            authResult?.id, 
            pageNumber, 
            limit,
          )
          return recommendations.items || []
        case 'all':
        default: {
          const [moviePosters, tvPosters] = await Promise.all([
            getFlatPosters('movie', false, pageNumber, limit),
            getFlatPosters('tv', false, pageNumber, limit),
          ])
          return [...moviePosters, ...tvPosters]
        }
      }
    }

    // Fetch current items
    items = await fetchItemsForPage(page, itemsPerPage)
    if (items && items.length > 0) {
      // First sort the items
      const sorted = items.sort(sortList)
      
      // For recently added items, they're already sanitized with proper structure
      // For other item types that might not be fully sanitized, make sure thumbnails and posters are set for TV episodes
      if (type !== 'recentlyAdded') {
        for (const item of sorted) {
          if (item.type === 'tv' && item.episode) {
            // Make sure episode has a thumbnail (use metadata still_path or fallback to posterURL)
            if (!item.episode.thumbnail) {
              item.episode.thumbnail = 
                (item.episode.metadata?.still_path ? 
                 getFullImageUrl(item.episode.metadata.still_path) : 
                 item.posterURL);
            }
            
            // Use episode thumbnail as the posterURL for TV episodes
            if (item.episode.thumbnail) {
              item.posterURL = item.episode.thumbnail;
              item.thumbnail = item.episode.thumbnail;
            }
            
            if (item.episode.thumbnailBlurhash) {
              item.thumbnailBlurhash = item.episode.thumbnailBlurhash;
            }
            
            // Make sure episodeNumber is included at the top level
            if (!item.episodeNumber && item.episode.episodeNumber) {
              item.episodeNumber = item.episode.episodeNumber;
            }
          }
        }
      }
      
      // Then sanitize the items with appropriate context based on type
      const contextByType = {
        recentlyWatched: { dateContext: 'watchHistory' },
        recentlyAdded: { dateContext: 'recentlyAdded' },
        recommendations: { dateContext: 'recommendations' },
        // For other types, we'll rely on the default context
      };
      
      // Pass the appropriate context for this type of list
      items = sanitizeCardItems(sorted, contextByType[type] || {})
    } else {
      items = []
    }

    // Fetch previous item
    if (page > 0) {
      const prevPageItems = await fetchItemsForPage(page - 1, itemsPerPage)
      if (prevPageItems && prevPageItems.length > 0) {
        prevPageItems.sort(sortList)
        previousItem = prevPageItems[prevPageItems.length - 1] // Get the last item
        const contextByType = {
          recentlyWatched: { dateContext: 'watchHistory' },
          recentlyAdded: { dateContext: 'recentlyAdded' },
          recommendations: { dateContext: 'recommendations' },
          // For other types, we'll rely on the default context
        };
        
        // Apply same context to previous item
        previousItem = await sanitizeCardData(previousItem, false, contextByType[type] || {})
      }
    }

    // Fetch next item
    const nextPageItems = await fetchItemsForPage(page + 1, itemsPerPage)
    if (nextPageItems && nextPageItems.length > 0) {
      nextPageItems.sort(sortList)
      nextItem = nextPageItems[0] // Get the first item
      // Define context for next item (to match the previous implementations)
      const contextByType = {
        recentlyWatched: { dateContext: 'watchHistory' },
        recentlyAdded: { dateContext: 'recentlyAdded' },
        recommendations: { dateContext: 'recommendations' },
        // For other types, we'll rely on the default context
      };
      
      // Apply same context to next item
      nextItem = await sanitizeCardData(nextItem, false, contextByType[type] || {})
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
