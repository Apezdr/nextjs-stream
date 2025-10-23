'use server'

import clientPromise from '@src/lib/mongodb'
import { auth } from '@src/lib/auth'
import { ObjectId } from 'mongodb'
import { getFullImageUrl } from '@src/utils'
import { batchResolveMedia, getMediaByTMDBId } from './mediaResolver.js'

/**
 * Helper function to check if an input is a valid MongoDB ObjectId
 * @param {string|Object} id - The ID to validate (string or ObjectId)
 * @returns {boolean} True if the input is a valid ObjectId
 */
function isValidObjectId(id) {
  // Handle ObjectId instances directly
  if (id && typeof id === 'object' && id.constructor && id.constructor.name === 'ObjectId') {
    return true
  }

  // Handle string representation
  if (!id || typeof id !== 'string') {
    return false
  }

  // MongoDB ObjectId is a 24 character hex string
  return /^[0-9a-fA-F]{24}$/.test(id)
}

/**
 * Database operations for watchlist functionality with playlist support
 * Supports both internal media (in library) and external media (TMDB only)
 */

/**
 * Get user's watchlist with pagination and filtering
 * @param {Object} options - Query options
 * @param {number} [options.page=0] - Page number (0-based)
 * @param {number} [options.limit=20] - Items per page
 * @param {string} [options.mediaType] - Filter by media type ('movie', 'tv')
 * @param {string} [options.playlistId] - Filter by playlist ID
 * @param {boolean} [options.countOnly=false] - Return only count
 * @param {boolean} [options.internalOnly=false] - Only count/return items currently in library (uses TMDB ID lookup)
 * @returns {Promise<Array|number>} Watchlist items or count
 */
export async function getUserWatchlist({
  page = 0,
  limit = 20,
  mediaType,
  playlistId,
  countOnly = false,
  sortBy,
  sortOrder,
  internalOnly = false,
} = {}) {
  const session = await auth()

  if (!session?.user?.id) {
    throw new Error('User not authenticated')
  }

  try {
    const client = await clientPromise
    const db = client.db('Media')
    const collection = db.collection('Watchlist')
    const playlistsCollection = db.collection('Playlists')

    // Ensure valid playlist ID
    let actualPlaylistId = playlistId
    if (playlistId === 'default' || !playlistId) {
      const defaultPlaylist = await ensureDefaultPlaylist(session.user.id)
      actualPlaylistId = defaultPlaylist.id
    }

    // Build query
    const filter = {
      playlistId: new ObjectId(actualPlaylistId),
    }

    if (mediaType) filter.mediaType = mediaType

    // For internalOnly mode, we need to check library availability via TMDB ID
    // This requires a more complex query using aggregation
    if (internalOnly) {
      // Get TMDB IDs from watchlist
      const watchlistQuery = await collection
        .find(filter, { projection: { tmdbId: 1, mediaType: 1 } })
        .toArray()
      
      if (watchlistQuery.length === 0) {
        return countOnly ? 0 : []
      }
      
      // Group by media type
      const movieTmdbIds = watchlistQuery
        .filter(item => item.mediaType === 'movie' && item.tmdbId)
        .map(item => parseInt(item.tmdbId))
      const tvTmdbIds = watchlistQuery
        .filter(item => item.mediaType === 'tv' && item.tmdbId)
        .map(item => parseInt(item.tmdbId))
      
      // Check which TMDB IDs exist in library
      const [movieMatches, tvMatches] = await Promise.all([
        movieTmdbIds.length > 0
          ? db.collection('FlatMovies').find(
              { 'metadata.id': { $in: movieTmdbIds } },
              { projection: { 'metadata.id': 1 } }
            ).toArray()
          : Promise.resolve([]),
        tvTmdbIds.length > 0
          ? db.collection('FlatTVShows').find(
              { 'metadata.id': { $in: tvTmdbIds } },
              { projection: { 'metadata.id': 1 } }
            ).toArray()
          : Promise.resolve([])
      ])
      
      // Get available TMDB IDs
      const availableTmdbIds = new Set([
        ...movieMatches.map(m => m.metadata?.id).filter(Boolean),
        ...tvMatches.map(t => t.metadata?.id).filter(Boolean)
      ])
      
      if (countOnly) {
        return availableTmdbIds.size
      }
      
      // Filter watchlist to only available items
      filter.tmdbId = { $in: Array.from(availableTmdbIds) }
    }

    // Count only query (after applying internalOnly filter if needed)
    if (countOnly) {
      return await collection.countDocuments(filter)
    }

    // Get playlist for sorting preferences
    const playlist = await playlistsCollection.findOne(
      { _id: new ObjectId(actualPlaylistId) },
      { projection: { sortBy: 1, sortOrder: 1, customOrder: 1 } }
    )

    const finalSortBy = sortBy || playlist?.sortBy || 'dateAdded'
    const finalSortOrder = sortOrder || playlist?.sortOrder || 'desc'

    // Build sort - only sort by dateAdded at query time
    // Title and releaseDate sorting will be done in-memory after resolving media data
    const sortObj = {}
    if (finalSortBy !== 'custom' && finalSortBy === 'dateAdded') {
      sortObj.dateAdded = finalSortOrder === 'asc' ? 1 : -1
    } else {
      sortObj.dateAdded = -1 // Default sort for custom or other sorts
    }

    // Query watchlist items
    const watchlistItems = await collection
      .find(filter)
      .sort(sortObj)
      .skip(page * limit)
      .limit(limit)
      .toArray()

    if (watchlistItems.length === 0) {
      return []
    }

    // Batch resolve media data
    const itemsToResolve = watchlistItems.map((item) => ({
      tmdbId: item.tmdbId,
      mediaType: item.mediaType,
    }))

    // Resolve media data in batch
    const resolvedMedia = await batchResolveMedia(itemsToResolve)

    // Combine watchlist items with resolved media data
    const enhancedItems = watchlistItems.map((item) => {
      const mediaData = resolvedMedia.get(parseInt(item.tmdbId))

      if (mediaData) {
        return {
          id: item._id.toString(),
          watchlistId: item._id.toString(),
          userId: item.userId.toString(),
          playlistId: item.playlistId.toString(),
          dateAdded: item.dateAdded,
          notes: item.notes,
          rating: item.rating,
          ...mediaData,
        }
      } else {
        // If resolution failed, return minimal data (item will be excluded from results)
        return null
      }
    }).filter(Boolean) // Remove null entries

    // Apply sorting after resolving media data
    if (finalSortBy === 'custom' && playlist?.customOrder?.length > 0) {
      const orderMap = new Map(playlist.customOrder.map((id, index) => [id, index]))
      enhancedItems.sort((a, b) => {
        const aOrder = orderMap.get(a.id) ?? Number.MAX_SAFE_INTEGER
        const bOrder = orderMap.get(b.id) ?? Number.MAX_SAFE_INTEGER
        return aOrder - bOrder
      })
    } else if (finalSortBy === 'title') {
      // Sort by title after resolution
      enhancedItems.sort((a, b) => {
        const titleA = (a.title || '').toLowerCase()
        const titleB = (b.title || '').toLowerCase()
        const comparison = titleA.localeCompare(titleB)
        return finalSortOrder === 'asc' ? comparison : -comparison
      })
    } else if (finalSortBy === 'releaseDate') {
      // Sort by release date after resolution
      enhancedItems.sort((a, b) => {
        const dateA = a.releaseDate ? new Date(a.releaseDate) : new Date('9999-12-31')
        const dateB = b.releaseDate ? new Date(b.releaseDate) : new Date('9999-12-31')
        const comparison = dateA - dateB
        return finalSortOrder === 'asc' ? comparison : -comparison
      })
    }
    // dateAdded sorting already applied at query time

    // Background updates removed in simplified version - data is always fresh

    return enhancedItems
  } catch (error) {
    console.error('Error fetching user watchlist:', error)
    throw new Error('Failed to fetch watchlist')
  }
}

/**
 * Add item to watchlist
 * @param {Object} item - Watchlist item data
 * @param {string} [item.mediaId] - Internal media ID (for library items)
 * @param {number} [item.tmdbId] - TMDB ID
 * @param {string} item.mediaType - 'movie' or 'tv'
 * @param {string} item.title - Media title
 * @param {boolean} [item.isExternal=false] - Whether this is external TMDB-only media
 * @param {Object} [item.tmdbData] - TMDB metadata for external items
 * @param {string} [item.playlistId] - Playlist ID (null for default playlist)
 * @param {string} [item.posterURL] - Poster URL (for external media)
 * @returns {Promise<Object>} Created watchlist item
 */
export async function addToWatchlist({
  mediaId,
  tmdbId,
  mediaType,
  title,
  isExternal = false,
  tmdbData = {},
  playlistId = null,
  posterURL = null,
  notes = null,
  rating = null,
}) {
  const session = await auth()

  if (!session?.user?.id) {
    throw new Error('User not authenticated')
  }

  if (!tmdbId || !mediaType) {
    throw new Error('TMDB ID and media type are required')
  }

  try {
    const client = await clientPromise
    const db = client.db('Media')
    const collection = db.collection('Watchlist')

    // Ensure valid playlist ID
    let actualPlaylistId = playlistId
    if (!playlistId || playlistId === 'default') {
      const defaultPlaylist = await ensureDefaultPlaylist(session.user.id)
      actualPlaylistId = defaultPlaylist.id
    }

    // Check for duplicate using TMDB ID (primary key)
    const existingItem = await collection.findOne({
      userId: new ObjectId(session.user.id),
      playlistId: new ObjectId(actualPlaylistId),
      tmdbId: parseInt(tmdbId),
    })

    if (existingItem) {
      throw new Error('Item already exists in this playlist')
    }

    // Create minimal watchlist entry with TMDB ID as primary key
    const watchlistItem = {
      userId: new ObjectId(session.user.id),
      playlistId: new ObjectId(actualPlaylistId),
      tmdbId: parseInt(tmdbId),
      mediaType,
      dateAdded: new Date(),
      dateUpdated: new Date(),
    }

    // Add optional user metadata
    if (notes) watchlistItem.notes = notes
    if (rating) watchlistItem.rating = rating

    // If we have a valid mediaId, store it as a reference to internal media
    if (isValidObjectId(mediaId)) {
      watchlistItem.mediaId = new ObjectId(mediaId)
    }

    // Fetch full media data for return value
    const resolvedMedia = await batchResolveMedia([{ tmdbId: parseInt(tmdbId), mediaType }])
    const fullMediaData = resolvedMedia.get(parseInt(tmdbId))

    // Insert the item
    const result = await collection.insertOne(watchlistItem)

    const mediaData = fullMediaData

    if (mediaData) {
      return {
        id: result.insertedId.toString(),
        watchlistId: result.insertedId.toString(),
        userId: watchlistItem.userId.toString(),
        playlistId: watchlistItem.playlistId.toString(),
        dateAdded: watchlistItem.dateAdded,
        notes: watchlistItem.notes,
        rating: watchlistItem.rating,
        ...mediaData,
      }
    } else {
      // Fallback if media resolution failed
      return {
        id: result.insertedId.toString(),
        watchlistId: result.insertedId.toString(),
        userId: watchlistItem.userId.toString(),
        playlistId: watchlistItem.playlistId.toString(),
        tmdbId: parseInt(tmdbId),
        mediaType,
        title: title || 'Unknown Title',
        posterURL: posterURL || '/sorry-image-not-available.jpg',
        dateAdded: watchlistItem.dateAdded,
        notes: watchlistItem.notes,
        rating: watchlistItem.rating,
        isInternal: false,
        isExternal: true,
      }
    }
  } catch (error) {
    console.error('Error adding to watchlist:', error)
    if (error.message === 'Item already exists in this playlist') {
      throw error
    }
    throw new Error('Failed to add item to watchlist')
  }
}

