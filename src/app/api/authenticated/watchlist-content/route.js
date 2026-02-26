// src/app/api/authenticated/watchlist-content/route.js
import { cache } from 'react'
import { isAuthenticatedEither } from '@src/utils/routeAuth'
import {
  getUserWatchlist,
  getUserPlaylists,
  getPlaylistById,
  getPlaylistVisibility,
  getMinimalCardDataForPlaylist,
  ensureDefaultPlaylist
} from '@src/utils/watchlist/database'
import { sanitizeCardItems } from '@src/utils/auth_utils'
import { addWatchHistoryToItems } from '@src/utils/watchHistoryUtils'
import { ObjectId } from 'mongodb'

/**
 * Watchlist Content API
 * 
 * Dedicated endpoint for fetching watchlist/playlist metadata and content
 * Designed for React Native TV and mobile apps with efficient separation of concerns
 * 
 * Actions:
 * - playlists: List all user playlists with metadata and counts
 * - content: Get paginated content from a specific playlist
 * 
 * Similar pattern to genres endpoint for consistency
 */

/**
 * Transform media items to only include fields used in UX
 * Reduces payload size by ~60-70% for watchlist browsing
 * Similar to minimizeMediaItemsForUX in genres endpoint
 */
function minimizePlaylistItemsForUX(items) {
  if (!items || !Array.isArray(items)) return []
  
  return items.map(item => ({
    id: item.id || item._id?.toString(),
    title: item.title,
    hdr: item.hdr,
    thumbnailUrl: item.posterURL,
    thumbnailBlurhash: item.posterBlurhash,
    type: item.type,
    link: item.link,
    backdropUrl: item.backdrop,
    backdropBlurhash: item.backdropBlurhash,
    logo: item.logo,
    
    // TMDB ID (critical for external items not in library)
    tmdbId: item.tmdbId,
    
    // Availability flags (critical for playlists with external items)
    isAvailable: item.isAvailable,
    isComingSoon: item.isComingSoon,
    comingSoonDate: item.comingSoonDate,
    
    // Include watch history if present
    ...(item.watchHistory && { watchHistory: item.watchHistory }),
    
    // TV device fields (if present)
    ...(item.clipVideoURL && { clipVideoURL: item.clipVideoURL }),
    ...(item.videoURL && { videoURL: item.videoURL }),
    ...(item.duration && { duration: item.duration })
  }))
}

/**
 * Cache getUserWatchlist queries per-request to avoid duplicate fetches
 * Similar to getCachedGenreContent in genres endpoint
 */
const getCachedWatchlistContent = cache(async (params) => {
  return getUserWatchlist(params)
})

