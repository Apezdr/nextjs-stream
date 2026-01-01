/**
 * Main exports for watchlist functionality with playlist support
 * Provides a clean interface for watchlist and playlist operations
 */

 // Database operations
 export {
   getUserWatchlist,
   addToWatchlist,
   removeFromWatchlist,
   checkWatchlistStatus,
   getWatchlistStats,
   bulkRemoveFromWatchlist,
   bulkUpdateWatchlist,
   moveItemsToPlaylist,
   createPlaylist,
   getUserPlaylists,
   getPlaylistById,
   updatePlaylist,
   deletePlaylist,
   sharePlaylist,
   updatePlaylistSorting,
   updatePlaylistCustomOrder,
   ensureDefaultPlaylist,
   findTMDBIdByMediaId,
   getFullMediaDocumentsForPlaylist,
   getMinimalCardDataForPlaylist,
   // Per-user playlist visibility (Show in App)
   getPlaylistVisibility,
   setPlaylistVisibility,
   listVisiblePlaylists,
   bulkSetPlaylistVisibility,
   resetVisibilityForPlaylist,
   findUsersForAdmin,
   // Coming Soon management (global server-level)
   getComingSoonStatus,
   setComingSoonStatus,
   removeComingSoonStatus,
   bulkGetComingSoonStatus,
   listAllComingSoon,
   cleanExpiredComingSoon
 } from './database.js'

// Validation functions
export {
  validateWatchlistItem,
  validateWatchlistQuery,
  validatePlaylistData,
  validatePlaylistVisibilityPayload,
  validateComingSoonPayload,
  validateCollaborators,
  validateObjectId,
  WatchlistValidationError,
  getValidationErrorResponse,
  VALID_MEDIA_TYPES,
  VALID_PRIVACY_SETTINGS,
  VALID_PERMISSIONS
} from './validation.js'

// Media resolver for batch processing and caching
export {
  batchResolveMedia,
  getMediaByTMDBId,
  scheduleBackgroundUpdate,
  clearMediaCache
} from './mediaResolver.js'

import { 
  addToWatchlist, 
  checkWatchlistStatus, 
  getUserWatchlist, 
  getWatchlistStats, 
  removeFromWatchlist,
  getUserPlaylists,
  createPlaylist
} from './database.js'
// Import VALID_MEDIA_TYPES for use in constants
import { VALID_MEDIA_TYPES, validateWatchlistItem } from './validation.js'

/**
 * Utility functions for watchlist operations
 */

/**
 * Toggle item in watchlist (add if not present, remove if present)
 * @param {Object} item - Item data
 * @param {string} [item.mediaId] - Internal media ID
 * @param {number} [item.tmdbId] - TMDB ID
 * @param {string} item.mediaType - Media type
 * @param {string} item.title - Media title
 * @param {boolean} [item.isExternal] - Whether external media
 * @param {Object} [item.tmdbData] - TMDB metadata
 * @param {string} [item.playlistId] - Target playlist ID
 * @returns {Promise<Object>} Result with action taken and item data
 */
export async function toggleWatchlist(item) {
  try {
    // Check if item already exists in the specific playlist
    const existingItem = await checkWatchlistStatus(item.mediaId, item.tmdbId, item.playlistId)
    
    if (existingItem) {
      // Remove from watchlist
      const removed = await removeFromWatchlist(existingItem.id)
      return {
        action: 'removed',
        success: removed,
        item: existingItem
      }
    } else {
      // Add to watchlist
      const addedItem = await addToWatchlist(item)
      return {
        action: 'added',
        success: true,
        item: addedItem
      }
    }
  } catch (error) {
    return {
      action: 'error',
      success: false,
      error: error.message
    }
  }
}

/**
 * Check if user is authenticated and return user ID
 * @returns {Promise<string|null>} User ID or null if not authenticated
 */