/**
 * Remove item from watchlist
 * @param {string} watchlistId - Watchlist item ID
 * @returns {Promise<boolean>} Success status
 */
export async function removeFromWatchlist(watchlistId) {
  const session = await auth()

  if (!session?.user?.id) {
    throw new Error('User not authenticated')
  }

  try {
    const client = await clientPromise
    const db = client.db('Media')
    const collection = db.collection('Watchlist')

    const result = await collection.deleteOne({
      _id: new ObjectId(watchlistId),
      userId: new ObjectId(session.user.id),
    })

    return result.deletedCount > 0
  } catch (error) {
    console.error('Error removing from watchlist:', error)
    throw new Error('Failed to remove item from watchlist')
  }
}

/**
 * Check if item exists in user's watchlist
 * @param {string} [mediaId] - Internal media ID
 * @param {number} [tmdbId] - TMDB ID
 * @param {string} [playlistId] - Specific playlist to check (optional)
 * @returns {Promise<Object|null>} Watchlist item if exists, null otherwise
 */
export async function checkWatchlistStatus(mediaId, tmdbId, playlistId = null) {
  const session = await auth()

  if (!session?.user?.id) {
    return null
  }

  try {
    const client = await clientPromise
    const db = client.db('Media')
    const collection = db.collection('Watchlist')

    // Ensure we have a valid playlist ID
    let actualPlaylistId = playlistId
    if (!playlistId || playlistId === 'default') {
      const defaultPlaylist = await ensureDefaultPlaylist(session.user.id)
      actualPlaylistId = defaultPlaylist.id
    }

    const query = {
      userId: new ObjectId(session.user.id),
      playlistId: new ObjectId(actualPlaylistId),
    }

    // Prioritize TMDB ID as primary key, fall back to mediaId if needed
    if (tmdbId) {
      query.tmdbId = parseInt(tmdbId)
    } else if (mediaId && isValidObjectId(mediaId)) {
      query.mediaId = new ObjectId(mediaId)
    } else {
      return null // No valid identifiers provided
    }

    const item = await collection.findOne(query)

    if (!item) {
      return null
    }

    // No longer caching data in the database - data is resolved on read

    return {
      ...item,
      id: item._id.toString(),
      userId: item.userId.toString(),
      mediaId: item.mediaId?.toString(),
      playlistId: item.playlistId?.toString(),
    }
  } catch (error) {
    console.error('Error checking watchlist status:', error)
    return null
  }
}

/**
 * Get simple watchlist statistics for user
 * @returns {Promise<Object>} Watchlist statistics
 */
export async function getWatchlistStats() {
  const session = await auth()

  if (!session?.user?.id) {
    throw new Error('User not authenticated')
  }

  try {
    const client = await clientPromise
    const db = client.db('Media')
    const collection = db.collection('Watchlist')

    const pipeline = [
      { $match: { userId: new ObjectId(session.user.id) } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          movieCount: {
            $sum: { $cond: [{ $eq: ['$mediaType', 'movie'] }, 1, 0] },
          },
          tvCount: {
            $sum: { $cond: [{ $eq: ['$mediaType', 'tv'] }, 1, 0] },
          },
        },
      },
    ]

    const result = await collection.aggregate(pipeline).toArray()

    if (result.length === 0) {
      return {
        total: 0,
        movieCount: 0,
        tvCount: 0,
      }
    }

    return result[0]
  } catch (error) {
    console.error('Error getting watchlist stats:', error)
    throw new Error('Failed to get watchlist statistics')
  }
}

/**
 * Get media data using the MediaResolver service
 * @param {number} tmdbId - TMDB ID
 * @param {string} mediaType - Media type ('movie' or 'tv')
 * @returns {Promise<Object|null>} Media data or null if not found
 */
async function getMediaData(tmdbId, mediaType) {
  if (!tmdbId || !mediaType) return null

  try {
    return await getMediaByTMDBId(tmdbId, mediaType)
  } catch (error) {
    console.error(`Error getting media data for ${mediaType} ${tmdbId}:`, error)
    return null
  }
}

/**
 * Find media by mediaId and extract TMDB ID
 * This is a transitional function to help migrate from mediaId to tmdbId
 * @param {string} mediaId - Media ID
 * @param {string} mediaType - Media type ('movie' or 'tv')
 * @returns {Promise<number|null>} TMDB ID if found, null otherwise
 */
export async function findTMDBIdByMediaId(mediaId, mediaType) {
  if (!mediaId || !isValidObjectId(mediaId)) {
    return null
  }

  try {
    const client = await clientPromise
    const db = client.db('Media')
    const collection = mediaType === 'movie' ? 'FlatMovies' : 'FlatTVShows'

    const media = await db
      .collection(collection)
      .findOne({ _id: new ObjectId(mediaId) }, { projection: { 'metadata.id': 1 } })

    return media?.metadata?.id || null
  } catch (error) {
    console.error(`Error finding TMDB ID for ${mediaType} ${mediaId}:`, error)
    return null
  }
}

/**
 * Bulk operations for watchlist management
 */

/**
 * Bulk update watchlist items
 * @param {Array} updates - Array of {id, updates} objects
 * @returns {Promise<Array>} Results of updates
 */
export async function bulkUpdateWatchlist(updates) {
  const session = await auth()

  if (!session?.user?.id) {
    throw new Error('User not authenticated')
  }

  try {
    const client = await clientPromise
    const db = client.db('Media')
    const collection = db.collection('Watchlist')

    const bulkOps = updates.map(({ id, updates: itemUpdates }) => ({
      updateOne: {
        filter: {
          _id: new ObjectId(id),
          userId: new ObjectId(session.user.id),
        },
        update: {
          $set: {
            ...itemUpdates,
            dateUpdated: new Date(),
          },
        },
      },
    }))

    const result = await collection.bulkWrite(bulkOps)
    return {
      modifiedCount: result.modifiedCount,
      matchedCount: result.matchedCount,
    }
  } catch (error) {
    console.error('Error bulk updating watchlist:', error)
    throw new Error('Failed to bulk update watchlist')
  }
}

/**
 * Bulk remove items from watchlist
 * @param {Array} watchlistIds - Array of watchlist item IDs
 * @returns {Promise<number>} Number of deleted items
 */
export async function bulkRemoveFromWatchlist(watchlistIds) {
  const session = await auth()

  if (!session?.user?.id) {
    throw new Error('User not authenticated')
  }

  try {
    const client = await clientPromise
    const db = client.db('Media')
    const collection = db.collection('Watchlist')

    const result = await collection.deleteMany({
      _id: { $in: watchlistIds.map((id) => new ObjectId(id)) },
      userId: new ObjectId(session.user.id),
    })

    return result.deletedCount
  } catch (error) {
    console.error('Error bulk removing from watchlist:', error)
    throw new Error('Failed to bulk remove from watchlist')
  }
}

/**
 * Move items between playlists
 * When moving TO a custom playlist FROM master watchlist: removes from master and adds to custom playlist
 * When moving TO master watchlist FROM custom playlist: removes from custom and adds to master
 * When moving BETWEEN custom playlists: removes from source and adds to target
 * @param {Array} itemIds - Array of watchlist item IDs
 * @param {string|null} targetPlaylistId - Target playlist ID (null for default/master)
 * @returns {Promise<number>} Number of moved items
 */
export async function moveItemsToPlaylist(itemIds, targetPlaylistId) {
  const session = await auth()

  if (!session?.user?.id) {
    throw new Error('User not authenticated')
  }

  try {
    const client = await clientPromise
    const db = client.db('Media')
    const collection = db.collection('Watchlist')

    // Ensure we have a valid target playlist ID
    let actualTargetPlaylistId = targetPlaylistId
    if (!targetPlaylistId || targetPlaylistId === 'default') {
      const defaultPlaylist = await ensureDefaultPlaylist(session.user.id)
      actualTargetPlaylistId = defaultPlaylist.id
    }

    // Get the items to be moved to check their current playlist and get their data
    const itemsToMove = await collection
      .find({
        _id: { $in: itemIds.map((id) => new ObjectId(id)) },
        userId: new ObjectId(session.user.id),
      })
      .toArray()

    if (itemsToMove.length === 0) {
      return 0
    }

    let movedCount = 0

    // Process each item individually to handle the move logic
    for (const item of itemsToMove) {
      const sourcePlaylistId = item.playlistId
      const targetPlaylistObjectId = new ObjectId(actualTargetPlaylistId)

      // If moving to the same playlist, skip
      if (sourcePlaylistId && sourcePlaylistId.equals(targetPlaylistObjectId)) {
        continue
      }

      // Check if item already exists in target playlist
      // Prioritize TMDB ID as primary key
      let targetQuery = {
        userId: new ObjectId(session.user.id),
        playlistId: targetPlaylistObjectId,
      }

      if (item.tmdbId) {
        // Primary check by TMDB ID
        targetQuery.tmdbId = item.tmdbId
      } else if (item.mediaId) {
        // Fallback to mediaId if no TMDB ID
        targetQuery.mediaId = item.mediaId
      } else {
        // Skip items with no identifiers
        continue
      }

      const existingInTarget = await collection.findOne(targetQuery)

      if (existingInTarget) {
        // Item already exists in target playlist, just remove from source
        await collection.deleteOne({ _id: item._id })
        movedCount++
      } else {
        // Create new item in target playlist
        const newItem = {
          ...item,
          playlistId: targetPlaylistObjectId,
          dateAdded: new Date(), // Update date when moved to new playlist
          dateUpdated: new Date(),
        }
        delete newItem._id // Let MongoDB generate the ID

        await collection.insertOne(newItem)

        // Remove from source playlist
        await collection.deleteOne({ _id: item._id })
        movedCount++
      }
    }

    return movedCount
  } catch (error) {
    console.error('Error moving items to playlist:', error)
    throw new Error('Failed to move items to playlist')
  }
}

