import { isAuthenticatedEither } from '@src/utils/routeAuth'
import { checkRateLimit, createRateLimitHeaders, RATE_LIMITS } from '@src/utils/rateLimiter'
import {
  getUserWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  checkWatchlistStatus,
  bulkRemoveFromWatchlist,
  bulkUpdateWatchlist,
  moveItemsToPlaylist,
  toggleWatchlist,
  createPlaylist,
  getUserPlaylists,
  updatePlaylist,
  deletePlaylist,
  sharePlaylist,
  validateWatchlistItem,
  validateWatchlistQuery,
  validatePlaylistData,
  validateCollaborators,
  validateObjectId,
  WatchlistValidationError,
  getValidationErrorResponse,
  formatWatchlistItem,
  formatPlaylist,
  updatePlaylistSorting,
  updatePlaylistCustomOrder,
  WATCHLIST_CONSTANTS
} from '@src/utils/watchlist/'

/**
 * Rate limiting configuration
 * Set to false to disable rate limiting for this endpoint
 */
const ENABLE_RATE_LIMITING = false

/**
 * Debug logging utility
 */
function debugLog(message, data = null) {
  if (process.env.DEBUG === 'true') {
    console.log(`[Watchlist API] ${message}`, data ? JSON.stringify(data, null, 2) : '')
  }
}

/**
 * Create standardized error response
 */
function createErrorResponse(message, status = 400, details = null) {
  const errorData = { error: message }
  if (details) {
    errorData.details = details
  }
  
  debugLog(`Error Response (${status}):`, errorData)
  
  return new Response(
    JSON.stringify(errorData),
    {
      status,
      headers: { 'Content-Type': 'application/json' }
    }
  )
}

/**
 * Create standardized success response
 */
function createSuccessResponse(data, status = 200, rateLimitHeaders = {}) {
  debugLog(`Success Response (${status}):`, data)
  
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        'Content-Type': 'application/json',
        ...rateLimitHeaders
      }
    }
  )
}

/**
 * Apply rate limiting to request
 */
function applyRateLimit(req, operation = 'general') {
  // Check if rate limiting is disabled
  if (!ENABLE_RATE_LIMITING) {
    return { success: true, headers: {} }
  }

  const rateLimitConfig = {
    general: RATE_LIMITS.API_GENERAL,
    add: { maxRequests: 30, windowMs: 60 * 60 * 1000 }, // 30 per hour
    remove: { maxRequests: 50, windowMs: 60 * 60 * 1000 }, // 50 per hour
    list: { maxRequests: 10000, windowMs: 60 * 60 * 1000 }, // 10000 per hour (increased for summary calls)
    status: { maxRequests: 200, windowMs: 60 * 60 * 1000 }, // 200 per hour
    toggle: { maxRequests: 30, windowMs: 60 * 60 * 1000 }, // 30 per hour
    bulkRemove: { maxRequests: 10, windowMs: 60 * 60 * 1000 }, // 10 per hour
    bulkUpdate: { maxRequests: 10, windowMs: 60 * 60 * 1000 }, // 10 per hour
    moveItems: { maxRequests: 20, windowMs: 60 * 60 * 1000 }, // 20 per hour
    createPlaylist: { maxRequests: 10, windowMs: 60 * 60 * 1000 }, // 10 per hour
    updatePlaylist: { maxRequests: 100, windowMs: 60 * 60 * 1000 }, // 100 per hour (increased for sorting)
    deletePlaylist: { maxRequests: 5, windowMs: 60 * 60 * 1000 }, // 5 per hour
    sharePlaylist: { maxRequests: 10, windowMs: 60 * 60 * 1000 }, // 10 per hour
    updateSorting: { maxRequests: 200, windowMs: 60 * 60 * 1000 } // 200 per hour for sorting operations
  }

  const config = rateLimitConfig[operation] || rateLimitConfig.general
  const rateLimitResult = checkRateLimit(req, config, `watchlist_${operation}`)
  
  if (rateLimitResult.isLimited) {
    const headers = createRateLimitHeaders(rateLimitResult)
    return new Response(
      JSON.stringify({
        error: 'Rate limit exceeded',
        message: `Too many ${operation} requests. Please try again later.`,
        retryAfter: rateLimitResult.retryAfter
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          ...headers
        }
      }
    )
  }

  return { success: true, headers: createRateLimitHeaders(rateLimitResult) }
}

