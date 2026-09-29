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
   getMinimalCardDataForPlaylist,
   // Per-user playlist visibility, read by the home page and TV content (written by homeRows.js)
   getPlaylistVisibility,
   listVisiblePlaylists,
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
export { batchResolveMedia } from './mediaResolver.js'

import { addToWatchlist, checkWatchlistStatus, removeFromWatchlist } from './database.js'
// Import VALID_MEDIA_TYPES for use in constants
import { VALID_MEDIA_TYPES } from './validation.js'

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
    const existingItem = await checkWatchlistStatus(item.mediaId, item.tmdbId, item.playlistId, item.mediaType)

    if (existingItem) {
      // Remove from watchlist
      const removed = await removeFromWatchlist(existingItem.id)
      return {
        action: 'removed',
        success: removed,
        item: existingItem
      }
    }

    // Add to watchlist
    try {
      const addedItem = await addToWatchlist(item)
      return {
        action: 'added',
        success: true,
        item: addedItem
      }
    } catch (error) {
      // Another request added the title between the check above and this add:
      // it is in the playlist, which is what this toggle asked for. No item
      // is returned; the next status check fetches it.
      if (error?.message !== 'Item already exists in this playlist') throw error
      return {
        action: 'added',
        success: true,
        item: null
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
    // Present (true) only for a title TMDB no longer has; see tmdbMissing.js
    tmdbNotFound: item.tmdbNotFound || undefined,
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
    globalPermission: playlist.globalPermission,
    canAdd: playlist.canAdd,
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