// ===== PLAYLIST OPERATIONS =====

/**
 * Ensure user has a default playlist, create if missing
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Default playlist
 */
export async function ensureDefaultPlaylist(userId) {
  const session = await auth()

  if (!session?.user?.id) {
    throw new Error('User not authenticated')
  }

  try {
    const client = await clientPromise
    const db = client.db('Media')
    const collection = db.collection('Playlists')
    const watchlistCollection = db.collection('Watchlist')

    const ownerObjectId = new ObjectId(userId || session.user.id)
    const now = new Date()

    // 1) Consolidate any existing duplicate default playlists for this user (safety + legacy cleanup)
    const existingDefaults = await collection
      .find({ ownerId: ownerObjectId, isDefault: true })
      .toArray()
    if (existingDefaults.length > 1) {
      // Pick keeper: highest itemCount, then oldest by dateCreated
      const keeper = existingDefaults
        .slice()
        .sort(
          (a, b) =>
            (b.itemCount || 0) - (a.itemCount || 0) ||
            new Date(a.dateCreated) - new Date(b.dateCreated)
        )[0]

      const duplicateIds = existingDefaults
        .filter((p) => p._id.toString() !== keeper._id.toString())
        .map((p) => p._id)

      if (duplicateIds.length > 0) {
        // Repoint items from duplicates to keeper
        await watchlistCollection.updateMany(
          { userId: ownerObjectId, playlistId: { $in: duplicateIds } },
          { $set: { playlistId: keeper._id, dateUpdated: now } }
        )
        // Remove duplicates
        await collection.deleteMany({ _id: { $in: duplicateIds } })
      }
    }

    // 2) Enforce at DB level: one default playlist per user (after cleanup to avoid duplicate key)
    try {
      await collection.createIndex(
        { ownerId: 1, isDefault: 1 },
        {
          name: 'unique_default_playlist_per_user',
          unique: true,
          partialFilterExpression: { isDefault: true },
        }
      )
    } catch (e) {
      // Index exists or conflicting transient state; continue
      if (process.env.DEBUG === 'true') {
        console.warn('Playlist unique index ensure warning:', e?.message || e)
      }
    }

    // 3) Atomic upsert to avoid race conditions creating multiple defaults
    const defaultPlaylist = await collection.findOneAndUpdate(
      { ownerId: ownerObjectId, isDefault: true },
      {
        $setOnInsert: {
          name: 'My Watchlist',
          description: null,
          privacy: 'private',
          ownerId: ownerObjectId,
          isDefault: true,
          collaborators: [],
          dateCreated: now,
          itemCount: 0,
          sortBy: 'dateAdded',
          sortOrder: 'desc',
          customOrder: [],
        },
        $set: {
          dateUpdated: now,
        },
      },
      { upsert: true, returnDocument: 'after' }
    )

    if (!defaultPlaylist) {
      throw new Error('Failed to create or retrieve default playlist')
    }

    return {
      ...defaultPlaylist,
      id: defaultPlaylist._id.toString(),
      ownerId: defaultPlaylist.ownerId.toString(),
    }
  } catch (error) {
    console.error('Error ensuring default playlist:', error)
    throw new Error('Failed to ensure default playlist')
  }
}

/**
 * Create a new playlist
 * @param {Object} playlistData - Playlist data
 * @param {string} playlistData.name - Playlist name
 * @param {string} [playlistData.description] - Playlist description
 * @param {string} [playlistData.privacy='private'] - Privacy setting
 * @param {boolean} [playlistData.isDefault=false] - Whether this is a default playlist
 * @returns {Promise<Object>} Created playlist
 */
export async function createPlaylist({
  name,
  description = '',
  privacy = 'private',
  isDefault = false,
}) {
  const session = await auth()

  if (!session?.user?.id) {
    throw new Error('User not authenticated')
  }

  try {
    const client = await clientPromise
    const db = client.db('Media')
    const collection = db.collection('Playlists')

    const playlist = {
      name: name.trim(),
      description: description.trim(),
      privacy,
      ownerId: new ObjectId(session.user.id),
      collaborators: [],
      dateCreated: new Date(),
      dateUpdated: new Date(),
      itemCount: 0,
      sortBy: 'dateAdded', // Default sort field
      sortOrder: 'desc', // Default sort order
      customOrder: [], // Array of item IDs for manual ordering
    }

    const result = await collection.insertOne(playlist)

    return {
      ...playlist,
      id: result.insertedId.toString(),
      ownerId: playlist.ownerId.toString(),
    }
  } catch (error) {
    console.error('Error creating playlist:', error)
    throw new Error('Failed to create playlist')
  }
}

/**
 * Get user's playlists
 * @param {Object} options - Query options
 * @param {boolean} [options.includeShared=true] - Include shared playlists
 * @returns {Promise<Array>} User's playlists
 */
export async function getUserPlaylists({ includeShared = true, includePublic = true } = {}) {
  const session = await auth()

  if (!session?.user?.id) {
    throw new Error('User not authenticated')
  }

  try {
    const client = await clientPromise
    const db = client.db('Media')
    const usersDb = client.db('Users')
    const collection = db.collection('Playlists')
    const usersCollection = usersDb.collection('AuthenticatedUsers')

    const userId = new ObjectId(session.user.id)

    // Build filter to include:
    // 1. User's own playlists
    // 2. Playlists shared with user (if includeShared)
    // 3. Public playlists (if includePublic)
    const orConditions = [{ ownerId: userId }]

    if (includeShared) {
      orConditions.push({ 'collaborators.userId': userId })
    }

    if (includePublic) {
      orConditions.push({ privacy: 'public' })
    }

    const filter = { $or: orConditions }

    const playlists = await collection.find(filter).sort({ dateUpdated: -1 }).toArray()

    // Get unique owner IDs to fetch owner names in batch
    const ownerIds = [...new Set(playlists.map((p) => p.ownerId.toString()))]
    const owners = await usersCollection
      .find(
        { _id: { $in: ownerIds.map((id) => new ObjectId(id)) } },
        { projection: { _id: 1, name: 1, email: 1 } }
      )
      .toArray()

    // Create owner lookup map
    const ownerMap = new Map(
      owners.map((owner) => [owner._id.toString(), owner.name || owner.email || 'Unknown User'])
    )

    // Get item counts for each playlist
    const watchlistCollection = db.collection('Watchlist')
    const playlistsWithCounts = await Promise.all(
      playlists.map(async (playlist) => {
        // Count ALL items in the playlist (regardless of who added them)
        // This supports collaborative playlists where multiple users can add items
        const itemCount = await watchlistCollection.countDocuments({
          playlistId: playlist._id,
        })

        // Determine relationship type for categorization
        const isOwner = playlist.ownerId.equals(userId)
        const isCollaborator =
          !isOwner && playlist.collaborators?.some((collab) => collab.userId.equals(userId))
        const isPublic = playlist.privacy === 'public' && !isOwner && !isCollaborator

        // Determine if user can edit this playlist
        // Can edit if: owner, or collaborator with edit/admin permission
        const collaboratorPermission = playlist.collaborators?.find((collab) =>
          collab.userId.equals(userId)
        )?.permission
        const canEdit =
          isOwner ||
          ['edit', 'admin'].includes(collaboratorPermission) ||
          session?.user?.role === 'admin' ||
          session?.user?.admin

        return {
          ...playlist,
          id: playlist._id.toString(),
          ownerId: playlist.ownerId.toString(),
          ownerName: ownerMap.get(playlist.ownerId.toString()) || 'Unknown User',
          itemCount,
          isOwner,
          isCollaborator,
          isPublic,
          canEdit,
          collaborators:
            playlist.collaborators?.map((collab) => ({
              ...collab,
              userId: collab.userId.toString(),
            })) || [],
        }
      })
    )

    return playlistsWithCounts
  } catch (error) {
    console.error('Error getting user playlists:', error)
    throw new Error('Failed to get playlists')
  }
}

/**
 * Get a single playlist by ID (includes public playlists and those shared with user)
 * @param {string} playlistId - Playlist ID
 * @returns {Promise<Object|null>} Playlist or null if not found/not accessible
 */
export async function getPlaylistById(playlistId) {
  const session = await auth()

  if (!session?.user?.id) {
    throw new Error('User not authenticated')
  }

  try {
    const client = await clientPromise
    const db = client.db('Media')
    const usersDb = client.db('Users')
    const collection = db.collection('Playlists')
    const watchlistCollection = db.collection('Watchlist')
    const usersCollection = usersDb.collection('AuthenticatedUsers')

    const userId = new ObjectId(session.user.id)

    // Find playlist that is either:
    // 1. Owned by user
    // 2. User is a collaborator
    // 3. Public (privacy='public')
    const playlist = await collection.findOne({
      _id: new ObjectId(playlistId),
      $or: [{ ownerId: userId }, { 'collaborators.userId': userId }, { privacy: 'public' }],
    })

    if (!playlist) {
      return null
    }

    // Get owner name
    const owner = await usersCollection.findOne(
      { _id: playlist.ownerId },
      { projection: { name: 1, email: 1 } }
    )
    const ownerName = owner?.name || owner?.email || 'Unknown User'

    // Get item count for this playlist
    // Count ALL items in the playlist (regardless of who added them)
    // This supports collaborative playlists where multiple users can add items
    const itemCount = await watchlistCollection.countDocuments({
      playlistId: playlist._id,
    })

    // Determine relationship type for categorization
    const isOwner = playlist.ownerId.equals(userId)
    const isCollaborator =
      !isOwner && playlist.collaborators?.some((collab) => collab.userId.equals(userId))
    const isPublic = playlist.privacy === 'public' && !isOwner && !isCollaborator

    // Determine if user can edit this playlist
    // Can edit if: owner, or collaborator with edit/admin permission, or user is admin
    const collaboratorPermission = playlist.collaborators?.find((collab) =>
      collab.userId.equals(userId)
    )?.permission
    const canEdit =
      isOwner ||
      ['edit', 'admin'].includes(collaboratorPermission) ||
      session?.user?.role === 'admin' ||
      session?.user?.admin

    return {
      ...playlist,
      id: playlist._id.toString(),
      ownerId: playlist.ownerId.toString(),
      ownerName,
      itemCount,
      isOwner,
      isCollaborator,
      isPublic,
      canEdit,
      collaborators:
        playlist.collaborators?.map((collab) => ({
          ...collab,
          userId: collab.userId.toString(),
        })) || [],
    }
  } catch (error) {
    console.error('Error getting playlist by ID:', error)
    throw new Error('Failed to get playlist')
  }
}

/**
 * Update playlist
 * @param {string} playlistId - Playlist ID
 * @param {Object} updates - Updates to apply
 * @returns {Promise<boolean>} Success status
 */