/**
 * POST - Handle add, toggle, create playlist, and bulk operations
 */
export async function POST(req) {
  debugLog('POST /watchlist - Request received')
  
  // Check authentication
  const authResult = await isAuthenticatedEither(req)
  if (authResult instanceof Response) {
    return authResult
  }

  // Parse URL to determine the specific operation
  const url = new URL(req.url)
  const action = url.searchParams.get('action') || 'add'
  
  debugLog(`POST operation: ${action}`)

  try {
    // Parse request body
    const body = await req.json()
    debugLog('Request body:', body)

    switch (action) {
      case 'add':
        return await handleAddToWatchlist(req, body, authResult)
      case 'toggle':
        return await handleToggleWatchlist(req, body, authResult)
      case 'create-playlist':
        return await handleCreatePlaylist(req, body, authResult)
      case 'share-playlist':
        return await handleSharePlaylist(req, body, authResult)
      case 'bulk-update':
        return await handleBulkUpdateWatchlist(req, body, authResult)
      case 'move-items':
        return await handleMoveItemsToPlaylist(req, body, authResult)
      default:
        return createErrorResponse(`Invalid action: ${action}`, 400)
    }
  } catch (error) {
    debugLog('POST error:', error)
    if (error instanceof SyntaxError) {
      return createErrorResponse('Invalid JSON in request body', 400)
    }
    return createErrorResponse('Internal server error', 500, error.message)
  }
}

/**
 * GET - Handle list, status, and playlist operations
 */
export async function GET(req) {
  debugLog('GET /watchlist - Request received')
  
  // Check authentication
  const authResult = await isAuthenticatedEither(req)
  if (authResult instanceof Response) {
    return authResult
  }

  // Parse URL parameters
  const url = new URL(req.url)
  const action = url.searchParams.get('action') || 'list'
  
  debugLog(`GET operation: ${action}`)

  try {
    switch (action) {
      case 'list':
        return await handleGetWatchlist(req, authResult)
      case 'status':
        return await handleCheckWatchlistStatus(req, authResult)
      case 'playlists':
        return await handleGetPlaylists(req, authResult)
      case 'playlist-items':
        return await handleGetPlaylistItems(req, authResult)
      default:
        return createErrorResponse(`Invalid action: ${action}`, 400)
    }
  } catch (error) {
    debugLog('GET error:', error)
    return createErrorResponse('Internal server error', 500, error.message)
  }
}

/**
 * PUT - Handle update operations
 */
export async function PUT(req) {
  debugLog('PUT /watchlist - Request received')
  
  // Check authentication
  const authResult = await isAuthenticatedEither(req)
  if (authResult instanceof Response) {
    return authResult
  }

  // Parse URL to determine the specific operation
  const url = new URL(req.url)
  const action = url.searchParams.get('action') || 'update-playlist'
  
  debugLog(`PUT operation: ${action}`)

  try {
    const body = await req.json()
    debugLog('Request body:', body)

    switch (action) {
      case 'update-playlist':
        return await handleUpdatePlaylist(req, body, authResult)
      case 'update-playlist-sorting':
        return await handleUpdatePlaylistSorting(req, body, authResult)
      case 'update-playlist-order':
        return await handleUpdatePlaylistOrder(req, body, authResult)
      default:
        return createErrorResponse(`Invalid action: ${action}`, 400)
    }
  } catch (error) {
    debugLog('PUT error:', error)
    if (error instanceof SyntaxError) {
      return createErrorResponse('Invalid JSON in request body', 400)
    }
    return createErrorResponse('Internal server error', 500, error.message)
  }
}

/**
 * DELETE - Handle remove and delete operations
 */
