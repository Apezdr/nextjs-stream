import { cache } from 'react'
import { isAuthenticatedEither } from '@src/utils/routeAuth'
import {
  getFlatAvailableGenres,
  getFlatContentByGenres,
  getFlatGenreStatistics
} from '@src/utils/flatDatabaseUtils'
import { sanitizeCardItems } from '@src/utils/auth_utils'
import { addWatchHistoryToItems } from '@src/utils/watchHistoryUtils'

// Cache genre content queries per-request to avoid duplicate fetches
const getCachedGenreContent = cache(async (params) => {
  return getFlatContentByGenres(params)
})

/**
 * Transform media items to only include fields used in UX
 * Reduces payload size by ~60-70% for genre browsing
 */
function minimizeMediaItemsForUX(items) {
  if (!items || !Array.isArray(items)) return []
  
  return items.map(item => ({
    id: item.id || item._id?.toString(),
    title: item.title,
    hdr: item.hdr,
    thumbnailUrl: item.posterURL,
    thumbnailBlurhash: item.posterBlurhash,
    mediaType: item.type,
    link: item.link,
    backdropUrl: item.backdrop,
    backdropBlurhash: item.backdropBlurhash,
    logo: item.logo,
    // Include watch history if present
    ...(item.watchHistory && { watchHistory: item.watchHistory })
  }))
}

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
        /**
         * PERFORMANCE OPTIMIZATIONS:
         *
         * 1. Parallelized pagination preview queries (previous/next items run in parallel)
         * 2. Minimal item fetching: Only fetch 1 item for pagination previews instead of full pages
         * 3. Smart sorting: Previous item uses reversed sort order to get last item efficiently
         * 4. React cache(): Deduplicates genre queries within the same request
         * 5. Batched watch history: Single MongoDB query for all items instead of 3 separate queries
         */
        
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

        // Get main content - we need totalPages first to determine if we need next page
        const contentResult = await getCachedGenreContent({
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
        
        // Optimize: fetch previous page last item by reversing sort order
        // This avoids fetching full page just to get last item
        const reverseSortOrder = sortOrder === 'asc' ? 'desc' : 'asc'
        
        // Parallelize pagination preview queries (only fetch 1 item each)
        const [prevPageResult, nextPageResult] = await Promise.all([
          // Previous page last item: reverse sort order and fetch first item (which is the last in normal order)
          currentPage > 0
            ? getCachedGenreContent({
                genres,
                type,
                page: currentPage - 1,
                limit: 1, // Only fetch 1 item
                sort,
                sortOrder: reverseSortOrder, // Reverse to get last item
                shouldExposeAdditionalData,
                userId: authResult?.id,
                countOnly: false
              })
            : Promise.resolve(null),
          // Next page first item: normal sort order, limit 1
          currentPage < totalPages - 1
            ? getCachedGenreContent({
                genres,
                type,
                page: currentPage + 1,
                limit: 1, // Only fetch 1 item
                sort,
                sortOrder,
                shouldExposeAdditionalData,
                userId: authResult?.id,
                countOnly: false
              })
            : Promise.resolve(null)
        ])

        let previousItem = null
        let nextItem = null

        // Sanitize context (reused for all items)
        const contextBySort = {
          newest: { dateContext: 'release' },
          oldest: { dateContext: 'release' },
          title: { dateContext: 'release' },
          rating: { dateContext: 'release' }
        }
        const sanitizeContext = contextBySort[sort] || {}

        // Process all items efficiently
        if (items && items.length > 0) {
          // Apply additional sorting if needed (for mixed content types)
          if (type === 'all' && sortFunctions[sort]) {
            items.sort((a, b) => sortFunctions[sort](a, b, sortOrder))
          }
          // Sanitize main items
          items = sanitizeCardItems(items, sanitizeContext, shouldExposeAdditionalData)
        } else {
          items = []
        }

        // Process previous item (fetched with reversed sort, first item IS the last item of previous page)
        if (prevPageResult?.items?.length > 0) {
          // Important: Don't re-sort! We deliberately fetched with reversed sort
          // The first item is already the last item of the previous page
          const sanitizedPrevItems = sanitizeCardItems(prevPageResult.items, sanitizeContext, shouldExposeAdditionalData)
          previousItem = sanitizedPrevItems[0]
        }

        // Process next item (first item from next page)
        if (nextPageResult?.items?.length > 0) {
          // For 'all' type, might need to sort mixed content
          let nextItems = nextPageResult.items
          if (type === 'all' && sortFunctions[sort]) {
            nextItems.sort((a, b) => sortFunctions[sort](a, b, sortOrder))
          }
          const sanitizedNextItems = sanitizeCardItems(nextItems, sanitizeContext, shouldExposeAdditionalData)
          nextItem = sanitizedNextItems[0]
        }

        // Batch watch history for all items (main + previous + next)
        if (includeWatchHistory) {
          try {
            const allItems = [
              ...items,
              ...(previousItem ? [previousItem] : []),
              ...(nextItem ? [nextItem] : [])
            ]

            if (allItems.length > 0) {
              if (process.env.DEBUG) {
                console.log(`[GENRES_API] Adding watch history to ${allItems.length} items in batched query`)
              }
              const itemsWithHistory = await addWatchHistoryToItems(allItems, authResult?.id)
              
              // Redistribute items back
              items = itemsWithHistory.slice(0, items.length)
              if (previousItem) {
                previousItem = itemsWithHistory[items.length]
              }
              if (nextItem) {
                const nextIndex = items.length + (previousItem ? 1 : 0)
                nextItem = itemsWithHistory[nextIndex]
              }
            }
          } catch (error) {
            console.error('Error adding watch history to genre items:', error)
            // Continue without watch history on error
          }
        }

        // Minimize payload: only return fields used in UX
        const response = {
          currentItems: minimizeMediaItemsForUX(items),
          previousItem: previousItem ? minimizeMediaItemsForUX([previousItem])[0] : null,
          nextItem: nextItem ? minimizeMediaItemsForUX([nextItem])[0] : null,
          pagination: {
            currentPage,
            totalPages,
            totalResults,
            hasNextPage: currentPage < totalPages - 1,
            hasPreviousPage: currentPage > 0
          },
          genreInfo: {
            requestedGenres: genres
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
