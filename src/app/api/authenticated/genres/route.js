import { isAuthenticatedEither } from '@src/utils/routeAuth'
import {
  getFlatAvailableGenres,
  getFlatContentByGenres,
  getFlatGenreStatistics
} from '@src/utils/flatDatabaseUtils'
import { sanitizeCardItems } from '@src/utils/auth_utils'
import { addWatchHistoryToItems } from '@src/utils/watchHistoryUtils'

// Sorting functions for content
const sortFunctions = {
  newest: (a, b, order) => {
    const aDate = new Date(a.metadata?.release_date || a.metadata?.first_air_date || 0)
    const bDate = new Date(b.metadata?.release_date || b.metadata?.first_air_date || 0)
    return order === 'asc' ? aDate - bDate : bDate - aDate
  },
  oldest: (a, b, order) => {
    const aDate = new Date(a.metadata?.release_date || a.metadata?.first_air_date || 0)
    const bDate = new Date(b.metadata?.release_date || b.metadata?.first_air_date || 0)
    return order === 'asc' ? aDate - bDate : bDate - aDate
  },
  title: (a, b, order) =>
    order === 'asc' ? a.title.localeCompare(b.title) : b.title.localeCompare(a.title),
  rating: (a, b, order) => {
    const aRating = a.metadata?.vote_average || 0
    const bRating = b.metadata?.vote_average || 0
    return order === 'asc' ? aRating - bRating : bRating - aRating
  }
}