export async function updatePlaylist(playlistId, updates) {
  const session = await auth()

  if (!session?.user?.id) {
    throw new Error('User not authenticated')
  }

  try {
    const client = await clientPromise
    const db = client.db('Media')
    const collection = db.collection('Playlists')

    const result = await collection.updateOne(
      {
        _id: new ObjectId(playlistId),
        $or: [
          { ownerId: new ObjectId(session.user.id) },
          {
            'collaborators.userId': new ObjectId(session.user.id),
            'collaborators.permission': { $in: ['edit', 'admin'] },
          },
        ],
      },
      {
        $set: {
          ...updates,
          dateUpdated: new Date(),
        },
      }
    )

    return result.modifiedCount > 0
  } catch (error) {
    console.error('Error updating playlist:', error)
    throw new Error('Failed to update playlist')
  }
}

/**
 * Delete playlist
 * @param {string} playlistId - Playlist ID
 * @returns {Promise<boolean>} Success status
 */
export async function deletePlaylist(playlistId) {
  const session = await auth()

  if (!session?.user?.id) {
    throw new Error('User not authenticated')
  }

  try {
    const client = await clientPromise
    const db = client.db('Media')

    // Only owner can delete playlist (and never allow deleting the default)
    const playlistDoc = await db.collection('Playlists').findOne({
      _id: new ObjectId(playlistId),
      ownerId: new ObjectId(session.user.id),
    })
    if (!playlistDoc) {
      return false
    }
    if (playlistDoc.isDefault) {
      // Prevent deleting default playlist
      throw new Error('Cannot delete default playlist')
    }

    const playlistResult = await db.collection('Playlists').deleteOne({
      _id: new ObjectId(playlistId),
      ownerId: new ObjectId(session.user.id),
    })

    if (playlistResult.deletedCount > 0) {
      // Move all items in this playlist to the user's default playlist
      const defaultPlaylist = await ensureDefaultPlaylist(session.user.id)
      await db.collection('Watchlist').updateMany(
        {
          userId: new ObjectId(session.user.id),
          playlistId: new ObjectId(playlistId),
        },
        {
          $set: {
            playlistId: new ObjectId(defaultPlaylist.id),
            dateUpdated: new Date(),
          },
        }
      )
    }

    return playlistResult.deletedCount > 0
  } catch (error) {
    console.error('Error deleting playlist:', error)
    throw new Error('Failed to delete playlist')
  }
}

/**
 * Share playlist with users
 * @param {string} playlistId - Playlist ID
 * @param {Array} collaborators - Array of {email, permission} objects
 * @returns {Promise<boolean>} Success status
 */
export async function sharePlaylist(playlistId, collaborators) {
  const session = await auth()

  if (!session?.user?.id) {
    throw new Error('User not authenticated')
  }

  try {
    const client = await clientPromise
    const db = client.db('Media')
    const usersDb = client.db('Users')

    // Get user IDs for the emails
    const userIds = await Promise.all(
      collaborators.map(async ({ email, permission }) => {
        const user = await usersDb.collection('AuthenticatedUsers').findOne({ email })
        return user
          ? {
              userId: user._id,
              email,
              permission,
              dateAdded: new Date(),
            }
          : null
      })
    )

    const validCollaborators = userIds.filter(Boolean)

    const result = await db.collection('Playlists').updateOne(
      {
        _id: new ObjectId(playlistId),
        ownerId: new ObjectId(session.user.id),
      },
      {
        $addToSet: {
          collaborators: { $each: validCollaborators },
        },
        $set: {
          dateUpdated: new Date(),
        },
      }
    )

    return result.modifiedCount > 0
  } catch (error) {
    console.error('Error sharing playlist:', error)
    throw new Error('Failed to share playlist')
  }
}

/**
 * Update playlist sorting preferences
 * @param {string} playlistId - Playlist ID
 * @param {string} sortBy - Sort field ('dateAdded', 'title', 'releaseDate', 'custom')
 * @param {string} sortOrder - Sort order ('asc', 'desc')
 * @returns {Promise<boolean>} Success status
 */
export async function updatePlaylistSorting(playlistId, sortBy, sortOrder) {
  const session = await auth()

  if (!session?.user?.id) {
    throw new Error('User not authenticated')
  }

  try {
    const client = await clientPromise
    const db = client.db('Media')
    const collection = db.collection('Playlists')

    const result = await collection.updateOne(
      {
        _id: new ObjectId(playlistId),
        $or: [
          { ownerId: new ObjectId(session.user.id) },
          {
            'collaborators.userId': new ObjectId(session.user.id),
            'collaborators.permission': { $in: ['edit', 'admin'] },
          },
        ],
      },
      {
        $set: {
          sortBy,
          sortOrder,
          dateUpdated: new Date(),
        },
      }
    )

    return result.modifiedCount > 0
  } catch (error) {
    console.error('Error updating playlist sorting:', error)
    throw new Error('Failed to update playlist sorting')
  }
}

/**
 * Update custom order for playlist items
 * @param {string} playlistId - Playlist ID
 * @param {Array} itemIds - Array of item IDs in desired order
 * @returns {Promise<boolean>} Success status
 */
export async function updatePlaylistCustomOrder(playlistId, itemIds) {
  const session = await auth()

  if (!session?.user?.id) {
    throw new Error('User not authenticated')
  }

  try {
    const client = await clientPromise
    const db = client.db('Media')
    const collection = db.collection('Playlists')

    const result = await collection.updateOne(
      {
        _id: new ObjectId(playlistId),
        $or: [
          { ownerId: new ObjectId(session.user.id) },
          {
            'collaborators.userId': new ObjectId(session.user.id),
            'collaborators.permission': { $in: ['edit', 'admin'] },
          },
        ],
      },
      {
        $set: {
          customOrder: itemIds,
          sortBy: 'custom',
          dateUpdated: new Date(),
        },
      }
    )

    return result.modifiedCount > 0
  } catch (error) {
    console.error('Error updating playlist custom order:', error)
    throw new Error('Failed to update playlist custom order')
  }
}

// ===== PLAYLIST VISIBILITY (PER-USER) =====

/**
 * Ensure indexes for Users.PlaylistVisibility
 * - unique (userId, playlistId)
 * - secondary on playlistId
 * - compound to support showInApp queries
 */
async function ensurePlaylistVisibilityIndexes() {
  try {
    const client = await clientPromise
    const usersDb = client.db('Users')
    const coll = usersDb.collection('PlaylistVisibility')

    // Unique compound index (userId, playlistId)
    await coll.createIndex(
      { userId: 1, playlistId: 1 },
      { name: 'unique_user_playlist_visibility', unique: true }
    )

    // Secondary index for admin-wide operations on a playlist
    await coll.createIndex({ playlistId: 1 }, { name: 'by_playlistId' })

    // Index to support frequent "showInApp=1 for userId" queries with ordering
    await coll.createIndex(
      { userId: 1, showInApp: 1, appOrder: 1, dateUpdated: -1 },
      { name: 'by_user_showInApp_appOrder' }
    )
  } catch (e) {
    if (process.env.DEBUG === 'true') {
      console.warn('[PlaylistVisibility] Index ensure warning:', e?.message || e)
    }
    // Continue; indexes may already exist
  }
}

/**
 * Validate and coerce playlist visibility payload with defaults
 */
function normalizeVisibilityPayload(payload = {}) {
  const normalized = {}
  if (typeof payload.showInApp === 'boolean') {
    normalized.showInApp = payload.showInApp
  }
  if (payload.appOrder !== undefined) {
    const n = parseInt(payload.appOrder)
    if (!Number.isNaN(n) && n >= 0) normalized.appOrder = n
  }
  if (payload.appTitle === null || payload.appTitle === undefined) {
    // explicit null clears the title
    if (payload.appTitle === null) normalized.appTitle = null
  } else if (typeof payload.appTitle === 'string') {
    const trimmed = payload.appTitle.trim()
    if (trimmed.length <= 100) normalized.appTitle = trimmed
  }
  // Support for hiding unavailable content
  if (typeof payload.hideUnavailable === 'boolean') {
    normalized.hideUnavailable = payload.hideUnavailable
  }
  return normalized
}

/**
 * Get a single visibility preference for a user+playlist
 */
export async function getPlaylistVisibility(userId, playlistId) {
  if (!isValidObjectId(userId) || !isValidObjectId(playlistId)) {
    throw new Error('Invalid userId or playlistId')
  }

  await ensurePlaylistVisibilityIndexes()

  const client = await clientPromise
  const usersDb = client.db('Users')
  const coll = usersDb.collection('PlaylistVisibility')

  const doc = await coll.findOne({
    userId: new ObjectId(userId),
    playlistId: new ObjectId(playlistId),
  })

  if (!doc) return null

  return {
    userId: doc.userId.toString(),
    playlistId: doc.playlistId.toString(),
    showInApp: !!doc.showInApp,
    appOrder: typeof doc.appOrder === 'number' ? doc.appOrder : 0,
    appTitle: doc.appTitle ?? null,
    hideUnavailable: !!doc.hideUnavailable, // Default to false (show all)
    dateCreated: doc.dateCreated,
    dateUpdated: doc.dateUpdated,
  }
}

/**
 * Upsert visibility for a single user+playlist
 * Defaults: showInApp=false, appOrder=0, appTitle=null
 */
export async function setPlaylistVisibility(userId, playlistId, payload = {}) {
  if (!isValidObjectId(userId) || !isValidObjectId(playlistId)) {
    throw new Error('Invalid userId or playlistId')
  }

  await ensurePlaylistVisibilityIndexes()

  const client = await clientPromise
  const usersDb = client.db('Users')
  const coll = usersDb.collection('PlaylistVisibility')

  const now = new Date()
  const normalized = normalizeVisibilityPayload(payload)

  // Build $set and $setOnInsert with defaults
  // Avoid setting the same field in both $set and $setOnInsert to prevent Mongo conflict
  const setOnInsert = {
    userId: new ObjectId(userId),
    playlistId: new ObjectId(playlistId),
    dateCreated: now,
    ...(!('showInApp' in normalized) ? { showInApp: false } : {}),
    ...(!('appOrder' in normalized) ? { appOrder: 0 } : {}),
    ...(!('appTitle' in normalized) ? { appTitle: null } : {}),
    ...(!('hideUnavailable' in normalized) ? { hideUnavailable: false } : {}),
  }
  const setUpdate = {
    dateUpdated: now,
  }
  if ('showInApp' in normalized) setUpdate.showInApp = normalized.showInApp
  if ('appOrder' in normalized) setUpdate.appOrder = normalized.appOrder
  if ('appTitle' in normalized) setUpdate.appTitle = normalized.appTitle
  if ('hideUnavailable' in normalized) setUpdate.hideUnavailable = normalized.hideUnavailable

  const result = await coll.updateOne(
    { userId: new ObjectId(userId), playlistId: new ObjectId(playlistId) },
    {
      $setOnInsert: setOnInsert,
      $set: setUpdate,
    },
    { upsert: true }
  )

  return { matchedCount: result.matchedCount, upsertedId: result.upsertedId }
}