export async function getCurrentUserId() {
  try {
    const { auth } = await import('@src/lib/auth')
    const session = await auth()
    return session?.user?.id || null
  } catch (error) {
    console.error('Error getting current user:', error)
    return null
  }
}

/**
 * Format watchlist item for display
 * @param {Object} item - Watchlist item
 * @returns {Object} Formatted item
 */
export function formatWatchlistItem(item) {
  return {
    id: item.id,
    mediaId: item.mediaId,
    tmdbId: item.tmdbId,
    title: item.title,
    mediaType: item.mediaType,
    isExternal: item.isExternal,
    dateAdded: item.dateAdded,
    posterURL: item.posterURL || '/sorry-image-not-available.jpg',
    backdropURL: item.backdropURL,
    posterPath: item.posterPath,
    backdropPath: item.backdropPath,
    url: item.url,
    link: item.link,
    overview: item.overview,
    releaseDate: item.releaseDate,
    genres: item.genres || [],
    voteAverage: item.voteAverage,
    voteCount: item.voteCount,
    originalLanguage: item.originalLanguage,
    playlistId: item.playlistId
  }
}

/**
 * Format playlist for display
 * @param {Object} playlist - Playlist data
 * @returns {Object} Formatted playlist
 */
export function formatPlaylist(playlist) {
  return {
    id: playlist.id,
    name: playlist.name,
    description: playlist.description,
    privacy: playlist.privacy,
    ownerId: playlist.ownerId,
    ownerName: playlist.ownerName,
    isOwner: playlist.isOwner,
    isCollaborator: playlist.isCollaborator,
    isPublic: playlist.isPublic,
    isDefault: playlist.isDefault || false,
    canEdit: playlist.canEdit,
    itemCount: playlist.itemCount,
    dateCreated: playlist.dateCreated,
    dateUpdated: playlist.dateUpdated,
    sortBy: playlist.sortBy,
    sortOrder: playlist.sortOrder,
    customOrder: playlist.customOrder,
    collaborators: playlist.collaborators || []
  }
}

/**
 * Get watchlist item count for a user
 * @param {string} [playlistId] - Optional playlist filter
 * @returns {Promise<number>} Total count of watchlist items
 */
export async function getWatchlistCount(playlistId = null) {
  try {
    return await getUserWatchlist({ countOnly: true, playlistId })
  } catch (error) {
    console.error('Error getting watchlist count:', error)
    return 0
  }
}

/**
 * Check if specific media is in watchlist
 * @param {string} [mediaId] - Internal media ID
 * @param {number} [tmdbId] - TMDB ID
 * @param {string} [playlistId] - Specific playlist to check (optional)
 * @returns {Promise<boolean>} True if in watchlist
 */
export async function isInWatchlist(mediaId, tmdbId, playlistId = undefined) {
  try {
    const item = await checkWatchlistStatus(mediaId, tmdbId, playlistId)
    return !!item
  } catch (error) {
    console.error('Error checking watchlist status:', error)
    return false
  }
}

/**
 * Get recent watchlist additions
 * @param {number} [limit=10] - Number of recent items to get
 * @param {string} [playlistId] - Optional playlist filter
 * @returns {Promise<Array>} Recent watchlist items
 */
export async function getRecentWatchlistAdditions(limit = 10, playlistId = null) {
  try {
    return await getUserWatchlist({
      page: 0,
      limit,
      playlistId,
      countOnly: false
    })
  } catch (error) {
    console.error('Error getting recent watchlist additions:', error)
    return []
  }
}

/**
 * Search watchlist items by title
 * @param {string} query - Search query
 * @param {Object} [options] - Additional options
 * @param {string} [options.mediaType] - Filter by media type
 * @param {string} [options.playlistId] - Filter by playlist
 * @param {number} [options.limit=20] - Maximum results
 * @returns {Promise<Array>} Matching watchlist items
 */