export async function DELETE(req) {
  debugLog('DELETE /watchlist - Request received')
  
  // Check authentication
  const authResult = await isAuthenticatedEither(req)
  if (authResult instanceof Response) {
    return authResult
  }

  // Parse URL to determine the specific operation
  const url = new URL(req.url)
  const action = url.searchParams.get('action') || 'remove'
  
  debugLog(`DELETE operation: ${action}`)

  try {
    switch (action) {
      case 'remove':
        return await handleRemoveFromWatchlist(req, authResult)
      case 'bulk-remove':
        const body = await req.json()
        return await handleBulkRemoveFromWatchlist(req, body, authResult)
      case 'delete-playlist':
        return await handleDeletePlaylist(req, authResult)
      default:
        return createErrorResponse(`Invalid action: ${action}`, 400)
    }
  } catch (error) {
    debugLog('DELETE error:', error)
    if (error instanceof SyntaxError) {
      return createErrorResponse('Invalid JSON in request body', 400)
    }
    return createErrorResponse('Internal server error', 500, error.message)
  }
}

// ===== WATCHLIST HANDLERS =====

/**
 * Handle adding item to watchlist
 */
async function handleAddToWatchlist(req, body, user) {
  debugLog('Handling add to watchlist')
  
  // Apply rate limiting
  const rateLimitResult = applyRateLimit(req, 'add')
  if (rateLimitResult instanceof Response) {
    return rateLimitResult
  }

  try {
    // Validate the item data
    const validatedItem = validateWatchlistItem(body)
    debugLog('Validated item:', validatedItem)

    // Extract playlistId from the request body if present
    const playlistId = body.playlistId || null
    debugLog('Adding to playlist:', playlistId)

    // Add to watchlist with playlist context
    const addedItem = await addToWatchlist({
      ...validatedItem,
      playlistId
    })
    
    return createSuccessResponse({
      success: true,
      message: 'Item added to watchlist successfully',
      item: formatWatchlistItem(addedItem)
    }, 201, rateLimitResult.headers)

  } catch (error) {
    debugLog('Add to watchlist error:', error)
    
    if (error instanceof WatchlistValidationError) {
      const validationError = getValidationErrorResponse(error)
      return createErrorResponse(validationError.message, validationError.status)
    }
    
    if (error.message.includes('already exists')) {
      return createErrorResponse('Item already exists in this playlist', 409)
    }
    
    return createErrorResponse('Failed to add item to watchlist', 500, error.message)
  }
}

/**
 * Handle toggling watchlist status
 */
async function handleToggleWatchlist(req, body, user) {
  debugLog('Handling toggle watchlist')
  
  // Apply rate limiting
  const rateLimitResult = applyRateLimit(req, 'toggle')
  if (rateLimitResult instanceof Response) {
    return rateLimitResult
  }

  try {
    // Validate the item data
    const validatedItem = validateWatchlistItem(body)
    debugLog('Validated item for toggle:', validatedItem)

    // Extract playlistId from the request body if present
    const playlistId = body.playlistId || null
    debugLog('Toggling in playlist:', playlistId)

    // Toggle watchlist status with playlist context
    const result = await toggleWatchlist({
      ...validatedItem,
      playlistId
    })
    
    if (!result.success) {
      return createErrorResponse('Failed to toggle watchlist status', 500, result.error)
    }

    return createSuccessResponse({
      success: true,
      action: result.action,
      message: result.action === 'added'
        ? 'Item added to watchlist successfully'
        : 'Item removed from watchlist successfully',
      item: result.item ? formatWatchlistItem(result.item) : null
    }, 200, rateLimitResult.headers)

  } catch (error) {
    debugLog('Toggle watchlist error:', error)
    
    if (error instanceof WatchlistValidationError) {
      const validationError = getValidationErrorResponse(error)
      return createErrorResponse(validationError.message, validationError.status)
    }
    
    return createErrorResponse('Failed to toggle watchlist status', 500, error.message)
  }
}

/**
 * Handle getting user's watchlist
 */