/**
 * List visible playlists for a user (showInApp=true),
 * ordered by appOrder asc then dateUpdated desc
 */
export async function listVisiblePlaylists(userId) {
  if (!isValidObjectId(userId)) {
    throw new Error('Invalid userId')
  }

  await ensurePlaylistVisibilityIndexes()

  const client = await clientPromise
  const usersDb = client.db('Users')
  const coll = usersDb.collection('PlaylistVisibility')

  const cursor = coll
    .find({
      userId: new ObjectId(userId),
      showInApp: true,
    })
    .sort({ appOrder: 1, dateUpdated: -1 })

  const docs = await cursor.toArray()
  return docs.map((doc) => ({
    userId: doc.userId.toString(),
    playlistId: doc.playlistId.toString(),
    showInApp: !!doc.showInApp,
    appOrder: typeof doc.appOrder === 'number' ? doc.appOrder : 0,
    appTitle: doc.appTitle ?? null,
    hideUnavailable: !!doc.hideUnavailable, // Default to false (show all)
    dateCreated: doc.dateCreated,
    dateUpdated: doc.dateUpdated,
  }))
}

/**
 * Admin helper: bulk set visibility for a playlist across many users
 * targets: array of userId strings
 * payload: { showInApp?, appOrder?, appTitle? }
 */
export async function bulkSetPlaylistVisibility(playlistId, targets = [], payload = {}) {
  if (!isValidObjectId(playlistId)) {
    throw new Error('Invalid playlistId')
  }

  await ensurePlaylistVisibilityIndexes()

  const client = await clientPromise
  const usersDb = client.db('Users')
  const coll = usersDb.collection('PlaylistVisibility')

  const now = new Date()
  const normalized = normalizeVisibilityPayload(payload)

  const bulkOps = []
  for (const uid of targets) {
    if (!isValidObjectId(uid)) continue
    const filter = { userId: new ObjectId(uid), playlistId: new ObjectId(playlistId) }
    // Avoid setting same field in both $set and $setOnInsert
    const setOnInsert = {
      userId: new ObjectId(uid),
      playlistId: new ObjectId(playlistId),
      dateCreated: now,
      ...(!('showInApp' in normalized) ? { showInApp: false } : {}),
      ...(!('appOrder' in normalized) ? { appOrder: 0 } : {}),
      ...(!('appTitle' in normalized) ? { appTitle: null } : {}),
      ...(!('hideUnavailable' in normalized) ? { hideUnavailable: false } : {}),
    }
    const setUpdate = { dateUpdated: now }
    if ('showInApp' in normalized) setUpdate.showInApp = normalized.showInApp
    if ('appOrder' in normalized) setUpdate.appOrder = normalized.appOrder
    if ('appTitle' in normalized) setUpdate.appTitle = normalized.appTitle
    if ('hideUnavailable' in normalized) setUpdate.hideUnavailable = normalized.hideUnavailable

    bulkOps.push({
      updateOne: {
        filter,
        update: { $setOnInsert: setOnInsert, $set: setUpdate },
        upsert: true,
      },
    })
  }

  if (bulkOps.length === 0) {
    return { matchedCount: 0, upsertedCount: 0, modifiedCount: 0 }
  }

  const result = await coll.bulkWrite(bulkOps, { ordered: false })
  return {
    matchedCount: result.matchedCount || 0,
    upsertedCount: result.upsertedCount || 0,
    modifiedCount: result.modifiedCount || 0,
  }
}

/**
 * Admin helper: disable a playlist for all users (remove all visibility docs for playlistId)
 */
export async function resetVisibilityForPlaylist(playlistId) {
  if (!isValidObjectId(playlistId)) {
    throw new Error('Invalid playlistId')
  }

  await ensurePlaylistVisibilityIndexes()

  const client = await clientPromise
  const usersDb = client.db('Users')
  const coll = usersDb.collection('PlaylistVisibility')

  const result = await coll.deleteMany({ playlistId: new ObjectId(playlistId) })
  return { deletedCount: result.deletedCount || 0 }
}

/**
 * Admin helper: list users with optional search/pagination
 * Returns minimal identity info for moderation panel
 */
export async function findUsersForAdmin({ search = '', page = 0, limit = 20 } = {}) {
  const client = await clientPromise
  const usersDb = client.db('Users')
  const usersCollection = usersDb.collection('AuthenticatedUsers')

  const filter = {}
  if (search && typeof search === 'string') {
    const re = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    filter.$or = [{ name: re }, { email: re }]
  }

  const safeLimit = Math.max(1, Math.min(100, parseInt(limit)))
  const safePage = Math.max(0, parseInt(page))

  const cursor = usersCollection
    .find(filter, { projection: { _id: 1, name: 1, email: 1 } })
    .sort({ name: 1, email: 1 })
    .skip(safePage * safeLimit)
    .limit(safeLimit)

  const users = await cursor.toArray()
  const total = await usersCollection.countDocuments(filter)
  return {
    users: users.map((u) => ({
      userId: u._id.toString(),
      name: u.name || '',
      email: u.email || '',
    })),
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
    },
  }
}

// ===== COMING SOON MANAGEMENT =====

/**
 * Ensure indexes for Media.ComingSoon collection
 * - Unique compound index on (tmdbId, mediaType)
 * - Secondary indexes for queries
 */
async function ensureComingSoonIndexes() {
  try {
    const client = await clientPromise
    const db = client.db('Media')
    const coll = db.collection('ComingSoon')

    // Unique compound index (tmdbId, mediaType)
    await coll.createIndex(
      { tmdbId: 1, mediaType: 1 },
      { name: 'unique_tmdb_coming_soon', unique: true }
    )

    // Index for date-based queries
    await coll.createIndex(
      { comingSoonDate: 1 },
      { name: 'by_comingSoonDate' }
    )

    // Index for audit trail
    await coll.createIndex(
      { setAt: 1 },
      { name: 'by_setAt' }
    )
  } catch (e) {
    if (process.env.DEBUG === 'true') {
      console.warn('[ComingSoon] Index ensure warning:', e?.message || e)
    }
    // Continue; indexes may already exist
  }
}

/**
 * Get "Coming Soon" status for a single TMDB item
 * @param {number} tmdbId - TMDB ID
 * @param {string} mediaType - 'movie' or 'tv'
 * @returns {Promise<Object|null>} Coming soon data or null if not set
 */
export async function getComingSoonStatus(tmdbId, mediaType) {
  if (!tmdbId || !mediaType) {
    throw new Error('tmdbId and mediaType are required')
  }

  await ensureComingSoonIndexes()

  const client = await clientPromise
  const db = client.db('Media')
  const coll = db.collection('ComingSoon')

  const doc = await coll.findOne({
    tmdbId: parseInt(tmdbId),
    mediaType: mediaType,
  })

  if (!doc) return null

  return {
    tmdbId: doc.tmdbId,
    mediaType: doc.mediaType,
    comingSoon: true, // Always true if document exists
    comingSoonDate: doc.comingSoonDate || null,
    notes: doc.notes || null,
    setBy: doc.setBy?.toString() || null,
    setByUsername: doc.setByUsername || null,
    setAt: doc.setAt,
    updatedAt: doc.updatedAt,
    lastChecked: doc.lastChecked || null,
    source: doc.source || 'manual',
  }
}

/**
 * Set "Coming Soon" status for a TMDB item
 * @param {Object} data - Coming soon data
 * @param {number} data.tmdbId - TMDB ID
 * @param {string} data.mediaType - 'movie' or 'tv'
 * @param {Date} [data.comingSoonDate] - Optional target date
 * @param {string} [data.notes] - Optional admin notes
 * @param {string} data.setBy - User ID of admin setting this
 * @param {string} data.setByUsername - Username for audit display
 * @param {string} [data.source='manual'] - Source: 'manual', 'radarr', 'sonarr'
 * @returns {Promise<Object>} Result with upserted status
 */
export async function setComingSoonStatus({
  tmdbId,
  mediaType,
  comingSoonDate = null,
  notes = null,
  setBy,
  setByUsername,
  source = 'manual',
}) {
  if (!tmdbId || !mediaType || !setBy) {
    throw new Error('tmdbId, mediaType, and setBy are required')
  }

  await ensureComingSoonIndexes()

  const client = await clientPromise
  const db = client.db('Media')
  const coll = db.collection('ComingSoon')

  const now = new Date()

  const doc = {
    tmdbId: parseInt(tmdbId),
    mediaType: mediaType,
    comingSoon: true,
    updatedAt: now,
  }

  // Optional fields
  if (comingSoonDate) doc.comingSoonDate = new Date(comingSoonDate)
  if (notes) doc.notes = notes
  if (setBy) doc.setBy = new ObjectId(setBy)
  if (setByUsername) doc.setByUsername = setByUsername
  if (source) doc.source = source

  const result = await coll.updateOne(
    { tmdbId: parseInt(tmdbId), mediaType: mediaType },
    {
      $set: doc,
      $setOnInsert: {
        setAt: now,
      },
    },
    { upsert: true }
  )

  return {
    matched: result.matchedCount > 0,
    upserted: !!result.upsertedId,
    upsertedId: result.upsertedId?.toString() || null,
  }
}

/**
 * Remove "Coming Soon" status for a TMDB item
 * @param {number} tmdbId - TMDB ID
 * @param {string} mediaType - 'movie' or 'tv'
 * @returns {Promise<boolean>} True if deleted, false if not found
 */
export async function removeComingSoonStatus(tmdbId, mediaType) {
  if (!tmdbId || !mediaType) {
    throw new Error('tmdbId and mediaType are required')
  }

  await ensureComingSoonIndexes()

  const client = await clientPromise
  const db = client.db('Media')
  const coll = db.collection('ComingSoon')

  const result = await coll.deleteOne({
    tmdbId: parseInt(tmdbId),
    mediaType: mediaType,
  })

  return result.deletedCount > 0
}

/**
 * Bulk get "Coming Soon" status for multiple TMDB items
 * Returns a Map of tmdbId -> coming soon data for efficient lookups
 * @param {Array<{tmdbId: number, mediaType: string}>} items - Array of items to check
 * @returns {Promise<Map>} Map of tmdbId -> coming soon data
 */