export async function searchWatchlist(query, options = {}) {
  try {
    if (!query || typeof query !== 'string') {
      return []
    }

    // Get all watchlist items (could be optimized with text search in the future)
    const allItems = await getUserWatchlist({
      mediaType: options.mediaType,
      playlistId: options.playlistId,
      limit: 1000, // Large limit to get all items for search
      countOnly: false
    })

    // Filter by title match (case-insensitive)
    const searchTerm = query.toLowerCase()
    const matchingItems = allItems.filter(item => 
      item.title.toLowerCase().includes(searchTerm)
    )

    // Return limited results
    return matchingItems.slice(0, options.limit || 20)
  } catch (error) {
    console.error('Error searching watchlist:', error)
    return []
  }
}

/**
 * Validate and prepare item data for adding to watchlist
 * @param {Object} rawItem - Raw item data
 * @returns {Object} Validated and prepared item data
 * @throws {WatchlistValidationError} If validation fails
 */
export function prepareWatchlistItem(rawItem) {
  // Validate the item
  const validatedItem = validateWatchlistItem(rawItem)
  
  // Add any additional processing here if needed
  return validatedItem
}

/**
 * Get watchlist summary statistics
 * @returns {Promise<Object>} Summary statistics
 */
export async function getWatchlistSummary() {
  try {
    const stats = await getWatchlistStats()
    const recentItems = await getRecentWatchlistAdditions(5)
    const playlists = await getUserPlaylists()
    
    return {
      ...stats,
      recentAdditions: recentItems,
      playlistCount: playlists.length
    }
  } catch (error) {
    console.error('Error getting watchlist summary:', error)
    return {
      total: 0,
      movieCount: 0,
      tvCount: 0,
      playlistCount: 0,
      recentAdditions: []
    }
  }
}

/**
 * Create a new playlist with validation
 * @param {Object} playlistData - Playlist data
 * @returns {Promise<Object>} Created playlist
 */
export async function createNewPlaylist(playlistData) {
  try {
    const playlist = await createPlaylist(playlistData)
    return formatPlaylist(playlist)
  } catch (error) {
    console.error('Error creating playlist:', error)
    throw error
  }
}

/**
 * Get user's playlists with formatting
 * @param {Object} [options] - Query options
 * @returns {Promise<Array>} Formatted playlists
 */
export async function getFormattedPlaylists(options = {}) {
  try {
    const playlists = await getUserPlaylists(options)
    return playlists.map(formatPlaylist)
  } catch (error) {
    console.error('Error getting playlists:', error)
    return []
  }
}

/**
 * Get playlist with items
 * @param {string} playlistId - Playlist ID ('default' for default playlist)
 * @param {Object} [options] - Query options
 * @returns {Promise<Object>} Playlist with items
 */
export async function getPlaylistWithItems(playlistId, options = {}) {
  try {
    const items = await getUserWatchlist({
      ...options,
      playlistId: playlistId === 'default' ? null : playlistId
    })

    let playlist = null
    if (playlistId !== 'default') {
      const playlists = await getUserPlaylists()
      playlist = playlists.find(p => p.id === playlistId)
    } else {
      playlist = {
        id: 'default',
        name: 'My Watchlist',
        description: 'Default watchlist',
        privacy: 'private',
        isOwner: true,
        itemCount: items.length
      }
    }

    return {
      playlist: playlist ? formatPlaylist(playlist) : null,
      items: items.map(formatWatchlistItem)
    }
  } catch (error) {
    console.error('Error getting playlist with items:', error)
    return {
      playlist: null,
      items: []
    }
  }
}

// Constants for easy access
export const WATCHLIST_CONSTANTS = {
  MEDIA_TYPES: VALID_MEDIA_TYPES,
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
  SEARCH_LIMIT: 50,
  MAX_PLAYLIST_NAME_LENGTH: 100,
  MAX_PLAYLIST_DESCRIPTION_LENGTH: 500,
  MAX_COLLABORATORS: 20
}