async function handleGetWatchlist(req, user) {
  debugLog('Handling get watchlist')
  
  // Apply rate limiting
  const rateLimitResult = applyRateLimit(req, 'list')
  if (rateLimitResult instanceof Response) {
    return rateLimitResult
  }

  try {
    // Parse query parameters
    const url = new URL(req.url)
    const page = parseInt(url.searchParams.get('page') || '0')
    const limit = Math.min(
      parseInt(url.searchParams.get('limit') || WATCHLIST_CONSTANTS.DEFAULT_PAGE_SIZE.toString()),
      WATCHLIST_CONSTANTS.MAX_PAGE_SIZE
    )
    const mediaType = url.searchParams.get('mediaType')
    const playlistId = url.searchParams.get('playlistId')
    const countOnly = url.searchParams.get('countOnly') === 'true'

    debugLog('Watchlist query params:', { page, limit, mediaType, playlistId, countOnly })

    // Validate query parameters
    const queryParams = { page, limit, mediaType, playlistId, countOnly }
    validateWatchlistQuery(queryParams)

    // Get watchlist
    const watchlistData = await getUserWatchlist(queryParams)
    
    if (countOnly) {
      return createSuccessResponse({
        success: true,
        count: watchlistData
      }, 200, rateLimitResult.headers)
    }

    // Format items for response
    const formattedItems = Array.isArray(watchlistData) 
      ? watchlistData.map(formatWatchlistItem)
      : []

    return createSuccessResponse({
      success: true,
      items: formattedItems,
      pagination: {
        page,
        limit,
        hasMore: formattedItems.length === limit
      }
    }, 200, rateLimitResult.headers)

  } catch (error) {
    debugLog('Get watchlist error:', error)
    
    if (error instanceof WatchlistValidationError) {
      const validationError = getValidationErrorResponse(error)
      return createErrorResponse(validationError.message, validationError.status)
    }
    
    return createErrorResponse('Failed to get watchlist', 500, error.message)
  }
}

/**
 * Handle checking watchlist status
 */
async function handleCheckWatchlistStatus(req, user) {
  debugLog('Handling check watchlist status')
  
  // Apply rate limiting
  const rateLimitResult = applyRateLimit(req, 'status')
  if (rateLimitResult instanceof Response) {
    return rateLimitResult
  }

  try {
    // Parse query parameters
    const url = new URL(req.url)
    const mediaId = url.searchParams.get('mediaId')
    const tmdbId = url.searchParams.get('tmdbId')
    const playlistId = url.searchParams.get('playlistId')

    debugLog('Status check params:', { mediaId, tmdbId, playlistId })

    // Validate that at least one ID is provided
    if (!mediaId && !tmdbId) {
      return createErrorResponse('Either mediaId or tmdbId must be provided', 400)
    }

    // Check watchlist status with playlist awareness
    const item = await checkWatchlistStatus(
      mediaId,
      tmdbId ? parseInt(tmdbId) : undefined,
      playlistId === 'default' ? null : playlistId
    )
    
    return createSuccessResponse({
      success: true,
      inWatchlist: !!item,
      item: item ? formatWatchlistItem(item) : null
    }, 200, rateLimitResult.headers)

  } catch (error) {
    debugLog('Check watchlist status error:', error)
    return createErrorResponse('Failed to check watchlist status', 500, error.message)
  }
}

/**
 * Handle removing item from watchlist
 */
async function handleRemoveFromWatchlist(req, user) {
  debugLog('Handling remove from watchlist')
  
  // Apply rate limiting
  const rateLimitResult = applyRateLimit(req, 'remove')
  if (rateLimitResult instanceof Response) {
    return rateLimitResult
  }

  try {
    // Parse query parameters
    const url = new URL(req.url)
    const itemId = url.searchParams.get('id')
    const mediaId = url.searchParams.get('mediaId')
    const tmdbId = url.searchParams.get('tmdbId')

    debugLog('Remove params:', { itemId, mediaId, tmdbId })

    let success = false

    if (itemId) {
      // Remove by watchlist item ID
      if (!validateObjectId(itemId)) {
        return createErrorResponse('Invalid item ID format', 400)
      }
      success = await removeFromWatchlist(itemId)
    } else if (mediaId || tmdbId) {
      // Find item by media/TMDB ID and remove
      const item = await checkWatchlistStatus(mediaId, tmdbId ? parseInt(tmdbId) : undefined)
      if (item) {
        success = await removeFromWatchlist(item.id)
      } else {
        return createErrorResponse('Item not found in watchlist', 404)
      }
    } else {
      return createErrorResponse('Either id, mediaId, or tmdbId must be provided', 400)
    }

    if (success) {
      return createSuccessResponse({
        success: true,
        message: 'Item removed from watchlist successfully'
      }, 200, rateLimitResult.headers)
    } else {
      return createErrorResponse('Failed to remove item from watchlist', 500)
    }

  } catch (error) {
    debugLog('Remove from watchlist error:', error)
    return createErrorResponse('Failed to remove item from watchlist', 500, error.message)
  }
}