// API Route handler
export const GET = async (req) => {
  // Check authentication (supports both web sessions and mobile JWT tokens)
  const authResult = await isAuthenticatedEither(req)
  if (authResult instanceof Response) {
    return authResult // Stop execution if not authenticated
  }

  // Parse query parameters
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action') || 'content'
  const playlistId = searchParams.get('playlistId')
  const page = parseInt(searchParams.get('page') || '0')
  const limit = parseInt(searchParams.get('limit') || '30')
  const mediaType = searchParams.get('type') || searchParams.get('mediaType')
  const isTVdevice = searchParams.get('isTVdevice') === 'true'
  const includeWatchHistory = searchParams.get('includeWatchHistory') === 'true'
  const includeItemCounts = searchParams.get('includeItemCounts') !== 'false' // Default to true
  const includeDefaultPlaylist = searchParams.get('includeDefaultPlaylist') !== 'false' // Default to true
  const includeUnavailableParam = searchParams.get('includeUnavailable')
  const shouldExposeAdditionalData = isTVdevice

  // Extract ALL authentication headers for forwarding to backend TMDB server
  // This allows server-side code to fetch TMDB metadata for external items
  // Supports: Bearer tokens (TV/mobile), session tokens, mobile tokens, and cookies (web)
  const authHeaders = {}
  const authorization = req.headers.get('authorization')
  const xSessionToken = req.headers.get('x-session-token')
  const xMobileToken = req.headers.get('x-mobile-token')
  const cookie = req.headers.get('cookie')
  
  if (authorization) authHeaders['authorization'] = authorization
  if (xSessionToken) authHeaders['x-session-token'] = xSessionToken
  if (xMobileToken) authHeaders['x-mobile-token'] = xMobileToken
  if (cookie) authHeaders['cookie'] = cookie
  
  const hasAuthHeaders = Object.keys(authHeaders).length > 0

  try {
    // Handle different actions
    switch (action) {
      case 'playlists': {
        /**
         * ACTION: List user's playlists with metadata and item counts
         * 
         * Returns lightweight playlist metadata for UI population
         * Includes total/available/unavailable item counts when requested
         */
        
        if (process.env.DEBUG) {
          console.log(`[WATCHLIST_CONTENT_API] Getting playlists for user: ${authResult?.id}, includeItemCounts: ${includeItemCounts}`)
        }

        // Get all user playlists
        const playlists = await getUserPlaylists(authResult?.id)

        // Ensure default playlist exists
        let defaultPlaylistId = null
        if (includeDefaultPlaylist) {
          try {
            const defaultPlaylist = await ensureDefaultPlaylist(new ObjectId(authResult?.id))
            defaultPlaylistId = defaultPlaylist.id
          } catch (error) {
            console.error('Error ensuring default playlist:', error)
          }
        }

        // Enrich playlists with item counts if requested
        if (includeItemCounts && playlists?.length > 0) {
          // Fetch counts in parallel for all playlists
          const countPromises = playlists.map(async (playlist) => {
            try {
              // Get total count
              const totalCount = await getUserWatchlist({
                playlistId: playlist.id,
                countOnly: true,
                userId: authResult?.id
              })

              // Get available count (items in library)
              const availableCount = await getUserWatchlist({
                playlistId: playlist.id,
                countOnly: true,
                internalOnly: true,
                userId: authResult?.id
              })

              // Get counts by type
              const movieCount = await getUserWatchlist({
                playlistId: playlist.id,
                mediaType: 'movie',
                countOnly: true,
                userId: authResult?.id
              })

              const tvCount = await getUserWatchlist({
                playlistId: playlist.id,
                mediaType: 'tv',
                countOnly: true,
                userId: authResult?.id
              })

              return {
                ...playlist,
                itemCounts: {
                  total: totalCount || 0,
                  available: availableCount || 0,
                  unavailable: (totalCount || 0) - (availableCount || 0),
                  movie: movieCount || 0,
                  tv: tvCount || 0
                }
              }
            } catch (error) {
              console.error(`Error fetching counts for playlist ${playlist.id}:`, error)
              return {
                ...playlist,
                itemCounts: {
                  total: 0,
                  available: 0,
                  unavailable: 0,
                  movie: 0,
                  tv: 0
                }
              }
            }
          })

          const enrichedPlaylists = await Promise.all(countPromises)

          return new Response(JSON.stringify({
            playlists: enrichedPlaylists,
            defaultPlaylistId
          }), {
            status: 200,
            headers: {
              'Access-Control-Allow-Origin': '*',
              'Content-Type': 'application/json',
            },
          })
        }

        // Return playlists without counts
        return new Response(JSON.stringify({
          playlists: playlists || [],
          defaultPlaylistId
        }), {
          status: 200,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json',
          },
        })
      }

      case 'content': {
        /**
         * ACTION: Get paginated content from a playlist
         * 
         * PERFORMANCE OPTIMIZATIONS:
         * 
         * 1. Parallelized pagination preview queries (previous/next items run in parallel)
         * 2. Minimal item fetching: Only fetch 1 item for pagination previews instead of full pages
         * 3. Smart sorting: Previous item uses reversed sort order to get last item efficiently
         * 4. React cache(): Deduplicates watchlist queries within the same request
         * 5. Batched watch history: Single MongoDB query for all items instead of 3 separate queries
         * 6. Minimized payload: Only essential fields for UX
         */
        
        // Validate required parameters
        if (!playlistId) {
          return new Response(
            JSON.stringify({ 
              error: 'playlistId parameter is required for content action',
              action,
              timestamp: new Date().toISOString()
            }), 
            {
              status: 400,
              headers: { 'Content-Type': 'application/json' }
            }
          )
        }

        // Comprehensive diagnostic logging for debugging TV vs browser behavior
        const requestId = Math.random().toString(36).substring(7)
        console.log(`[WATCHLIST_CONTENT_API][${requestId}] Request Details:`, {
          userId: authResult?.id,
          playlistId,
          page,
          limit,
          mediaType: mediaType || 'all',
          isTVdevice,
          includeWatchHistory,
          includeUnavailableParam,
          timestamp: new Date().toISOString()
        })

        // Get playlist info and user visibility settings in parallel
        const [playlistInfoResult, visibilityResult] = await Promise.allSettled([
          getPlaylistById(playlistId),
          getPlaylistVisibility(authResult?.id, playlistId)
        ])
        
        const playlistInfo = playlistInfoResult.status === 'fulfilled' ? playlistInfoResult.value : null
        const playlistVisibility = visibilityResult.status === 'fulfilled' ? visibilityResult.value : null
        
        if (playlistInfoResult.status === 'rejected') {
          console.error('Error fetching playlist info:', playlistInfoResult.reason)
        }
        if (visibilityResult.status === 'rejected') {
          console.error('Error fetching playlist visibility:', visibilityResult.reason)
        }

        // Determine whether to hide unavailable items
        // Priority: explicit parameter > user preference > default (false)
        const shouldHideUnavailable = 
          includeUnavailableParam !== undefined && includeUnavailableParam !== null
            ? includeUnavailableParam === 'false'  // Explicit override (inverted logic)
            : playlistVisibility?.hideUnavailable ?? false  // User's preference

        // Get main content items
        const contentResult = await getCachedWatchlistContent({
          playlistId,
          page,
          limit,
          mediaType,
          userId: authResult?.id,
          internalOnly: shouldHideUnavailable
        })

        let items = Array.isArray(contentResult) ? contentResult : []
        
        // Get total count for pagination
        const totalCount = await getUserWatchlist({
          playlistId,
          mediaType,
          countOnly: true,
          userId: authResult?.id,
          internalOnly: shouldHideUnavailable
        })

        const totalResults = totalCount || 0
        const totalPages = Math.ceil(totalResults / limit)
        const currentPage = page

        // Optimize: for previous page, we want the LAST item, so reverse sort order
        // This avoids fetching full page just to get last item
        const sortOrder = playlistInfo?.sortOrder || 'desc'
        const reverseSortOrder = sortOrder === 'asc' ? 'desc' : 'asc'
        
        // Parallelize pagination preview queries (only fetch 1 item each)
        const [prevPageResult, nextPageResult] = await Promise.all([
          // Previous page last item: reverse sort order and fetch first item (which is the last in normal order)
          currentPage > 0
            ? getCachedWatchlistContent({
                playlistId,
                page: currentPage - 1,
                limit: 1, // Only fetch 1 item
                mediaType,
                sortOrder: reverseSortOrder, // Reverse to get last item
                userId: authResult?.id,
                internalOnly: shouldHideUnavailable
              })
            : Promise.resolve(null),
          // Next page first item: normal sort order, limit 1
          currentPage < totalPages - 1
            ? getCachedWatchlistContent({
                playlistId,
                page: currentPage + 1,
                limit: 1, // Only fetch 1 item
                mediaType,
                sortOrder,
                userId: authResult?.id,
                internalOnly: shouldHideUnavailable
              })
            : Promise.resolve(null)
        ])

        let previousItem = null
        let nextItem = null

        // Sanitize context for watchlist items
        const sanitizeContext = {
          dateContext: 'watchlist',
          isTVdevice: isTVdevice
        }

        // Process main items
        if (items && items.length > 0) {
          // Get minimal card data for playlist items
          const cardItems = await getMinimalCardDataForPlaylist(
            items,
            playlistInfo,
            !shouldHideUnavailable,  // includeUnavailable (inverted)
            hasAuthHeaders ? { authHeaders } : {}  // Forward auth headers for TMDB authentication
          )
          
          // Apply TV device handling for episodes and movies
          if (isTVdevice) {
            for (const item of cardItems) {
              // Handle TV shows with episode property
              if (item.type === 'tv' && item.episode) {
                // Ensure episode thumbnail is used as posterURL
                if (item.episode.thumbnail) {
                  item.posterURL = item.episode.thumbnail
                  item.thumbnail = item.episode.thumbnail
                }
                
                if (item.episode.thumbnailBlurhash) {
                  item.thumbnailBlurhash = item.episode.thumbnailBlurhash
                }
                
                // Extract episode number to top level
                if (!item.episodeNumber && item.episode.episodeNumber) {
                  item.episodeNumber = item.episode.episodeNumber
                }
                
                // For TV devices, ensure videoURL is available at top level for clipVideoURL generation
                if (item.episode.videoURL && !item.videoURL) {
                  item.videoURL = item.episode.videoURL
                  if (item.episode.duration && !item.duration) {
                    item.duration = item.episode.duration
                  }
                }
              }
              
              // For movies, ensure videoURL is available when TV device mode is enabled
              if (item.type === 'movie' && !item.videoURL) {
                if (item.media?.videoURL) {
                  item.videoURL = item.media.videoURL
                } else if (item.url) {
                  item.videoURL = item.url
                }
                // Ensure duration is available for clip generation
                if (!item.duration && item.media?.duration) {
                  item.duration = item.media.duration
                }
              }
            }
          }
          
          // Sanitize items with appropriate context
          items = sanitizeCardItems(cardItems, sanitizeContext, shouldExposeAdditionalData)
        } else {
          items = []
        }

        // Process previous item (fetched with reversed sort, first item IS the last item of previous page)
        if (prevPageResult && Array.isArray(prevPageResult) && prevPageResult.length > 0) {
          const prevCardItems = await getMinimalCardDataForPlaylist(
            prevPageResult,
            playlistInfo,
            !shouldHideUnavailable,
            hasAuthHeaders ? { authHeaders } : {}
          )
          
          if (prevCardItems.length > 0) {
            // Don't re-sort! We deliberately fetched with reversed sort
            // The first item is already the last item of the previous page
            const sanitizedPrevItems = sanitizeCardItems(prevCardItems, sanitizeContext, shouldExposeAdditionalData)
            previousItem = sanitizedPrevItems[0]
          }
        }

        // Process next item (first item from next page)
        if (nextPageResult && Array.isArray(nextPageResult) && nextPageResult.length > 0) {
          const nextCardItems = await getMinimalCardDataForPlaylist(
            nextPageResult,
            playlistInfo,
            !shouldHideUnavailable,
            hasAuthHeaders ? { authHeaders } : {}
          )
          
          if (nextCardItems.length > 0) {
            const sanitizedNextItems = sanitizeCardItems(nextCardItems, sanitizeContext, shouldExposeAdditionalData)
            nextItem = sanitizedNextItems[0]
          }
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
                console.log(`[WATCHLIST_CONTENT_API] Adding watch history to ${allItems.length} items in batched query`)
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
            console.error('Error adding watch history to watchlist items:', error)
            // Continue without watch history on error
          }
        }

        // Minimize payload: only return fields used in UX
        const minimizedItems = minimizePlaylistItemsForUX(items)
        const minimizedPrevItem = previousItem ? minimizePlaylistItemsForUX([previousItem])[0] : null
        const minimizedNextItem = nextItem ? minimizePlaylistItemsForUX([nextItem])[0] : null
        
        // Diagnostic logging for response analysis
        const unavailableCount = minimizedItems.filter(item => item.isAvailable === false).length
        const unknownTitleCount = minimizedItems.filter(item => item.title === 'Unknown Title').length
        const nullLinkCount = minimizedItems.filter(item => item.link === null || item.link === '').length
        
        console.log(`[WATCHLIST_CONTENT_API][${requestId}] Response Summary:`, {
          totalItemsReturned: minimizedItems.length,
          unavailableItemsCount: unavailableCount,
          unknownTitleCount: unknownTitleCount,
          nullLinkCount: nullLinkCount,
          hasNextPage: currentPage < totalPages - 1,
          hasPreviousPage: currentPage > 0,
          isTVdevice,
          playlistName: playlistInfo?.name
        })
        
        // If there are unknown titles, log sample items for debugging
        if (unknownTitleCount > 0) {
          const unknownItems = minimizedItems
            .filter(item => item.title === 'Unknown Title')
            .slice(0, 3)
          console.warn(`[WATCHLIST_CONTENT_API][${requestId}] Unknown Title Items Sample:`,
            unknownItems.map(item => ({
              id: item.id,
              tmdbId: item.tmdbId,
              type: item.type,
              isAvailable: item.isAvailable
            })))
        }
        
        const response = {
          currentItems: minimizedItems,
          previousItem: minimizedPrevItem,
          nextItem: minimizedNextItem,
          pagination: {
            currentPage,
            totalPages,
            totalResults,
            hasNextPage: currentPage < totalPages - 1,
            hasPreviousPage: currentPage > 0
          },
          playlistInfo: playlistInfo ? {
            id: playlistInfo.id || playlistId,
            name: playlistInfo.name,
            description: playlistInfo.description || null,
            hideUnavailable: playlistVisibility?.hideUnavailable ?? false,
            sortBy: playlistInfo.sortBy || 'dateAdded',
            sortOrder: playlistInfo.sortOrder || 'desc'
          } : null
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
            error: `Invalid action: ${action}. Supported actions: playlists, content`,
            supportedActions: ['playlists', 'content'],
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
    console.error(`Error in watchlist-content API (action: ${action}):`, error)
    
    return new Response(
      JSON.stringify({ 
        error: error.message || 'Error processing watchlist request',
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
