// src/app/api/authenticated/horizontal-list/route.js
import { isAuthenticatedAndApproved } from '@src/utils/routeAuth'
import { getFlatRecentlyWatchedForUser } from '@src/utils/flatDatabaseUtils'
import { sanitizeCardData, sanitizeCardItems } from '@src/utils/auth_utils'
import { getFlatRecommendations } from '@src/utils/flatRecommendations'
import { getFullImageUrl } from '@src/utils'
import { addWatchHistoryToItemsBounded } from '@src/utils/watchHistoryUtils'
// Watchlist playlist support
import { getUserWatchlist, getPlaylistById, getMinimalCardDataForPlaylist, getPlaylistVisibility } from '@src/utils/watchlist'
import { getBackendAuthHeaders } from '@src/utils/backendAuth'
// Cached windowed data fetchers for improved performance
import {
  getCachedMovieWindow,
  getCachedTVWindow,
  getCachedRecentlyAddedWindow,
  getCachedAllMediaWindow
} from '@src/utils/cache/horizontalListData'
// ETag support for HTTP caching
import { generateETag, hasMatchingETag, createNotModifiedResponse, createCacheHeaders } from '@src/utils/cache/etagHelpers'

// Sorting functions
const sortFunctions = {
  id: (a, b, order) => (order === 'asc' ? a.id - b.id : b.id - a.id),
  title: (a, b, order) =>
    order === 'asc' ? a.title.localeCompare(b.title) : b.title.localeCompare(a.title),
  date: (a, b, order) =>
    order === 'asc' ? new Date(a.date) - new Date(b.date) : new Date(b.date) - new Date(a.date),
  // Add more sorting functions as needed
}

// Sanitization context per list type (others use the default context)
const contextByType = {
  recentlyWatched: { dateContext: 'watchHistory' },
  recentlyAdded: { dateContext: 'recentlyAdded' },
  recommendations: { dateContext: 'recommendations' },
}

const badRequest = (message) =>
  new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  })

/**
 * Splits a windowed fetch (up to limit + 2 rows starting one row before the
 * page) into the page's items plus the previous/next boundary peek items.
 */
function splitWindow(rows, { limit, wantPrev }) {
  const list = Array.isArray(rows) ? rows : []
  const lead = wantPrev ? 1 : 0
  return {
    previousItem: wantPrev && list.length > 0 ? list[0] : null,
    currentItems: list.slice(lead, lead + limit),
    nextItem: list.length > lead + limit ? list[lead + limit] : null,
  }
}

/**
 * Position-based window split for recentlyWatched: hydration can drop
 * FK-orphaned rows, so each row carries its absolute list position
 * (__listPosition) and is bucketed by it. The page's items stay exactly the
 * rows that belong to the page; missing boundary rows degrade the peeks to
 * null instead of shifting everything by one.
 */
function splitWindowByPosition(rows, { page, limit }) {
  const list = Array.isArray(rows) ? rows : []
  const pageStart = page * limit
  let previousItem = null
  let nextItem = null
  const currentItems = []

  for (const row of list) {
    const position = row?.__listPosition
    if (position === pageStart - 1) {
      previousItem = row
    } else if (position >= pageStart && position < pageStart + limit) {
      currentItems.push(row)
    } else if (position === pageStart + limit) {
      nextItem = row
    }
  }

  currentItems.sort((a, b) => (a.__listPosition ?? 0) - (b.__listPosition ?? 0))
  return { previousItem, currentItems, nextItem }
}

/**
 * Normalizes item fields ahead of sanitization: hoists episode data onto TV
 * items from recentlyWatched, and exposes movie videoURL/duration for TV
 * devices. Applied to the whole window (page items and boundary peeks alike).
 */
