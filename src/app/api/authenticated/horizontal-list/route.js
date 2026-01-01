// src/app/api/authenticated/horizontal-list/route.js
import isAuthenticated, { isAuthenticatedEither } from '@src/utils/routeAuth'
import {
  getFlatPosters,
  getFlatRecentlyAddedMedia,
  getFlatRecentlyWatchedForUser,
  getFlatTVShowsWithEpisodeData,
} from '@src/utils/flatDatabaseUtils'
import { sanitizeCardData, sanitizeCardItems } from '@src/utils/auth_utils'
import { getRecommendations } from '@src/utils/recommendations'
import { getFlatRecommendations } from '@src/utils/flatRecommendations'
import { getFullImageUrl } from '@src/utils'
import { addWatchHistoryToItems } from '@src/utils/watchHistoryUtils'
// Watchlist playlist support
import { getUserWatchlist, getPlaylistById, getMinimalCardDataForPlaylist, getPlaylistVisibility } from '@src/utils/watchlist'
// Cached data fetchers for improved performance
import {
  getCachedMovieList,
  getCachedTVList,
  getCachedRecentlyAdded,
  getCachedAllMedia
} from '@src/utils/cache/horizontalListData'

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
  // Check authentication (supports both web sessions and sessionId)
  const authResult = await isAuthenticatedEither(req)
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
  const isTVdevice = searchParams.get('isTVdevice') === 'true'
  const shouldExposeAdditionalData = isTVdevice
  const includeWatchHistory = searchParams.get('includeWatchHistory') === 'true'
  // Playlist params (for type=playlist)
  const playlistIdParam = searchParams.get('playlistId') || null

  let items = []
  let previousItem = null
  let nextItem = null

  // Perform operations based on the type parameter
  const sortList = (a, b) => sortFunctions[sort](a, b, sortOrder)

  try {
    // Function to fetch items for a given page - using cached functions where possible
    const fetchItemsForPage = async (pageNumber, limit) => {
      switch (type) {
        case 'movie': {
          // Use cached function for movie lists (1-minute cache)
          const movieProjection = shouldExposeAdditionalData ? { videoURL: 1, duration: 1 } : {}
          return await getCachedMovieList(pageNumber, limit, movieProjection)
        }
        case 'tv': {
          // Use cached function for TV lists (1-minute cache)
          const tvProjection = shouldExposeAdditionalData ? { videoURL: 1, duration: 1 } : {}
          return await getCachedTVList(pageNumber, limit, tvProjection)
        }
        case 'recentlyWatched':
          // User-specific data - remain uncached for now due to dynamic API restrictions
          return await getFlatRecentlyWatchedForUser({
            userId: authResult?.id,
            page: pageNumber,
            limit: limit,
            shouldExposeAdditionalData,
            contextHints: {
              isTVdevice: shouldExposeAdditionalData,
              horizontalList: true
            }
          })
        case 'recentlyAdded':
          // Use cached function for recently added (1-minute cache)
          return await getCachedRecentlyAdded(pageNumber, limit, shouldExposeAdditionalData)
        case 'recommendations': {
          // User-specific data - remain uncached for now due to dynamic API restrictions
          const recommendations = await getFlatRecommendations(
            authResult?.id,
            pageNumber,
            limit,
            false, // countOnly
            shouldExposeAdditionalData
          )
          return recommendations.items || []
        }
        case 'playlist': {
          if (!playlistIdParam) {
            return []
          }
          
          // User-specific data - remain uncached for now due to dynamic API restrictions
          // Fetch playlist info first to get sorting preferences
          let playlistInfo = null
          try {
            playlistInfo = await getPlaylistById(playlistIdParam)
          } catch (e) {
            console.error('Error fetching playlist info:', e)
          }
          
          // Check user's visibility settings for this playlist to determine if they want to hide unavailable items
          let hideUnavailable = false
          try {
            const visibility = await getPlaylistVisibility(authResult?.id, playlistIdParam)
            hideUnavailable = visibility?.hideUnavailable ?? false
          } catch (e) {
            console.error('Error fetching playlist visibility:', e)
            // Default to showing all content if visibility fetch fails
          }
          
          // Get watchlist items based on user preference
          const watchlistItems = await getUserWatchlist({
            page: pageNumber,
            limit: limit,
            playlistId: playlistIdParam,
            internalOnly: hideUnavailable  // Conditional filtering based on user preference
          })
          
          // Get card media documents
          return await getMinimalCardDataForPlaylist(
            watchlistItems,
            playlistInfo,
            !hideUnavailable  // Include unavailable items unless user wants to hide them
          )
        }
        case 'all':
        default: {
          // Use cached function for combined movie/TV lists (1-minute cache)
          const movieProjection = shouldExposeAdditionalData ? { videoURL: 1, duration: 1 } : {}
          const tvProjection = shouldExposeAdditionalData ? { videoURL: 1, duration: 1 } : {}
          return await getCachedAllMedia(pageNumber, limit, movieProjection, tvProjection)
        }
      }
    }

    // Fetch current items
    items = await fetchItemsForPage(page, itemsPerPage)
    if (items && items.length > 0) {
      // First sort the items
      // For playlist type, the DB already applies playlist-defined order, so skip additional sorting
      const sorted = type === 'playlist' ? items : items.sort(sortList)
      
      // For recently added items, they're already sanitized with proper structure
      // For other item types that might not be fully sanitized, make sure thumbnails and posters are set for TV episodes
      if (type !== 'recentlyAdded') {
        for (const item of sorted) {
          // Only apply episode handling logic for recentlyWatched list type
          if (type === 'recentlyWatched') {
            // Handle TV shows with episodeData (from getFlatTVShowsWithEpisodeData)
            if (item.type === 'tv' && item.episodeData) {
              // Extract season/episode numbers from episodeData to top level for clipVideoURL generation
              if (item.episodeData.seasonNumber && !item.seasonNumber) {
                item.seasonNumber = item.episodeData.seasonNumber;
              }
              if (item.episodeData.episodeNumber && !item.episodeNumber) {
                item.episodeNumber = item.episodeData.episodeNumber;
              }
              
              // Use episode thumbnail as the posterURL for TV episodes
              if (item.episodeData.thumbnail) {
                item.posterURL = item.episodeData.thumbnail;
                item.thumbnail = item.episodeData.thumbnail;
              }
              
              if (item.episodeData.thumbnailBlurhash) {
                item.thumbnailBlurhash = item.episodeData.thumbnailBlurhash;
              }
            }
            // Handle TV shows with episode property (from other sources like recentlyWatched)
            else if (item.type === 'tv' && item.episode) {
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
              
              // For TV devices, ensure videoURL is available at top level for clipVideoURL generation
              if (shouldExposeAdditionalData && item.episode.videoURL && !item.videoURL) {
                item.videoURL = item.episode.videoURL;
                // Also ensure duration is available for clip generation
                if (item.episode.duration && !item.duration) {
                  item.duration = item.episode.duration;
                }
              }
            }
          }
          
          // For movies, ensure videoURL is available when TV device mode is enabled
          if (item.type === 'movie' && shouldExposeAdditionalData && !item.videoURL) {
            // For movies, the videoURL might be in different locations depending on the data source
            if (item.media?.videoURL) {
              item.videoURL = item.media.videoURL;
            } else if (item.url) {
              item.videoURL = item.url;
            }
            // Ensure duration is available for clip generation
            if (!item.duration && item.media?.duration) {
              item.duration = item.media.duration;
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
      // Create context with TV device information
      const context = {
        ...contextByType[type] || {},
        isTVdevice: isTVdevice
      };
      items = sanitizeCardItems(sorted, context, shouldExposeAdditionalData)
      
      // Add watch history if requested
      if (includeWatchHistory && items.length > 0) {
        try {
          if (process.env.DEBUG) {
            console.log(`[WATCH_HISTORY] Adding watch history to ${items.length} items for type: ${type}`)
          }
          items = await addWatchHistoryToItems(items, authResult?.id)
        } catch (error) {
          console.error('Error adding watch history to items:', error)
          // Continue without watch history on error
        }
      }
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
        // Create context with TV device information for previous item
        const prevContext = {
          ...contextByType[type] || {},
          isTVdevice: isTVdevice
        };
        previousItem = await sanitizeCardData(previousItem, shouldExposeAdditionalData, prevContext)
        
        // Add watch history to previous item if requested
        if (includeWatchHistory && previousItem) {
          try {
            const previousItemWithHistory = await addWatchHistoryToItems([previousItem], authResult?.id)
            previousItem = previousItemWithHistory[0]
          } catch (error) {
            console.error('Error adding watch history to previous item:', error)
            // Continue without watch history on error
          }
        }
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
      // Create context with TV device information for next item
      const nextContext = {
        ...contextByType[type] || {},
        isTVdevice: isTVdevice
      };
      nextItem = await sanitizeCardData(nextItem, shouldExposeAdditionalData, nextContext)
      
      // Add watch history to next item if requested
      if (includeWatchHistory && nextItem) {
        try {
          const nextItemWithHistory = await addWatchHistoryToItems([nextItem], authResult?.id)
          nextItem = nextItemWithHistory[0]
        } catch (error) {
          console.error('Error adding watch history to next item:', error)
          // Continue without watch history on error
        }
      }
    }

    // For playlist type, also return the playlist metadata for client labeling if desired
    let playlistMeta = null
    if (type === 'playlist' && playlistIdParam) {
      try {
        const info = await getPlaylistById(playlistIdParam)
        if (info) {
          playlistMeta = {
            id: info.id || playlistIdParam,
            name: info.name,
            description: info.description || null,
            ownerId: info.ownerId || null,
            privacy: info.privacy || null
          }
        }
      } catch (_e) { /* empty */ }
    }

    // Return the items along with previous and next items
    return new Response(
      JSON.stringify({
        currentItems: items,
        previousItem: previousItem || null,
        nextItem: nextItem || null,
        playlist: playlistMeta
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