/**
 * Handle bulk removing items from watchlist
 */
async function handleBulkRemoveFromWatchlist(req, body, user) {
  debugLog('Handling bulk remove from watchlist')
  
  // Apply rate limiting
  const rateLimitResult = applyRateLimit(req, 'bulkRemove')
  if (rateLimitResult instanceof Response) {
    return rateLimitResult
  }

  try {
    // Validate request body
    if (!body || !Array.isArray(body.ids)) {
      return createErrorResponse('Request body must contain an array of IDs', 400)
    }

    const { ids } = body
    debugLog('Bulk remove IDs:', ids)

    // Validate IDs
    if (ids.length === 0) {
      return createErrorResponse('At least one ID must be provided', 400)
    }

    if (ids.length > 50) {
      return createErrorResponse('Maximum 50 items can be removed at once', 400)
    }

    // Validate each ID format
    for (const id of ids) {
      if (!validateObjectId(id)) {
        return createErrorResponse(`Invalid ID format: ${id}`, 400)
      }
    }

    // Perform bulk removal
    const deletedCount = await bulkRemoveFromWatchlist(ids)
    
    return createSuccessResponse({
      success: true,
      message: `Successfully removed ${deletedCount} items from watchlist`,
      deletedCount
    }, 200, rateLimitResult.headers)

  } catch (error) {
    debugLog('Bulk remove from watchlist error:', error)
    return createErrorResponse('Failed to bulk remove items from watchlist', 500, error.message)
  }
}

// ===== PLAYLIST HANDLERS =====

/**
 * Handle creating a new playlist
 */
async function handleCreatePlaylist(req, body, user) {
  debugLog('Handling create playlist')
  
  // Apply rate limiting
  const rateLimitResult = applyRateLimit(req, 'createPlaylist')
  if (rateLimitResult instanceof Response) {
    return rateLimitResult
  }

  try {
    // Validate playlist data
    const validatedPlaylist = validatePlaylistData(body)
    debugLog('Validated playlist:', validatedPlaylist)

    // Create playlist
    const createdPlaylist = await createPlaylist(validatedPlaylist)
    
    return createSuccessResponse({
      success: true,
      message: 'Playlist created successfully',
      playlist: formatPlaylist(createdPlaylist)
    }, 201, rateLimitResult.headers)

  } catch (error) {
    debugLog('Create playlist error:', error)
    
    if (error instanceof WatchlistValidationError) {
      const validationError = getValidationErrorResponse(error)
      return createErrorResponse(validationError.message, validationError.status)
    }
    
    return createErrorResponse('Failed to create playlist', 500, error.message)
  }
}

/**
 * Handle getting user's playlists
 */
async function handleGetPlaylists(req, user) {
  debugLog('Handling get playlists')
  
  // Apply rate limiting
  const rateLimitResult = applyRateLimit(req, 'list')
  if (rateLimitResult instanceof Response) {
    return rateLimitResult
  }

  try {
    // Parse query parameters
    const url = new URL(req.url)
    const includeShared = url.searchParams.get('includeShared') !== 'false'

    // Get playlists
    const playlists = await getUserPlaylists({ includeShared })
    
    return createSuccessResponse({
      success: true,
      playlists: playlists.map(formatPlaylist)
    }, 200, rateLimitResult.headers)

  } catch (error) {
    debugLog('Get playlists error:', error)
    return createErrorResponse('Failed to get playlists', 500, error.message)
  }
}

/**
 * Handle getting playlist items
 */