// API Route handler
export const GET = async (req) => {
  // Check authentication (supports both web sessions and mobile JWT tokens)
  const authResult = await isAuthenticatedEither(req)
  if (authResult instanceof Response) {
    return authResult // Stop execution if not authenticated
  }

  // Parse query parameters
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action') || 'list'
  const genreParam = searchParams.get('genre')
  const type = searchParams.get('type') || 'all'
  const page = parseInt(searchParams.get('page') || '0')
  const limit = parseInt(searchParams.get('limit') || '30')
  const sort = searchParams.get('sort') || 'newest'
  const sortOrder = searchParams.get('sortOrder') || 'desc'
  const isTVdevice = searchParams.get('isTVdevice') === 'true'
  const includeWatchHistory = searchParams.get('includeWatchHistory') === 'true'
  const includeCounts = searchParams.get('includeCounts') !== 'false' // Default to true
  const shouldExposeAdditionalData = isTVdevice

  try {
    // Handle different actions
    switch (action) {
      case 'list': {
        // Get available genres with optional counts
        if (process.env.DEBUG) {
          console.log(`[GENRES_API] Getting available genres for type: ${type}, includeCounts: ${includeCounts}`)
        }

        const genreData = await getFlatAvailableGenres({
          type,
          includeCounts,
          countOnly: false
        })

        const response = {
          ...genreData,
          filters: {
            type,
            includeCounts
          }
        }

        return new Response(JSON.stringify(response), {
          status: 200,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json',
          },
        })
      }

      case 'content': {
        // Get content filtered by genres
        if (!genreParam) {
          return new Response(
            JSON.stringify({ 
              error: 'Genre parameter is required for content action',
              action,
              timestamp: new Date().toISOString()
            }), 
            {
              status: 400,
              headers: { 'Content-Type': 'application/json' }
            }
          )
        }

        // Parse genres (support comma-separated values)
        const genres = genreParam.split(',').map(g => g.trim()).filter(Boolean)
        
        if (genres.length === 0) {
          return new Response(
            JSON.stringify({ 
              error: 'At least one valid genre must be specified',
              action,
              timestamp: new Date().toISOString()
            }), 
            {
              status: 400,
              headers: { 'Content-Type': 'application/json' }
            }
          )
        }

        if (process.env.DEBUG) {
          console.log(`[GENRES_API] Getting content for genres: ${genres.join(', ')}, type: ${type}, page: ${page}`)
        }

        // Get content filtered by genres
        const contentResult = await getFlatContentByGenres({
          genres,
          type,
          page,
          limit,
          sort,
          sortOrder,
          shouldExposeAdditionalData,
          userId: authResult?.id,
          countOnly: false
        })

        let { items, totalResults, currentPage, totalPages } = contentResult
        let previousItem = null
        let nextItem = null

        if (items && items.length > 0) {
          // Apply additional sorting if needed (for mixed content types)
          if (type === 'all' && sortFunctions[sort]) {
            items.sort((a, b) => sortFunctions[sort](a, b, sortOrder))
          }

          // Sanitize items with appropriate context
          const contextBySort = {
            newest: { dateContext: 'release' },
            oldest: { dateContext: 'release' },
            title: { dateContext: 'release' },
            rating: { dateContext: 'release' }
          }

          items = sanitizeCardItems(items, contextBySort[sort] || {}, shouldExposeAdditionalData)

          // Add watch history if requested
          if (includeWatchHistory && items.length > 0) {
            try {
              if (process.env.DEBUG) {
                console.log(`[GENRES_API] Adding watch history to ${items.length} items`)
              }
              items = await addWatchHistoryToItems(items, authResult?.id)
            } catch (error) {
              console.error('Error adding watch history to genre items:', error)
              // Continue without watch history on error
            }
          }

          // Get previous and next items for pagination
          if (currentPage > 0) {
            const prevPageResult = await getFlatContentByGenres({
              genres,
              type,
              page: currentPage - 1,
              limit,
              sort,
              sortOrder,
              shouldExposeAdditionalData,
              userId: authResult?.id,
              countOnly: false
            })

            if (prevPageResult.items && prevPageResult.items.length > 0) {
              const prevItems = prevPageResult.items
              if (type === 'all' && sortFunctions[sort]) {
                prevItems.sort((a, b) => sortFunctions[sort](a, b, sortOrder))
              }
              const sanitizedPrevItems = sanitizeCardItems(prevItems, contextBySort[sort] || {}, shouldExposeAdditionalData)
              previousItem = sanitizedPrevItems[sanitizedPrevItems.length - 1] // Last item of previous page

              if (includeWatchHistory && previousItem) {
                try {
                  const prevItemWithHistory = await addWatchHistoryToItems([previousItem], authResult?.id)
                  previousItem = prevItemWithHistory[0]
                } catch (error) {
                  console.error('Error adding watch history to previous item:', error)
                }
              }
            }
          }

          // Get next item
          if (currentPage < totalPages - 1) {
            const nextPageResult = await getFlatContentByGenres({
              genres,
              type,
              page: currentPage + 1,
              limit,
              sort,
              sortOrder,
              shouldExposeAdditionalData,
              userId: authResult?.id,
              countOnly: false
            })

            if (nextPageResult.items && nextPageResult.items.length > 0) {
              const nextItems = nextPageResult.items
              if (type === 'all' && sortFunctions[sort]) {
                nextItems.sort((a, b) => sortFunctions[sort](a, b, sortOrder))
              }
              const sanitizedNextItems = sanitizeCardItems(nextItems, contextBySort[sort] || {}, shouldExposeAdditionalData)
              nextItem = sanitizedNextItems[0] // First item of next page

              if (includeWatchHistory && nextItem) {
                try {
                  const nextItemWithHistory = await addWatchHistoryToItems([nextItem], authResult?.id)
                  nextItem = nextItemWithHistory[0]
                } catch (error) {
                  console.error('Error adding watch history to next item:', error)
                }
              }
            }
          }
        } else {
          items = []
        }

        const response = {
          currentItems: items,
          previousItem: previousItem || null,
          nextItem: nextItem || null,
          genreInfo: {
            requestedGenres: genres,
            totalResults,
            currentPage,
            totalPages
          },
          filters: {
            type,
            sort,
            sortOrder
          }
        }

        return new Response(JSON.stringify(response), {
          status: 200,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json',
          },
        })
      }

      case 'statistics': {
        // Get genre statistics
        const genreFilter = genreParam ? genreParam.split(',').map(g => g.trim()).filter(Boolean) : null
        
        if (process.env.DEBUG) {
          console.log(`[GENRES_API] Getting genre statistics for type: ${type}`)
        }

        const statistics = await getFlatGenreStatistics({
          type,
          genres: genreFilter
        })

        const response = {
          ...statistics,
          filters: {
            type,
            genres: genreFilter
          }
        }

        return new Response(JSON.stringify(response), {
          status: 200,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json',
          },
        })
      }

      default: {
        return new Response(
          JSON.stringify({ 
            error: `Invalid action: ${action}. Supported actions: list, content, statistics`,
            supportedActions: ['list', 'content', 'statistics'],
            timestamp: new Date().toISOString()
          }), 
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          }
        )
      }
    }
  } catch (error) {
    // Handle any errors during the fetch process
    console.error(`Error in genres API (action: ${action}):`, error)
    
    return new Response(
      JSON.stringify({ 
        error: error.message || 'Error processing genre request',
        action,
        timestamp: new Date().toISOString()
      }), 
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  }
}