function applyItemFieldFixups(item, type, shouldExposeAdditionalData) {
  // Only apply episode handling logic for recentlyWatched list type
  if (type === 'recentlyWatched') {
    // Handle TV shows with episodeData (from getFlatTVShowsWithEpisodeData)
    if (item.type === 'tv' && item.episodeData) {
      // Extract season/episode numbers from episodeData to top level for clipVideoURL generation
      if (item.episodeData.seasonNumber && !item.seasonNumber) {
        item.seasonNumber = item.episodeData.seasonNumber
      }
      if (item.episodeData.episodeNumber && !item.episodeNumber) {
        item.episodeNumber = item.episodeData.episodeNumber
      }

      // Use episode thumbnail as the posterURL for TV episodes
      if (item.episodeData.thumbnail) {
        item.posterURL = item.episodeData.thumbnail
        item.thumbnail = item.episodeData.thumbnail
      }

      if (item.episodeData.thumbnailBlurhash) {
        item.thumbnailBlurhash = item.episodeData.thumbnailBlurhash
      }
    }
    // Handle TV shows with episode property (from other sources like recentlyWatched)
    else if (item.type === 'tv' && item.episode) {
      // Make sure episode has a thumbnail (use metadata still_path or fallback to posterURL)
      if (!item.episode.thumbnail) {
        item.episode.thumbnail =
          (item.episode.metadata?.still_path ?
           getFullImageUrl(item.episode.metadata.still_path) :
           item.posterURL)
      }

      // Use episode thumbnail as the posterURL for TV episodes
      if (item.episode.thumbnail) {
        item.posterURL = item.episode.thumbnail
        item.thumbnail = item.episode.thumbnail
      }

      if (item.episode.thumbnailBlurhash) {
        item.thumbnailBlurhash = item.episode.thumbnailBlurhash
      }

      // Make sure episodeNumber is included at the top level
      if (!item.episodeNumber && item.episode.episodeNumber) {
        item.episodeNumber = item.episode.episodeNumber
      }

      // For TV devices, ensure videoURL is available at top level for clipVideoURL generation
      if (shouldExposeAdditionalData && item.episode.videoURL && !item.videoURL) {
        item.videoURL = item.episode.videoURL
        // Also ensure duration is available for clip generation
        if (item.episode.duration && !item.duration) {
          item.duration = item.episode.duration
        }
      }
    }
  }

  // For movies, ensure videoURL is available when TV device mode is enabled
  if (item.type === 'movie' && shouldExposeAdditionalData && !item.videoURL) {
    // For movies, the videoURL might be in different locations depending on the data source
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

// API Route handler
export const GET = async (req) => {
  // Check authentication and approval (supports both web sessions and sessionId)
  const authResult = await isAuthenticatedAndApproved(req)
  if (authResult instanceof Response) {
    return authResult // Stop execution if not authenticated
  }

  // Parse query parameters for type, sort, and sortOrder
  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type') || 'all'
  const sort = searchParams.get('sort') || 'id'
  const sortOrder = searchParams.get('sortOrder') || 'desc'
  const rawPage = Number.parseInt(searchParams.get('page') ?? '0', 10)
  const rawLimit = Number.parseInt(searchParams.get('limit') ?? '30', 10)
  const isTVdevice = searchParams.get('isTVdevice') === 'true'
  const shouldExposeAdditionalData = isTVdevice
  const includeWatchHistory = searchParams.get('includeWatchHistory') === 'true'
  // Playlist params (for type=playlist)
  const playlistIdParam = searchParams.get('playlistId') || null

  // Validate parameters before touching the database
  if (Number.isNaN(rawPage) || Number.isNaN(rawLimit)) {
    return badRequest('page and limit must be integers')
  }
  if (!Object.hasOwn(sortFunctions, sort)) {
    return badRequest(`invalid sort: must be one of ${Object.keys(sortFunctions).join(', ')}`)
  }
  if (sortOrder !== 'asc' && sortOrder !== 'desc') {
    return badRequest('invalid sortOrder: must be asc or desc')
  }
  if (
    type === 'playlist' &&
    playlistIdParam &&
    playlistIdParam !== 'default' &&
    !/^[0-9a-fA-F]{24}$/.test(playlistIdParam)
  ) {
    return badRequest('invalid playlistId')
  }

  // Clamp instead of rejecting so external clients with unusual values keep working;
  // the limit cap also bounds query size and use-cache key cardinality
  const page = Math.min(Math.max(rawPage, 0), 10000)
  const itemsPerPage = Math.min(Math.max(rawLimit, 1), 100)

  // One windowed fetch covers the page plus its boundary peek items:
  // one extra row before the page (when there is one) and one after
  const wantPrev = page > 0
  const offset = page * itemsPerPage - (wantPrev ? 1 : 0)
  const windowCount = itemsPerPage + 1 + (wantPrev ? 1 : 0)

  const sortList = (a, b) => sortFunctions[sort](a, b, sortOrder)

  try {
    let playlistInfo = null
    let split

    switch (type) {
      case 'movie': {
        const movieProjection = shouldExposeAdditionalData ? { videoURL: 1, duration: 1 } : {}
        const rows = await getCachedMovieWindow(offset, windowCount, movieProjection)
        split = splitWindow(rows, { limit: itemsPerPage, wantPrev })
        break
      }
      case 'tv': {
        const rows = await getCachedTVWindow(offset, windowCount)
        split = splitWindow(rows, { limit: itemsPerPage, wantPrev })
        break
      }
      case 'recentlyWatched': {
        // User-specific data - uncached due to dynamic API restrictions
        const rows = await getFlatRecentlyWatchedForUser({
          userId: authResult?.id,
          offset,
          limit: windowCount,
          shouldExposeAdditionalData,
          contextHints: {
            isTVdevice: shouldExposeAdditionalData,
            horizontalList: true
          }
        })
        split = splitWindowByPosition(rows, { page, limit: itemsPerPage })
        break
      }
      case 'recentlyAdded': {
        const rows = await getCachedRecentlyAddedWindow(offset, windowCount, shouldExposeAdditionalData)
        split = splitWindow(rows, { limit: itemsPerPage, wantPrev })
        break
      }
      case 'recommendations': {
        // User-specific data - uncached due to dynamic API restrictions.
        // The expensive compute-then-slice pipeline now runs once per request.
        const recommendations = await getFlatRecommendations(
          authResult?.id,
          page,
          windowCount,
          false, // countOnly
          shouldExposeAdditionalData,
          offset
        )
        split = splitWindow(recommendations?.items || [], { limit: itemsPerPage, wantPrev })
        break
      }
      case 'playlist': {
        if (!playlistIdParam) {
          split = { previousItem: null, currentItems: [], nextItem: null }
          break
        }

        // Fetched once per request; also feeds the playlist metadata below.
        // The route's authenticated user is threaded through so neither
        // helper re-runs a session lookup.
        const [playlistInfoResult, visibilityResult] = await Promise.allSettled([
          getPlaylistById(playlistIdParam, { user: authResult }),
          getPlaylistVisibility(authResult?.id, playlistIdParam)
        ])

        playlistInfo = playlistInfoResult.status === 'fulfilled' ? playlistInfoResult.value : null
        const hideUnavailable = visibilityResult.status === 'fulfilled'
          ? visibilityResult.value?.hideUnavailable ?? false
          : false

        if (playlistInfoResult.status === 'rejected') {
          console.error('Error fetching playlist info:', playlistInfoResult.reason)
        }
        if (visibilityResult.status === 'rejected') {
          console.error('Error fetching playlist visibility:', visibilityResult.reason)
        }

        // Get watchlist items based on user preference
        const watchlistItems = await getUserWatchlist({
          offset,
          limit: windowCount,
          playlistId: playlistIdParam,
          userId: authResult?.id, // skip the getSession() fallback inside
          internalOnly: hideUnavailable  // Conditional filtering based on user preference
        })

        // Get card media documents. Items arrive pre-resolved from
        // getUserWatchlist, so external items skip a second TMDB round trip;
        // auth headers cover any residual fetch (e.g. an earlier failure).
        const rows = await getMinimalCardDataForPlaylist(
          watchlistItems,
          playlistInfo,
          !hideUnavailable,  // Include unavailable items unless user wants to hide them
          {
            itemsArePreResolved: true,
            authHeaders: await getBackendAuthHeaders(req)
          }
        )
        split = splitWindow(rows, { limit: itemsPerPage, wantPrev })
        break
      }
      case 'all':
      default: {
        const movieProjection = shouldExposeAdditionalData ? { videoURL: 1, duration: 1 } : {}
        const tvProjection = shouldExposeAdditionalData ? { videoURL: 1, duration: 1 } : {}
        const { movies, tv } = await getCachedAllMediaWindow(
          offset,
          windowCount,
          movieProjection,
          tvProjection
        )
        // Preserves the legacy 'all' semantics (a page of movies plus a page of
        // TV concatenated); no in-repo consumer requests this type
        const movieSplit = splitWindow(movies, { limit: itemsPerPage, wantPrev })
        const tvSplit = splitWindow(tv, { limit: itemsPerPage, wantPrev })
        split = {
          previousItem: movieSplit.previousItem ?? tvSplit.previousItem,
          currentItems: [...movieSplit.currentItems, ...tvSplit.currentItems],
          nextItem: movieSplit.nextItem ?? tvSplit.nextItem,
        }
        break
      }
    }

    let { previousItem, currentItems, nextItem } = split

    // Strip the internal split marker before the items go any further
    for (const item of [previousItem, ...currentItems, nextItem]) {
      if (item && typeof item === 'object') {
        delete item.__listPosition
      }
    }

    // Normalize fields across the whole window — peeks included, so boundary
    // cards get the same episode thumbnails/videoURL handling as page items
    if (type !== 'recentlyAdded') {
      for (const item of [previousItem, ...currentItems, nextItem]) {
        if (item) {
          applyItemFieldFixups(item, type, shouldExposeAdditionalData)
        }
      }
    }

    // Sort within the page; playlist order is already applied by the database
    const sorted = type === 'playlist' ? currentItems : currentItems.sort(sortList)

    // Sanitize the whole window with the type-appropriate context
    const context = {
      ...(contextByType[type] || {}),
      isTVdevice: isTVdevice
    }
    let items = sanitizeCardItems(sorted, context, shouldExposeAdditionalData)
    previousItem = previousItem
      ? sanitizeCardData(previousItem, shouldExposeAdditionalData, context)
      : null
    nextItem = nextItem
      ? sanitizeCardData(nextItem, shouldExposeAdditionalData, context)
      : null

    // Single batched watch-history pass over page items and peeks together
    if (includeWatchHistory) {
      try {
        const allItems = [
          ...items,
          ...(previousItem ? [previousItem] : []),
          ...(nextItem ? [nextItem] : [])
        ]

        if (allItems.length > 0) {
          if (process.env.DEBUG) {
            console.log(`[WATCH_HISTORY] Adding watch history to ${allItems.length} items for type: ${type}`)
          }
          const itemsWithHistory = await addWatchHistoryToItemsBounded(allItems, authResult?.id)

          // Redistribute items back
          items = itemsWithHistory.slice(0, items.length)
          if (previousItem) {
            previousItem = itemsWithHistory[items.length]
          }
          if (nextItem) {
            nextItem = itemsWithHistory[items.length + (previousItem ? 1 : 0)]
          }
        }
      } catch (error) {
        console.error('Error adding watch history to items:', error)
        // Continue without watch history on error
      }
    }

    // For playlist type, also return the playlist metadata for client labeling,
    // reusing the playlist info fetched with the items
    let playlistMeta = null
    if (type === 'playlist' && playlistIdParam && playlistInfo) {
      playlistMeta = {
        id: playlistInfo.id || playlistIdParam,
        name: playlistInfo.name,
        description: playlistInfo.description || null,
        ownerId: playlistInfo.ownerId || null,
        privacy: playlistInfo.privacy || null
      }
    }

    // Build response data
    const responseData = {
      currentItems: items,
      previousItem: previousItem || null,
      nextItem: nextItem || null,
      playlist: playlistMeta
    }

    // Generate ETag from actual response content
    const responseString = JSON.stringify(responseData)
    const etag = generateETag(responseString)

    // Check if client has current version
    if (hasMatchingETag(req, etag)) {
      return createNotModifiedResponse(etag)
    }

    // Return the items along with previous and next items
    return new Response(
      responseString,
      {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': '*', // Allows all origins
          'Content-Type': 'application/json',
          ...createCacheHeaders(etag)
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