async function handleGetPlaylistItems(req, user) {
  debugLog('Handling get playlist items')
  
  // Apply rate limiting
  const rateLimitResult = applyRateLimit(req, 'list')
  if (rateLimitResult instanceof Response) {
    return rateLimitResult
  }

  try {
    // Parse query parameters
    const url = new URL(req.url)
    const playlistId = url.searchParams.get('playlistId')
    const page = parseInt(url.searchParams.get('page') || '0')
    const limit = Math.min(
      parseInt(url.searchParams.get('limit') || WATCHLIST_CONSTANTS.DEFAULT_PAGE_SIZE.toString()),
      WATCHLIST_CONSTANTS.MAX_PAGE_SIZE
    )
    const sortBy = url.searchParams.get('sortBy')
    const sortOrder = url.searchParams.get('sortOrder')

    if (!playlistId) {
      return createErrorResponse('playlistId is required', 400)
    }

    // Get playlist items with sort parameters
    const items = await getUserWatchlist({
      page,
      limit,
      playlistId,
      sortBy,
      sortOrder
    })

    // Get playlist metadata - all playlists are now database records
    const playlists = await getUserPlaylists()
    
    let playlistInfo
    if (playlistId === 'default') {
      // For 'default' playlistId, find the playlist with isDefault: true
      playlistInfo = playlists.find(p => p.isDefault === true)
      
      // If no default playlist found, create one
      if (!playlistInfo) {
        const { ensureDefaultPlaylist } = await import('@src/utils/watchlist/')
        playlistInfo = await ensureDefaultPlaylist(user.id)
      }
    } else {
      // For specific playlist IDs, find by ID
      playlistInfo = playlists.find(p => p.id === playlistId)
    }
    
    const formattedPlaylist = formatPlaylist(playlistInfo)
    
    return createSuccessResponse({
      success: true,
      items: items.map(formatWatchlistItem),
      playlist: formattedPlaylist,
      pagination: {
        page,
        limit,
        hasMore: items.length === limit
      }
    }, 200, rateLimitResult.headers)

  } catch (error) {
    debugLog('Get playlist items error:', error)
    return createErrorResponse('Failed to get playlist items', 500, error.message)
  }
}

/**
 * Handle updating a playlist
 */
async function handleUpdatePlaylist(req, body, user) {
  debugLog('Handling update playlist')
  
  // Apply rate limiting
  const rateLimitResult = applyRateLimit(req, 'updatePlaylist')
  if (rateLimitResult instanceof Response) {
    return rateLimitResult
  }

  try {
    const url = new URL(req.url)
    const playlistId = url.searchParams.get('playlistId')

    if (!playlistId) {
      return createErrorResponse('playlistId is required', 400)
    }

    // Validate playlist ID
    validateObjectId(playlistId, 'playlistId')

    // Validate updates (partial playlist data)
    const allowedUpdates = ['name', 'description', 'privacy']
    const updates = {}
    
    for (const [key, value] of Object.entries(body)) {
      if (allowedUpdates.includes(key)) {
        updates[key] = value
      }
    }

    if (Object.keys(updates).length === 0) {
      return createErrorResponse('No valid updates provided', 400)
    }

    // Update playlist
    const success = await updatePlaylist(playlistId, updates)
    
    if (success) {
      return createSuccessResponse({
        success: true,
        message: 'Playlist updated successfully'
      }, 200, rateLimitResult.headers)
    } else {
      return createErrorResponse('Failed to update playlist or playlist not found', 404)
    }

  } catch (error) {
    debugLog('Update playlist error:', error)
    
    if (error instanceof WatchlistValidationError) {
      const validationError = getValidationErrorResponse(error)
      return createErrorResponse(validationError.message, validationError.status)
    }
    
    return createErrorResponse('Failed to update playlist', 500, error.message)
  }
}

/**
 * Handle deleting a playlist
 */
async function handleDeletePlaylist(req, user) {
  debugLog('Handling delete playlist')
  
  // Apply rate limiting
  const rateLimitResult = applyRateLimit(req, 'deletePlaylist')
  if (rateLimitResult instanceof Response) {
    return rateLimitResult
  }

  try {
    const url = new URL(req.url)
    const playlistId = url.searchParams.get('playlistId')

    if (!playlistId) {
      return createErrorResponse('playlistId is required', 400)
    }

    // Validate playlist ID
    validateObjectId(playlistId, 'playlistId')

    // Delete playlist
    const success = await deletePlaylist(playlistId)
    
    if (success) {
      return createSuccessResponse({
        success: true,
        message: 'Playlist deleted successfully'
      }, 200, rateLimitResult.headers)
    } else {
      return createErrorResponse('Failed to delete playlist or playlist not found', 404)
    }

  } catch (error) {
    debugLog('Delete playlist error:', error)
    
    if (error instanceof WatchlistValidationError) {
      const validationError = getValidationErrorResponse(error)
      return createErrorResponse(validationError.message, validationError.status)
    }
    
    return createErrorResponse('Failed to delete playlist', 500, error.message)
  }
}