export async function bulkGetComingSoonStatus(items) {
  if (!items || items.length === 0) {
    return new Map()
  }

  await ensureComingSoonIndexes()

  const client = await clientPromise
  const db = client.db('Media')
  const coll = db.collection('ComingSoon')

  // Build $or query for batch lookup
  const orConditions = items.map((item) => ({
    tmdbId: parseInt(item.tmdbId),
    mediaType: item.mediaType,
  }))

  const docs = await coll.find({ $or: orConditions }).toArray()

  // Create map for quick lookup
  const resultMap = new Map()
  docs.forEach((doc) => {
    resultMap.set(parseInt(doc.tmdbId), {
      tmdbId: doc.tmdbId,
      mediaType: doc.mediaType,
      comingSoon: true,
      comingSoonDate: doc.comingSoonDate || null,
      notes: doc.notes || null,
      setBy: doc.setBy?.toString() || null,
      setByUsername: doc.setByUsername || null,
      setAt: doc.setAt,
      updatedAt: doc.updatedAt,
      lastChecked: doc.lastChecked || null,
      source: doc.source || 'manual',
    })
  })

  return resultMap
}

/**
 * List all "Coming Soon" items with optional pagination and filtering
 * @param {Object} options - Query options
 * @param {number} [options.page=0] - Page number
 * @param {number} [options.limit=50] - Items per page
 * @param {string} [options.mediaType] - Filter by media type
 * @param {string} [options.sortBy='setAt'] - Sort field
 * @param {string} [options.sortOrder='desc'] - Sort order
 * @returns {Promise<Object>} Paginated coming soon items
 */
export async function listAllComingSoon({
  page = 0,
  limit = 50,
  mediaType = null,
  sortBy = 'setAt',
  sortOrder = 'desc',
} = {}) {
  await ensureComingSoonIndexes()

  const client = await clientPromise
  const db = client.db('Media')
  const coll = db.collection('ComingSoon')

  const filter = {}
  if (mediaType) filter.mediaType = mediaType

  const safeLimit = Math.max(1, Math.min(100, parseInt(limit)))
  const safePage = Math.max(0, parseInt(page))

  // Build sort
  const sortObj = {}
  sortObj[sortBy] = sortOrder === 'asc' ? 1 : -1

  const [docs, total] = await Promise.all([
    coll
      .find(filter)
      .sort(sortObj)
      .skip(safePage * safeLimit)
      .limit(safeLimit)
      .toArray(),
    coll.countDocuments(filter),
  ])

  const items = docs.map((doc) => ({
    tmdbId: doc.tmdbId,
    mediaType: doc.mediaType,
    comingSoon: true,
    comingSoonDate: doc.comingSoonDate || null,
    notes: doc.notes || null,
    setBy: doc.setBy?.toString() || null,
    setByUsername: doc.setByUsername || null,
    setAt: doc.setAt,
    updatedAt: doc.updatedAt,
    lastChecked: doc.lastChecked || null,
    source: doc.source || 'manual',
  }))

  return {
    items,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      hasMore: safePage * safeLimit + items.length < total,
    },
  }
}

/**
 * Clean up "Coming Soon" entries for items that are now available in library
 * This is a maintenance function to remove stale coming soon entries
 * @returns {Promise<number>} Number of entries removed
 */
export async function cleanExpiredComingSoon() {
  await ensureComingSoonIndexes()

  const client = await clientPromise
  const db = client.db('Media')
  const comingSoonColl = db.collection('ComingSoon')

  // Get all coming soon items
  const comingSoonItems = await comingSoonColl.find({}).toArray()

  if (comingSoonItems.length === 0) {
    return 0
  }

  // Group by media type
  const movieTmdbIds = comingSoonItems
    .filter((item) => item.mediaType === 'movie')
    .map((item) => item.tmdbId)
  const tvTmdbIds = comingSoonItems
    .filter((item) => item.mediaType === 'tv')
    .map((item) => item.tmdbId)

  // Check which items now exist in library
  const [movieMatches, tvMatches] = await Promise.all([
    movieTmdbIds.length > 0
      ? db
          .collection('FlatMovies')
          .find({ 'metadata.id': { $in: movieTmdbIds } }, { projection: { 'metadata.id': 1 } })
          .toArray()
      : Promise.resolve([]),
    tvTmdbIds.length > 0
      ? db
          .collection('FlatTVShows')
          .find({ 'metadata.id': { $in: tvTmdbIds } }, { projection: { 'metadata.id': 1 } })
          .toArray()
      : Promise.resolve([]),
  ])

  // Get TMDB IDs that are now available
  const nowAvailableTmdbIds = [
    ...movieMatches.map((m) => m.metadata?.id).filter(Boolean),
    ...tvMatches.map((t) => t.metadata?.id).filter(Boolean),
  ]

  if (nowAvailableTmdbIds.length === 0) {
    return 0
  }

  // Remove coming soon entries for items that are now available
  const result = await comingSoonColl.deleteMany({
    tmdbId: { $in: nowAvailableTmdbIds },
  })

  return result.deletedCount || 0
}

/**
 * Get minimal card data for watchlist items optimized for horizontal list display
 * Fetches only essential fields needed for Card component - detailed data loaded on hover
 * @param {Array} watchlistItems - Watchlist items with mediaIds
 * @param {Object} [playlist=null] - Playlist object with sorting preferences
 * @param {boolean} [includeUnavailable=true] - Whether to include unavailable (TMDB-only) items
 * @returns {Promise<Array>} Minimal card data optimized for horizontal list performance
 */