/**
 * Handle sharing a playlist
 */
async function handleSharePlaylist(req, body, user) {
  debugLog('Handling share playlist')
  
  // Apply rate limiting
  const rateLimitResult = applyRateLimit(req, 'sharePlaylist')
  if (rateLimitResult instanceof Response) {
    return rateLimitResult
  }

  try {
    const { playlistId, collaborators } = body

    if (!playlistId) {
      return createErrorResponse('playlistId is required', 400)
    }

    if (!collaborators) {
      return createErrorResponse('collaborators array is required', 400)
    }

    // Validate playlist ID
    validateObjectId(playlistId, 'playlistId')

    // Validate collaborators
    const validatedCollaborators = validateCollaborators(collaborators)

    // Share playlist
    const success = await sharePlaylist(playlistId, validatedCollaborators)
    
    if (success) {
      return createSuccessResponse({
        success: true,
        message: 'Playlist shared successfully'
      }, 200, rateLimitResult.headers)
    } else {
      return createErrorResponse('Failed to share playlist or playlist not found', 404)
    }

  } catch (error) {
    debugLog('Share playlist error:', error)
    
    if (error instanceof WatchlistValidationError) {
      const validationError = getValidationErrorResponse(error)
      return createErrorResponse(validationError.message, validationError.status)
    }
    
    return createErrorResponse('Failed to share playlist', 500, error.message)
  }
}

/**
 * Handle bulk updating watchlist items
 */
async function handleBulkUpdateWatchlist(req, body, user) {
  debugLog('Handling bulk update watchlist')
  
  // Apply rate limiting
  const rateLimitResult = applyRateLimit(req, 'bulkUpdate')
  if (rateLimitResult instanceof Response) {
    return rateLimitResult
  }

  try {
    // Validate request body
    if (!body || !Array.isArray(body.updates)) {
      return createErrorResponse('Request body must contain an updates array', 400)
    }

    const { updates } = body
    debugLog('Bulk update data:', updates)

    // Validate updates
    if (updates.length === 0) {
      return createErrorResponse('At least one update must be provided', 400)
    }

    if (updates.length > 50) {
      return createErrorResponse('Maximum 50 items can be updated at once', 400)
    }

    // Validate each update
    for (const update of updates) {
      if (!update.id || !update.updates) {
        return createErrorResponse('Each update must have id and updates fields', 400)
      }
      validateObjectId(update.id)
    }

    // Perform bulk update
    const result = await bulkUpdateWatchlist(updates)
    
    return createSuccessResponse({
      success: true,
      message: `Successfully updated ${result.modifiedCount} items`,
      modifiedCount: result.modifiedCount,
      matchedCount: result.matchedCount
    }, 200, rateLimitResult.headers)

  } catch (error) {
    debugLog('Bulk update watchlist error:', error)
    
    if (error instanceof WatchlistValidationError) {
      const validationError = getValidationErrorResponse(error)
      return createErrorResponse(validationError.message, validationError.status)
    }
    
    return createErrorResponse('Failed to bulk update watchlist', 500, error.message)
  }
}

/**
 * Handle moving items between playlists
 */
async function handleMoveItemsToPlaylist(req, body, user) {
  debugLog('Handling move items to playlist')
  
  // Apply rate limiting
  const rateLimitResult = applyRateLimit(req, 'moveItems')
  if (rateLimitResult instanceof Response) {
    return rateLimitResult
  }

  try {
    // Validate request body
    if (!body || !Array.isArray(body.itemIds)) {
      return createErrorResponse('Request body must contain an itemIds array', 400)
    }

    const { itemIds, targetPlaylistId } = body
    debugLog('Move items data:', { itemIds, targetPlaylistId })

    // Validate item IDs
    if (itemIds.length === 0) {
      return createErrorResponse('At least one item ID must be provided', 400)
    }

    if (itemIds.length > 50) {
      return createErrorResponse('Maximum 50 items can be moved at once', 400)
    }

    // Validate each item ID format
    for (const id of itemIds) {
      if (!validateObjectId(id)) {
        return createErrorResponse(`Invalid item ID format: ${id}`, 400)
      }
    }

    // Validate target playlist ID (can be null for default playlist)
    if (targetPlaylistId && !validateObjectId(targetPlaylistId)) {
      return createErrorResponse('Invalid target playlist ID format', 400)
    }

    // Perform move operation
    const movedCount = await moveItemsToPlaylist(itemIds, targetPlaylistId)
    
    return createSuccessResponse({
      success: true,
      message: `Successfully moved ${movedCount} items to playlist`,
      movedCount
    }, 200, rateLimitResult.headers)

  } catch (error) {
    debugLog('Move items to playlist error:', error)
    
    if (error instanceof WatchlistValidationError) {
      const validationError = getValidationErrorResponse(error)
      return createErrorResponse(validationError.message, validationError.status)
    }
    
    return createErrorResponse('Failed to move items to playlist', 500, error.message)
  }
}

/**
 * Handle updating playlist sorting preferences
 */
async function handleUpdatePlaylistSorting(req, body, user) {
  debugLog('Handling update playlist sorting')
  
  // Apply rate limiting with specific sorting rate limit
  const rateLimitResult = applyRateLimit(req, 'updateSorting')
  if (rateLimitResult instanceof Response) {
    return rateLimitResult
  }

  try {
    const { playlistId, sortBy, sortOrder } = body

    if (!playlistId) {
      return createErrorResponse('playlistId is required', 400)
    }

    if (!sortBy || !sortOrder) {
      return createErrorResponse('sortBy and sortOrder are required', 400)
    }

    // Validate playlist ID
    validateObjectId(playlistId, 'playlistId')

    // Validate sort parameters
    const validSortFields = ['dateAdded', 'title', 'releaseDate', 'custom']
    const validSortOrders = ['asc', 'desc']

    if (!validSortFields.includes(sortBy)) {
      return createErrorResponse('Invalid sortBy field', 400)
    }

    if (!validSortOrders.includes(sortOrder)) {
      return createErrorResponse('Invalid sortOrder', 400)
    }

    // Update playlist sorting
    const success = await updatePlaylistSorting(playlistId, sortBy, sortOrder)
    
    if (success) {
      return createSuccessResponse({
        success: true,
        message: 'Playlist sorting updated successfully'
      }, 200, rateLimitResult.headers)
    } else {
      return createErrorResponse('Failed to update playlist sorting or playlist not found', 404)
    }

  } catch (error) {
    debugLog('Update playlist sorting error:', error)
    
    if (error instanceof WatchlistValidationError) {
      const validationError = getValidationErrorResponse(error)
      return createErrorResponse(validationError.message, validationError.status)
    }
    
    return createErrorResponse('Failed to update playlist sorting', 500, error.message)
  }
}

/**
 * Handle updating playlist custom order
 */
async function handleUpdatePlaylistOrder(req, body, user) {
  debugLog('Handling update playlist order')
  
  // Apply rate limiting with specific sorting rate limit
  const rateLimitResult = applyRateLimit(req, 'updateSorting')
  if (rateLimitResult instanceof Response) {
    return rateLimitResult
  }

  try {
    const { playlistId, itemIds } = body

    if (!playlistId) {
      return createErrorResponse('playlistId is required', 400)
    }

    if (!Array.isArray(itemIds)) {
      return createErrorResponse('itemIds must be an array', 400)
    }

    // Validate playlist ID
    validateObjectId(playlistId, 'playlistId')

    // Validate each item ID
    for (const itemId of itemIds) {
      if (!validateObjectId(itemId)) {
        return createErrorResponse(`Invalid item ID format: ${itemId}`, 400)
      }
    }

    // Update playlist custom order
    const success = await updatePlaylistCustomOrder(playlistId, itemIds)
    
    if (success) {
      return createSuccessResponse({
        success: true,
        message: 'Playlist order updated successfully'
      }, 200, rateLimitResult.headers)
    } else {
      return createErrorResponse('Failed to update playlist order or playlist not found', 404)
    }

  } catch (error) {
    debugLog('Update playlist order error:', error)
    
    if (error instanceof WatchlistValidationError) {
      const validationError = getValidationErrorResponse(error)
      return createErrorResponse(validationError.message, validationError.status)
    }
    
    return createErrorResponse('Failed to update playlist order', 500, error.message)
  }
}