export async function getMinimalCardDataForPlaylist(watchlistItems, playlist = null, includeUnavailable = true) {
  if (!watchlistItems || watchlistItems.length === 0) {
    return []
  }

  try {
    const client = await clientPromise
    const db = client.db('Media')

    // Group items by media type and extract TMDB IDs
    const movieTmdbIds = watchlistItems
      .filter((item) => item.mediaType === 'movie' && item.tmdbId)
      .map((item) => parseInt(item.tmdbId))
      .filter((id) => !isNaN(id))
    
    const tvTmdbIds = watchlistItems
      .filter((item) => item.mediaType === 'tv' && item.tmdbId)
      .map((item) => parseInt(item.tmdbId))
      .filter((id) => !isNaN(id))

    if (movieTmdbIds.length === 0 && tvTmdbIds.length === 0) {
      return []
    }

    // Minimal projection for card display - include PopupCard essentials for immediate backdrop display
    const minimalProjection = {
      _id: 1,
      title: 1,
      type: 1,
      posterURL: 1,
      posterBlurhash: 1,
      backdrop: 1,              // Essential for PopupCard immediate backdrop display
      backdropBlurhash: 1,      // Essential for PopupCard immediate backdrop display
      blurhash: 1,              // Contains backdrop blurhash structure
      link: 1,
      mediaLastModified: 1,
      'metadata.id': 1,
      'metadata.release_date': 1,
      'metadata.first_air_date': 1
    }

    const queries = []
    
    if (movieTmdbIds.length > 0) {
      queries.push(
        db
          .collection('FlatMovies')
          .find(
            { 'metadata.id': { $in: movieTmdbIds } },
            { projection: minimalProjection }
          )
          .toArray()
      )
    } else {
      queries.push(Promise.resolve([]))
    }
    
    if (tvTmdbIds.length > 0) {
      queries.push(
        db
          .collection('FlatTVShows')
          .find(
            { 'metadata.id': { $in: tvTmdbIds } },
            { projection: minimalProjection }
          )
          .toArray()
      )
    } else {
      queries.push(Promise.resolve([]))
    }

    const [movies, tvShows] = await Promise.all(queries)

    // Create a map of TMDB ID -> available media document for quick lookup
    const availableMediaMap = new Map()
    ;[...movies, ...tvShows].forEach((item) => {
      const tmdbId = item.metadata?.id
      if (tmdbId) {
        availableMediaMap.set(parseInt(tmdbId), item)
      }
    })

    // Bulk fetch "Coming Soon" status for all watchlist items
    const comingSoonMap = await bulkGetComingSoonStatus(
      watchlistItems.map((item) => ({
        tmdbId: parseInt(item.tmdbId),
        mediaType: item.mediaType,
      }))
    )

    // Process ALL watchlist items with minimal data
    let results = watchlistItems.map((watchlistItem) => {
      const tmdbId = parseInt(watchlistItem.tmdbId)
      const availableMedia = availableMediaMap.get(tmdbId)
      const comingSoonData = comingSoonMap.get(tmdbId)
      
      if (availableMedia) {
        // Item is available in library - return minimal media document
        // it pulls TV shows from the root object in FlatShows so we have to transform
        // the type field since it's named differently
        const derivedType = availableMedia.type === 'tvShow' ? 'tv' : availableMedia.type
        return {
          ...availableMedia,
          type: derivedType,
          id: availableMedia._id?.toString() || availableMedia.id,
          tmdbId: tmdbId,
          link: availableMedia.link || availableMedia.title || '',
          url: availableMedia.url || (availableMedia.link ? `/list/${derivedType === 'tv' ? 'tv' : 'movie'}/${availableMedia.link || availableMedia.title}` : null),
          // Availability flags
          isAvailable: true,
          comingSoon: comingSoonData?.comingSoon || false,
          comingSoonDate: comingSoonData?.comingSoonDate || null,
          // Preserve watchlist metadata
          watchlistId: watchlistItem._id?.toString() || watchlistItem.id,
          dateAdded: watchlistItem.dateAdded
        }
      } else if (includeUnavailable) {
        // Item is NOT in library - use existing watchlist data with minimal structure
        const title = watchlistItem.title || 'Unknown Title'
        const posterURL = watchlistItem.posterURL || '/sorry-image-not-available.jpg'
        const backdropURL = watchlistItem.backdrop || watchlistItem.backdropURL || null
        const releaseDate = watchlistItem.tmdbMetadata?.release_date || watchlistItem.tmdbMetadata?.first_air_date
        
        return {
          _id: watchlistItem._id?.toString() || watchlistItem.id,
          id: watchlistItem._id?.toString() || watchlistItem.id,
          tmdbId: tmdbId,
          type: watchlistItem.mediaType === 'tv' ? 'tv' : 'movie',
          mediaType: watchlistItem.mediaType,
          title: title,
          posterURL: posterURL,
          posterBlurhash: watchlistItem.posterBlurhash || null,
          // Include backdrop for PopupCard immediate display
          backdrop: backdropURL,
          backdropBlurhash: watchlistItem.backdropBlurhash || null,
          // Minimal metadata for card display - only essential fields
          metadata: {
            id: tmdbId,
            release_date: releaseDate,
            first_air_date: releaseDate
          },
          // Availability flags
          isAvailable: false,
          comingSoon: comingSoonData?.comingSoon || false,
          comingSoonDate: comingSoonData?.comingSoonDate || null,
          link: null,
          url: null,
          watchlistId: watchlistItem._id?.toString() || watchlistItem.id,
          dateAdded: watchlistItem.dateAdded,
          mediaLastModified: watchlistItem.dateAdded
        }
      } else {
        // includeUnavailable is false, skip this item
        return null
      }
    }).filter(Boolean) // Remove null entries

    // Apply playlist sorting if provided (same logic as original)
    if (playlist) {
      const sortBy = playlist.sortBy || 'dateAdded'
      const sortOrder = playlist.sortOrder || 'desc'

      if (sortBy === 'custom' && playlist.customOrder?.length > 0) {
        const orderMap = new Map(playlist.customOrder.map((id, index) => [id, index]))
        const tmdbToWatchlistId = new Map(
          watchlistItems.map(item => [parseInt(item.tmdbId), item._id?.toString() || item.id])
        )
        
        results.sort((a, b) => {
          const aTmdbId = a.metadata?.id || a.tmdbId
          const bTmdbId = b.metadata?.id || b.tmdbId
          const aWatchlistId = tmdbToWatchlistId.get(parseInt(aTmdbId))
          const bWatchlistId = tmdbToWatchlistId.get(parseInt(bTmdbId))
          const aOrder = aWatchlistId ? (orderMap.get(aWatchlistId) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER
          const bOrder = bWatchlistId ? (orderMap.get(bWatchlistId) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER
          return aOrder - bOrder
        })
      } else {
        // Apply standard sorting
        results.sort((a, b) => {
          let comparison = 0
          
          switch (sortBy) {
            case 'title':
              const titleA = (a.title || '').toLowerCase()
              const titleB = (b.title || '').toLowerCase()
              comparison = titleA.localeCompare(titleB)
              break
            case 'releaseDate':
              const aReleaseDate = a.metadata?.release_date || a.metadata?.first_air_date
              const bReleaseDate = b.metadata?.release_date || b.metadata?.first_air_date
              const dateA = aReleaseDate ? new Date(aReleaseDate) : new Date('9999-12-31')
              const dateB = bReleaseDate ? new Date(bReleaseDate) : new Date('9999-12-31')
              comparison = dateA - dateB
              break
            case 'dateAdded':
            default:
              const aTmdbId = a.metadata?.id || a.tmdbId
              const bTmdbId = b.metadata?.id || b.tmdbId
              const aWatchlistItem = watchlistItems.find(item => parseInt(item.tmdbId) === parseInt(aTmdbId))
              const bWatchlistItem = watchlistItems.find(item => parseInt(item.tmdbId) === parseInt(bTmdbId))
              const aDate = new Date(aWatchlistItem?.dateAdded || 0)
              const bDate = new Date(bWatchlistItem?.dateAdded || 0)
              comparison = aDate - bDate
              break
          }
          
          return sortOrder === 'asc' ? comparison : -comparison
        })
      }
    }

    if (process.env.DEBUG === 'true') {
      console.log(`[getMinimalCardDataForPlaylist] Returned ${results.length} minimal card items (${results.filter(r => r.isAvailable).length} available, ${results.filter(r => !r.isAvailable).length} TMDB-only)`)
    }

    return results
  } catch (error) {
    console.error('Error fetching minimal card data for playlist:', error)
    return []
  }
}

/**
 * Get full media documents for watchlist items from FlatMovies/FlatTVShows
 * This provides the same rich data structure as getFlatPosters for horizontal-list consistency
 * Supports both available (in library) and unavailable (TMDB-only) items
 * @param {Array} watchlistItems - Watchlist items with mediaIds
 * @param {boolean} [includeVideoData=false] - Whether to include videoURL and duration
 * @param {Object} [playlist=null] - Playlist object with sorting preferences
 * @param {boolean} [includeUnavailable=true] - Whether to include unavailable (TMDB-only) items
 * @returns {Promise<Array>} Full media documents with isAvailable and comingSoon flags
 */
export async function getFullMediaDocumentsForPlaylist(watchlistItems, includeVideoData = false, playlist = null, includeUnavailable = true) {
  if (!watchlistItems || watchlistItems.length === 0) {
    return []
  }

  try {
    const client = await clientPromise
    const db = client.db('Media')

    // Group items by media type and extract TMDB IDs
    // Query by TMDB ID (metadata.id) to dynamically reflect current library availability
    // This way, external items that get added to library later will automatically appear!
    const movieTmdbIds = watchlistItems
      .filter((item) => item.mediaType === 'movie' && item.tmdbId)
      .map((item) => parseInt(item.tmdbId))
      .filter((id) => !isNaN(id))
    
    const tvTmdbIds = watchlistItems
      .filter((item) => item.mediaType === 'tv' && item.tmdbId)
      .map((item) => parseInt(item.tmdbId))
      .filter((id) => !isNaN(id))

    if (movieTmdbIds.length === 0 && tvTmdbIds.length === 0) {
      return []
    }

    // Query both collections by TMDB ID (metadata.id)
    // This reflects CURRENT library availability, not stale mediaId/currentMediaId references
    const projection = includeVideoData ? { logo: 0 } : { videoURL: 0, duration: 0, logo: 0 }

    const queries = []
    
    if (movieTmdbIds.length > 0) {
      queries.push(
        db
          .collection('FlatMovies')
          .find(
            { 'metadata.id': { $in: movieTmdbIds } },
            { projection }
          )
          .toArray()
      )
    } else {
      queries.push(Promise.resolve([]))
    }
    
    if (tvTmdbIds.length > 0) {
      queries.push(
        db
          .collection('FlatTVShows')
          .find(
            { 'metadata.id': { $in: tvTmdbIds } },
            { projection }
          )
          .toArray()
      )
    } else {
      queries.push(Promise.resolve([]))
    }

    const [movies, tvShows] = await Promise.all(queries)

    // Create a map of TMDB ID -> available media document for quick lookup
    const availableMediaMap = new Map()
    ;[...movies, ...tvShows].forEach((item) => {
      const tmdbId = item.metadata?.id
      if (tmdbId) {
        availableMediaMap.set(parseInt(tmdbId), item)
      }
    })

    // Bulk fetch "Coming Soon" status for all watchlist items
    const comingSoonMap = await bulkGetComingSoonStatus(
      watchlistItems.map((item) => ({
        tmdbId: parseInt(item.tmdbId),
        mediaType: item.mediaType,
      }))
    )

    // For TMDB-only items, use simplified batchResolveMedia to get fresh data
    const tmdbOnlyItems = watchlistItems.filter(item => {
      const tmdbId = parseInt(item.tmdbId)
      return !availableMediaMap.has(tmdbId) // Not in library
    })
    
    let resolvedTmdbData = new Map()
    if (tmdbOnlyItems.length > 0) {
      console.log(`[getFullMediaDocumentsForPlaylist] Found ${tmdbOnlyItems.length} TMDB-only items, fetching fresh data`)
      
      try {
        resolvedTmdbData = await batchResolveMedia(
          tmdbOnlyItems.map((item) => ({
            tmdbId: parseInt(item.tmdbId),
            mediaType: item.mediaType,
          }))
        )
        
        console.log(`[getFullMediaDocumentsForPlaylist] Resolved ${resolvedTmdbData.size} items with fresh TMDB data`)
        
        // Log cast data for debugging
        if (resolvedTmdbData.size > 0) {
          const firstKey = resolvedTmdbData.keys().next().value
          const firstItem = resolvedTmdbData.get(firstKey)
          console.log(`[getFullMediaDocumentsForPlaylist] Sample resolved item cast data:`, {
            tmdbId: firstKey,
            title: firstItem?.title,
            castCount: firstItem?.tmdbMetadata?.cast?.length || 0,
            sampleCast: firstItem?.tmdbMetadata?.cast?.slice(0, 3)?.map(c => c.name) || []
          })
        }
      } catch (error) {
        console.error('[getFullMediaDocumentsForPlaylist] Error in batchResolveMedia:', error)
      }
    }

    // Process ALL watchlist items, marking availability and coming soon status
    let results = watchlistItems.map((watchlistItem) => {
      const tmdbId = parseInt(watchlistItem.tmdbId)
      const availableMedia = availableMediaMap.get(tmdbId)
      const comingSoonData = comingSoonMap.get(tmdbId)
      const resolvedTmdbMedia = resolvedTmdbData.get(tmdbId)
      
      if (availableMedia) {
        // Item is available in library - return full media document
        return {
          ...availableMedia,
          type: availableMedia.type || (availableMedia.mediaType === 'tv' ? 'tv' : 'movie'),
          id: availableMedia._id?.toString() || availableMedia.id,
          link: availableMedia.link || availableMedia.title || '',
          url: availableMedia.url || (availableMedia.link ? `/list/${availableMedia.type === 'tv' ? 'tv' : 'movie'}/${availableMedia.link || availableMedia.title}` : null),
          // Availability flags from global ComingSoon collection
          isAvailable: true,
          comingSoon: comingSoonData?.comingSoon || false,
          comingSoonDate: comingSoonData?.comingSoonDate || null,
          // Preserve watchlist metadata
          watchlistId: watchlistItem._id?.toString() || watchlistItem.id,
          dateAdded: watchlistItem.dateAdded
        }
      } else if (includeUnavailable) {
        // Item is NOT in library - use resolved TMDB data if available, otherwise fall back to cached data
        // Priority: resolvedTmdbMedia > enhanced watchlist item > cached data
        
        if (resolvedTmdbMedia) {
          // Use comprehensive data from batchResolveMedia (includes cast, budget, runtime, etc.)
          return {
            // Use resolved media data structure
            _id: watchlistItem._id?.toString() || watchlistItem.id,
            id: watchlistItem._id?.toString() || watchlistItem.id,
            tmdbId: tmdbId,
            type: watchlistItem.mediaType === 'tv' ? 'tv' : 'movie',
            mediaType: watchlistItem.mediaType,
            title: resolvedTmdbMedia.title,
            posterURL: resolvedTmdbMedia.posterURL,
            posterBlurhash: null,
            backdrop: resolvedTmdbMedia.backdropURL,
            backdropBlurhash: null,
            // Use comprehensive tmdbMetadata from resolved data - this includes cast!
            metadata: resolvedTmdbMedia.tmdbMetadata || {
              id: tmdbId,
              overview: resolvedTmdbMedia.overview || '',
              release_date: resolvedTmdbMedia.releaseDate,
              first_air_date: resolvedTmdbMedia.releaseDate,
              poster_path: resolvedTmdbMedia.posterURL?.includes('/w500/') ? ('/' + resolvedTmdbMedia.posterURL.split('/w500/')[1]) : null,
              backdrop_path: resolvedTmdbMedia.backdropURL?.includes('/original/') ? ('/' + resolvedTmdbMedia.backdropURL.split('/original/')[1]) : null,
              vote_average: resolvedTmdbMedia.voteAverage || 0,
              vote_count: 0,
              popularity: 0,
              genres: resolvedTmdbMedia.genres || [],
              // Include cast and other comprehensive data from resolved media
              cast: resolvedTmdbMedia.tmdbMetadata?.cast || [],
              trailer_url: resolvedTmdbMedia.tmdbMetadata?.trailer_url || null,
              logo_path: resolvedTmdbMedia.tmdbMetadata?.logo_path || null,
              rating: resolvedTmdbMedia.tmdbMetadata?.rating || null,
              budget: resolvedTmdbMedia.tmdbMetadata?.budget || null,
              revenue: resolvedTmdbMedia.tmdbMetadata?.revenue || null,
              runtime: resolvedTmdbMedia.tmdbMetadata?.runtime || null,
              production_companies: resolvedTmdbMedia.tmdbMetadata?.production_companies || [],
              production_countries: resolvedTmdbMedia.tmdbMetadata?.production_countries || [],
              spoken_languages: resolvedTmdbMedia.tmdbMetadata?.spoken_languages || [],
              belongs_to_collection: resolvedTmdbMedia.tmdbMetadata?.belongs_to_collection || null,
              number_of_seasons: resolvedTmdbMedia.tmdbMetadata?.number_of_seasons || null,
              number_of_episodes: resolvedTmdbMedia.tmdbMetadata?.number_of_episodes || null,
              episode_run_time: resolvedTmdbMedia.tmdbMetadata?.episode_run_time || [],
              networks: resolvedTmdbMedia.tmdbMetadata?.networks || [],
              origin_country: resolvedTmdbMedia.tmdbMetadata?.origin_country || [],
              status: resolvedTmdbMedia.tmdbMetadata?.status || null,
              adult: resolvedTmdbMedia.tmdbMetadata?.adult || false,
              tagline: resolvedTmdbMedia.tmdbMetadata?.tagline || null,
              original_title: resolvedTmdbMedia.tmdbMetadata?.original_title || null,
              original_language: resolvedTmdbMedia.tmdbMetadata?.original_language || null,
              homepage: resolvedTmdbMedia.tmdbMetadata?.homepage || null,
              video: resolvedTmdbMedia.tmdbMetadata?.video || false
            },
            // Availability flags
            isAvailable: false,
            comingSoon: comingSoonData?.comingSoon || false,
            comingSoonDate: comingSoonData?.comingSoonDate || null,
            link: null,
            url: null,
            watchlistId: watchlistItem._id?.toString() || watchlistItem.id,
            dateAdded: watchlistItem.dateAdded,
            mediaLastModified: watchlistItem.dateAdded
          }
        }
        
        // Fallback to existing watchlist item data (should have been resolved)
        // Use watchlist item properties directly
        const title = watchlistItem.title || 'Unknown Title'
        const posterURL = watchlistItem.posterURL || '/sorry-image-not-available.jpg'
        const overview = watchlistItem.overview || ''
        const releaseDate = watchlistItem.releaseDate || null
        const posterPath = watchlistItem.posterURL?.includes('image.tmdb.org')
          ? watchlistItem.posterURL.split('/w500')[1]
          : null
        const backdropPath = watchlistItem.backdrop?.includes('image.tmdb.org')
          ? watchlistItem.backdrop.split('/original')[1]
          : null
        const voteAverage = watchlistItem.voteAverage || 0
        const voteCount = watchlistItem.voteCount || 0
        const genres = watchlistItem.genres || []
        
        return {
          // Use watchlist item data
          _id: watchlistItem._id?.toString() || watchlistItem.id,
          id: watchlistItem._id?.toString() || watchlistItem.id,
          tmdbId: tmdbId,
          type: watchlistItem.mediaType === 'tv' ? 'tv' : 'movie',
          mediaType: watchlistItem.mediaType,
          title: title,
          // Provide posterURL directly (already full URL)
          posterURL: posterURL,
          posterBlurhash: watchlistItem.posterBlurhash || null, // Use blurhash if available
          backdrop: isEnhanced
            ? watchlistItem.backdrop
            : (backdropPath ? getFullImageUrl(backdropPath, 'original') : null),
          backdropBlurhash: watchlistItem.backdropBlurhash || null, // Use blurhash if available
          // Metadata in same structure as FlatMovies/FlatTVShows - include ALL cached TMDB fields
          metadata: {
            // Core identifiers
            id: tmdbId,
            imdb_id: watchlistItem.imdbId || null,
            
            // Basic info
            overview: overview,
            tagline: watchlistItem.tagline || null,
            original_title: watchlistItem.originalTitle || null,
            original_language: watchlistItem.originalLanguage || null,
            status: watchlistItem.status || null,
            
            // Dates
            release_date: releaseDate,
            first_air_date: releaseDate,
            
            // Media
            poster_path: posterPath,
            backdrop_path: backdropPath,
            
            // Ratings
            vote_average: voteAverage,
            vote_count: voteCount,
            popularity: watchlistItem.popularity || 0,
            
            // Classification
            genres: genres,
            
            // Production (movies)
            budget: watchlistItem.budget || null,
            revenue: watchlistItem.revenue || null,
            runtime: watchlistItem.runtime || null,
            production_companies: watchlistItem.productionCompanies || [],
            production_countries: watchlistItem.productionCountries || [],
            spoken_languages: watchlistItem.spokenLanguages || [],
            
            // TV-specific
            number_of_seasons: watchlistItem.numberOfSeasons || null,
            number_of_episodes: watchlistItem.numberOfEpisodes || null,
            episode_run_time: watchlistItem.episodeRunTime || [],
            networks: watchlistItem.networks || [],
            origin_country: watchlistItem.originCountry || [],
            
            // Links
            homepage: watchlistItem.homepage || null,
            
            // Create comprehensive tmdbMetadata structure for PopupCard compatibility
            tmdbMetadata: {
              // Core identifiers
              id: tmdbId,
              imdb_id: watchlistItem.imdbId || null,
              
              // Basic info
              title: title,
              original_title: watchlistItem.originalTitle || null,
              original_language: watchlistItem.originalLanguage || null,
              tagline: watchlistItem.tagline || null,
              overview: overview,
              
              // Dates
              release_date: releaseDate,
              first_air_date: releaseDate,
              
              // Media
              poster_path: posterPath,
              backdrop_path: backdropPath,
              
              // Ratings
              vote_average: voteAverage,
              vote_count: voteCount,
              popularity: watchlistItem.popularity || 0,
              
              // Classification
              genres: genres,
              status: watchlistItem.status || null,
              
              // Production (movies)
              budget: watchlistItem.budget || null,
              revenue: watchlistItem.revenue || null,
              runtime: watchlistItem.runtime || null,
              production_companies: watchlistItem.productionCompanies || [],
              production_countries: watchlistItem.productionCountries || [],
              spoken_languages: watchlistItem.spokenLanguages || [],
              
              // TV-specific
              number_of_seasons: watchlistItem.numberOfSeasons || null,
              number_of_episodes: watchlistItem.numberOfEpisodes || null,
              episode_run_time: watchlistItem.episodeRunTime || [],
              networks: watchlistItem.networks || [],
              origin_country: watchlistItem.originCountry || [],
              
              // Cast data
              cast: watchlistItem.tmdbMetadata?.cast || [],
              
              // Links
              homepage: watchlistItem.homepage || null,
              trailer_url: watchlistItem.trailerUrl || null,
              
              // Additional metadata
              video: false
            }
          },
          // Availability flags from global ComingSoon collection
          isAvailable: false,
          comingSoon: comingSoonData?.comingSoon || false,
          comingSoonDate: comingSoonData?.comingSoonDate || null,
          // No navigation link for unavailable items
          link: null,
          url: null,
          // Preserve watchlist metadata for watchlist UI
          watchlistId: watchlistItem._id?.toString() || watchlistItem.id,
          dateAdded: watchlistItem.dateAdded,
          // Add mediaLastModified to support date context
          mediaLastModified: watchlistItem.dateAdded
        }
      } else {
        // includeUnavailable is false, skip this item
        return null
      }
    }).filter(Boolean) // Remove null entries (unavailable items when includeUnavailable=false)

    // Apply playlist sorting if provided
    if (playlist) {
      const sortBy = playlist.sortBy || 'dateAdded'
      const sortOrder = playlist.sortOrder || 'desc'

      // For custom order, use the customOrder array from playlist
      if (sortBy === 'custom' && playlist.customOrder?.length > 0) {
        // Create a map of watchlist item IDs to their order index
        const orderMap = new Map(playlist.customOrder.map((id, index) => [id, index]))
        
        // Create a map of TMDB IDs to watchlist items to get their IDs
        const tmdbToWatchlistId = new Map(
          watchlistItems.map(item => [parseInt(item.tmdbId), item._id?.toString() || item.id])
        )
        
        // Sort results based on custom order
        results.sort((a, b) => {
          const aTmdbId = a.metadata?.id || a.tmdbId
          const bTmdbId = b.metadata?.id || b.tmdbId
          const aWatchlistId = tmdbToWatchlistId.get(parseInt(aTmdbId))
          const bWatchlistId = tmdbToWatchlistId.get(parseInt(bTmdbId))
          const aOrder = aWatchlistId ? (orderMap.get(aWatchlistId) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER
          const bOrder = bWatchlistId ? (orderMap.get(bWatchlistId) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER
          return aOrder - bOrder
        })
      } else {
        // Apply standard sorting
        results.sort((a, b) => {
          let comparison = 0
          
          switch (sortBy) {
            case 'title':
              const titleA = (a.title || '').toLowerCase()
              const titleB = (b.title || '').toLowerCase()
              comparison = titleA.localeCompare(titleB)
              break
            case 'releaseDate':
              // For items without release dates, use far-future date
              // This ensures they sort correctly based on context:
              // - desc (newest first): unreleased items appear at TOP (coming soon)
              // - asc (oldest first): unreleased items appear at BOTTOM
              const aReleaseDate = a.metadata?.release_date || a.metadata?.first_air_date
              const bReleaseDate = b.metadata?.release_date || b.metadata?.first_air_date
              const dateA = aReleaseDate ? new Date(aReleaseDate) : new Date('9999-12-31')
              const dateB = bReleaseDate ? new Date(bReleaseDate) : new Date('9999-12-31')
              comparison = dateA - dateB
              break
            case 'dateAdded':
            default:
              // For dateAdded, we need to match items back to watchlist items
              const aTmdbId = a.metadata?.id || a.tmdbId
              const bTmdbId = b.metadata?.id || b.tmdbId
              const aWatchlistItem = watchlistItems.find(item => parseInt(item.tmdbId) === parseInt(aTmdbId))
              const bWatchlistItem = watchlistItems.find(item => parseInt(item.tmdbId) === parseInt(bTmdbId))
              const aDate = new Date(aWatchlistItem?.dateAdded || 0)
              const bDate = new Date(bWatchlistItem?.dateAdded || 0)
              comparison = aDate - bDate
              break
          }
          
          // Apply sort order (asc or desc)
          return sortOrder === 'asc' ? comparison : -comparison
        })
      }
    }

    return results
  } catch (error) {
    console.error('Error fetching full media documents for playlist:', error)
    return []
  }
}
