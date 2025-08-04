'use server'

import clientPromise from '@src/lib/mongodb'
import { auth } from '@src/lib/auth'
import { ObjectId } from 'mongodb'
import { getFullImageUrl } from '@src/utils'

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
 * @returns {Promise<Array|number>} Watchlist items or count
 */
export async function getUserWatchlist({
  page = 0,
  limit = 20,
  mediaType,
  playlistId,
  countOnly = false,
  sortBy,
  sortOrder
} = {}) {
  const session = await auth()
  
  if (!session?.user?.id) {
    throw new Error('User not authenticated')
  }

  try {
    const client = await clientPromise
    const db = client.db('Media')
    const collection = db.collection('Watchlist')

    // Ensure user has a default playlist if playlistId is 'default' or not provided
    let actualPlaylistId = playlistId
    if (playlistId === 'default' || !playlistId) {
      const defaultPlaylist = await ensureDefaultPlaylist(session.user.id)
      actualPlaylistId = defaultPlaylist.id
    }

    // Build query filter
    const filter = { userId: new ObjectId(session.user.id) }
    
    if (mediaType) filter.mediaType = mediaType
    
    // Always filter by a specific playlist ID (no more null handling)
    if (actualPlaylistId) {
      filter.playlistId = new ObjectId(actualPlaylistId)
    }

    // Count only query
    if (countOnly) {
      return await collection.countDocuments(filter)
    }

    // Get playlist sorting preferences if not provided
    let finalSortBy = sortBy || 'dateAdded'
    let finalSortOrder = sortOrder || 'desc'
    let customOrder = []

    if (actualPlaylistId) {
      try {
        const playlistsCollection = db.collection('Playlists')
        const playlist = await playlistsCollection.findOne({
          _id: new ObjectId(actualPlaylistId)
        }, {
          projection: { sortBy: 1, sortOrder: 1, customOrder: 1 }
        })
        
        if (playlist) {
          finalSortBy = sortBy || playlist.sortBy || 'dateAdded'
          finalSortOrder = sortOrder || playlist.sortOrder || 'desc'
          customOrder = playlist.customOrder || []
        }
      } catch (error) {
        console.log('Error fetching playlist sort preferences:', error)
      }
    }

    // Build sort object
    const sortObj = {}
    if (finalSortBy === 'custom' && customOrder.length > 0) {
      // For custom sorting, we'll handle it after fetching
      sortObj.dateAdded = -1 // Fallback sort
    } else {
      sortObj[finalSortBy] = finalSortOrder === 'asc' ? 1 : -1
    }

    // Query with sorting
    const watchlistItems = await collection
      .find(filter)
      .sort(sortObj)
      .skip(page * limit)
      .limit(limit)
      .toArray()

    // Enhance items with deterministic hydration strategy
    const enhancedItems = await Promise.all(
      watchlistItems.map(async (item) => {
        // Try database-first approach with cascading fallback
        const mediaData = await getMediaDataWithFallback(item.mediaId, item.tmdbId, item.mediaType)
        
        if (mediaData) {
          // Found in database - use internal data
          return {
            ...item,
            id: item._id.toString(),
            ...mediaData,
            url: `/list/${item.mediaType}/${encodeURIComponent(mediaData.title)}`,
            link: encodeURIComponent(mediaData.title),
            isExternal: false
          }
        } else {
          // Not found in database - use TMDB fallback for display
          return {
            ...item,
            id: item._id.toString(),
            posterURL: item.posterURL || (item.posterPath ? getFullImageUrl(item.posterPath, 'w500') : '/sorry-image-not-available.jpg'),
            backdropURL: item.backdropPath ? getFullImageUrl(item.backdropPath, 'original') : null,
            url: null, // No internal URL for external media
            link: null,
            isExternal: true
          }
        }
      })
    )

    // Apply custom ordering if specified
    if (finalSortBy === 'custom' && customOrder.length > 0) {
      const orderMap = new Map(customOrder.map((id, index) => [id, index]))
      enhancedItems.sort((a, b) => {
        const aOrder = orderMap.get(a.id) ?? Number.MAX_SAFE_INTEGER
        const bOrder = orderMap.get(b.id) ?? Number.MAX_SAFE_INTEGER
        return aOrder - bOrder
      })
    }

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
  posterURL = null
}) {
  const session = await auth()
  
  if (!session?.user?.id) {
    throw new Error('User not authenticated')
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

    // Check if item already exists in this specific playlist
    // For internal media, check by mediaId first, then tmdbId as fallback
    // For external media, check by tmdbId
    let existingQuery = {
      userId: new ObjectId(session.user.id),
      playlistId: new ObjectId(actualPlaylistId)
    }

    if (mediaId) {
      // Primary check by mediaId for internal media
      if (isValidObjectId(mediaId)) {
        existingQuery.mediaId = new ObjectId(mediaId)
      } else {
        console.log(`Invalid mediaId format: ${mediaId}`)
        // Continue with tmdbId check if available
        if (tmdbId) {
          existingQuery.tmdbId = tmdbId
        } else {
          // No valid IDs to check against
          return null
        }
      }
    } else if (tmdbId) {
      // Fallback check by tmdbId for external media
      existingQuery.tmdbId = tmdbId
    }

    const existingItem = await collection.findOne(existingQuery)

    if (existingItem) {
      throw new Error('Item already exists in this playlist')
    }

    // Prepare watchlist item
    const watchlistItem = {
      userId: new ObjectId(session.user.id),
      mediaType,
      title,
      isExternal,
      playlistId: new ObjectId(actualPlaylistId),
      dateAdded: new Date()
    }

    // Add media-specific fields
    if (isExternal) {
      // External TMDB-only media
      watchlistItem.tmdbId = tmdbId
      watchlistItem.overview = tmdbData.overview
      watchlistItem.releaseDate = tmdbData.release_date || tmdbData.first_air_date
      watchlistItem.posterPath = tmdbData.poster_path
      watchlistItem.backdropPath = tmdbData.backdrop_path
      watchlistItem.genres = tmdbData.genres || []
      watchlistItem.originalLanguage = tmdbData.original_language
      watchlistItem.voteAverage = tmdbData.vote_average
      watchlistItem.voteCount = tmdbData.vote_count
      
      // Store posterURL directly for external media (from collection views for example)
      if (posterURL) {
        watchlistItem.posterURL = posterURL
      }
      
      // TV-specific fields
      if (mediaType === 'tv') {
        watchlistItem.numberOfSeasons = tmdbData.number_of_seasons
        watchlistItem.numberOfEpisodes = tmdbData.number_of_episodes
        watchlistItem.status = tmdbData.status
        watchlistItem.networks = tmdbData.networks || []
      }
    } else {
      // Internal library media - store both mediaId (primary) and tmdbId (fallback) when available
      if (isValidObjectId(mediaId)) {
        watchlistItem.mediaId = new ObjectId(mediaId)
      } else {
        console.log(`Invalid mediaId format for internal media: ${mediaId}, falling back to TMDB ID if available`)
        // If mediaId is invalid but we have tmdbId, treat as external
        if (!tmdbId) {
          throw new Error('Invalid mediaId format and no tmdbId provided for fallback')
        }
        watchlistItem.isExternal = true
      }
      
      // Also store tmdbId as fallback reference for resilience
      if (tmdbId) {
        watchlistItem.tmdbId = tmdbId
      }
      
      // Get release date from internal media for consistent sorting
      try {
        const mediaData = await getMediaDataWithFallback(mediaId, tmdbId, mediaType)
        if (mediaData && mediaData.releaseDate) {
          watchlistItem.releaseDate = mediaData.releaseDate
        }
      } catch (error) {
        console.log('Could not fetch release date for internal media:', error.message)
      }
    }

    // Insert the item
    const result = await collection.insertOne(watchlistItem)
    
    // Get the inserted item with proper ID
    const insertedItem = {
      ...watchlistItem,
      _id: result.insertedId,
      id: result.insertedId.toString()
    }
    
    // Enhance the item with the same hydration logic as getUserWatchlist
    const mediaData = await getMediaDataWithFallback(watchlistItem.mediaId?.toString(), watchlistItem.tmdbId, watchlistItem.mediaType)
    
    if (mediaData) {
      // Found in database - use internal data
      return {
        ...insertedItem,
        id: result.insertedId.toString(),
        userId: watchlistItem.userId.toString(),
        mediaId: watchlistItem.mediaId?.toString(),
        playlistId: watchlistItem.playlistId?.toString(),
        ...mediaData,
        url: `/list/${watchlistItem.mediaType}/${encodeURIComponent(mediaData.title)}`,
        link: encodeURIComponent(mediaData.title),
        isExternal: false
      }
    } else {
      // Not found in database - use TMDB fallback for display
      return {
        ...insertedItem,
        id: result.insertedId.toString(),
        userId: watchlistItem.userId.toString(),
        mediaId: watchlistItem.mediaId?.toString(),
        playlistId: watchlistItem.playlistId?.toString(),
        posterURL: watchlistItem.posterURL || (watchlistItem.posterPath ? getFullImageUrl(watchlistItem.posterPath, 'w500') : '/sorry-image-not-available.jpg'),
        backdropURL: watchlistItem.backdropPath ? getFullImageUrl(watchlistItem.backdropPath, 'original') : null,
        url: null, // No internal URL for external media
        link: null,
        isExternal: true
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
      userId: new ObjectId(session.user.id)
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

    const query = { userId: new ObjectId(session.user.id) }
    
    // Enhanced search logic: check by mediaId first (primary), then tmdbId (fallback)
    if (mediaId && tmdbId) {
      // If both IDs provided, use $or to find by either
      query.$or = [
        // Validate mediaId is a valid ObjectId format before creating ObjectId
        ...(isValidObjectId(mediaId) ? [{ mediaId: new ObjectId(mediaId) }] : []),
        { tmdbId: tmdbId }
      ]
    } else if (mediaId) {
      // Validate mediaId is a valid ObjectId format
      if (isValidObjectId(mediaId)) {
        query.mediaId = new ObjectId(mediaId)
      } else {
        // Invalid mediaId format, return null as it won't be found
        return null
      }
    } else if (tmdbId) {
      query.tmdbId = tmdbId
    } else {
      return null
    }

    // Always filter by specific playlist ID
    if (actualPlaylistId) {
      query.playlistId = new ObjectId(actualPlaylistId)
    }

    const item = await collection.findOne(query)
    
    if (!item) {
      return null
    }

    return {
      ...item,
      id: item._id.toString(),
      userId: item.userId.toString(),
      mediaId: item.mediaId?.toString(),
      playlistId: item.playlistId?.toString()
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
            $sum: { $cond: [{ $eq: ['$mediaType', 'movie'] }, 1, 0] }
          },
          tvCount: {
            $sum: { $cond: [{ $eq: ['$mediaType', 'tv'] }, 1, 0] }
          }
        }
      }
    ]

    const result = await collection.aggregate(pipeline).toArray()
    
    if (result.length === 0) {
      return {
        total: 0,
        movieCount: 0,
        tvCount: 0
      }
    }

    return result[0]
  } catch (error) {
    console.error('Error getting watchlist stats:', error)
    throw new Error('Failed to get watchlist statistics')
  }
}

/**
 * Get internal media data with cascading fallback strategy
 * 1. Try mediaId lookup (primary)
 * 2. Try tmdbId lookup via metadata.id (fallback)
 * 3. Return null if both fail (triggers TMDB API fallback)
 * @param {string} [mediaId] - Media ID
 * @param {number} [tmdbId] - TMDB ID
 * @param {string} mediaType - 'movie' or 'tv'
 * @returns {Promise<Object|null>} Media data with internal flag
 */
async function getMediaDataWithFallback(mediaId, tmdbId, mediaType) {
  try {
    const client = await clientPromise
    const db = client.db('Media')
    const collection = mediaType === 'movie' ? 'FlatMovies' : 'FlatTVShows'

    const projection = {
      _id: 1,
      title: 1,
      posterURL: 1,
      posterBlurhash: 1,
      backdrop: 1,
      backdropBlurhash: 1,
      'metadata.id': 1,
      'metadata.poster_path': 1,
      'metadata.backdrop_path': 1,
      'metadata.overview': 1,
      'metadata.release_date': 1,
      'metadata.first_air_date': 1,
      'metadata.genres': 1,
      'metadata.vote_average': 1
    }

    let media = null

    // Primary: Try mediaId lookup
    if (mediaId) {
      try {
        // Validate mediaId format before attempting to create ObjectId
        if (isValidObjectId(mediaId)) {
          media = await db.collection(collection).findOne(
            { _id: new ObjectId(mediaId) },
            { projection }
          )
        } else {
          console.log(`Invalid mediaId format: ${mediaId}`)
        }
      } catch (error) {
        console.log(`MediaId lookup failed for ${mediaId}:`, error.message)
      }
    }

    // Fallback: Try tmdbId lookup via metadata.id
    if (!media && tmdbId) {
      media = await db.collection(collection).findOne(
        { 'metadata.id': parseInt(tmdbId) },
        { projection }
      )
      
      if (media) {
        console.log(`Found media via TMDB ID fallback: ${media.title} (TMDB: ${tmdbId})`)
      }
    }

    if (!media) {
      return null
    }

    return {
      mediaId: media._id.toString(),
      title: media.title,
      posterURL: media.posterURL || (media.metadata?.poster_path ? getFullImageUrl(media.metadata.poster_path, 'w500') : '/sorry-image-not-available.jpg'),
      backdropURL: media.backdrop || (media.metadata?.backdrop_path ? getFullImageUrl(media.metadata.backdrop_path, 'original') : null),
      posterBlurhash: media.posterBlurhash,
      backdropBlurhash: media.backdropBlurhash,
      overview: media.metadata?.overview,
      releaseDate: media.metadata?.release_date || media.metadata?.first_air_date,
      genres: media.metadata?.genres || [],
      voteAverage: media.metadata?.vote_average,
      tmdbId: media.metadata?.id,
      isInternal: true
    }
  } catch (error) {
    console.error('Error fetching media data with fallback:', error)
    return null
  }
}

/**
 * Legacy function for backward compatibility
 * @deprecated Use getMediaDataWithFallback instead
 */
async function getInternalMediaData(mediaId, mediaType) {
  return getMediaDataWithFallback(mediaId, null, mediaType)
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
          userId: new ObjectId(session.user.id)
        },
        update: {
          $set: {
            ...itemUpdates,
            dateUpdated: new Date()
          }
        }
      }
    }))

    const result = await collection.bulkWrite(bulkOps)
    return {
      modifiedCount: result.modifiedCount,
      matchedCount: result.matchedCount
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
      _id: { $in: watchlistIds.map(id => new ObjectId(id)) },
      userId: new ObjectId(session.user.id)
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
    const itemsToMove = await collection.find({
      _id: { $in: itemIds.map(id => new ObjectId(id)) },
      userId: new ObjectId(session.user.id)
    }).toArray()

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
      // Use enhanced search logic to check by either mediaId or tmdbId
      let targetQuery = {
        userId: new ObjectId(session.user.id),
        playlistId: targetPlaylistObjectId
      }

      if (item.mediaId && item.tmdbId) {
        // If item has both IDs, check by either
        targetQuery.$or = [
          { mediaId: item.mediaId },
          { tmdbId: item.tmdbId }
        ]
      } else if (item.mediaId) {
        targetQuery.mediaId = item.mediaId
      } else if (item.tmdbId) {
        targetQuery.tmdbId = item.tmdbId
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
          dateUpdated: new Date()
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

    // Check if user already has a default playlist
    let defaultPlaylist = await collection.findOne({
      ownerId: new ObjectId(userId || session.user.id),
      isDefault: true
    })

    if (!defaultPlaylist) {
      // Create default playlist
      const playlistData = {
        name: 'My Watchlist',
        description: null,
        privacy: 'private',
        ownerId: new ObjectId(userId || session.user.id),
        isDefault: true,
        collaborators: [],
        dateCreated: new Date(),
        dateUpdated: new Date(),
        itemCount: 0,
        sortBy: 'dateAdded',
        sortOrder: 'desc',
        customOrder: []
      }

      const result = await collection.insertOne(playlistData)
      defaultPlaylist = {
        ...playlistData,
        _id: result.insertedId
      }
    }

    return {
      ...defaultPlaylist,
      id: defaultPlaylist._id.toString(),
      ownerId: defaultPlaylist.ownerId.toString()
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
export async function createPlaylist({ name, description = '', privacy = 'private', isDefault = false }) {
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
      customOrder: [] // Array of item IDs for manual ordering
    }

    const result = await collection.insertOne(playlist)
    
    return {
      ...playlist,
      id: result.insertedId.toString(),
      ownerId: playlist.ownerId.toString()
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
export async function getUserPlaylists({ includeShared = true } = {}) {
  const session = await auth()
  
  if (!session?.user?.id) {
    throw new Error('User not authenticated')
  }

  try {
    const client = await clientPromise
    const db = client.db('Media')
    const collection = db.collection('Playlists')

    const userId = new ObjectId(session.user.id)
    const filter = includeShared 
      ? {
          $or: [
            { ownerId: userId },
            { 'collaborators.userId': userId }
          ]
        }
      : { ownerId: userId }

    const playlists = await collection
      .find(filter)
      .sort({ dateUpdated: -1 })
      .toArray()

    // Get item counts for each playlist
    const watchlistCollection = db.collection('Watchlist')
    const playlistsWithCounts = await Promise.all(
      playlists.map(async (playlist) => {
        const itemCount = await watchlistCollection.countDocuments({
          userId,
          playlistId: playlist._id
        })

        return {
          ...playlist,
          id: playlist._id.toString(),
          ownerId: playlist.ownerId.toString(),
          itemCount,
          isOwner: playlist.ownerId.equals(userId),
          collaborators: playlist.collaborators.map(collab => ({
            ...collab,
            userId: collab.userId.toString()
          }))
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
          { 'collaborators.userId': new ObjectId(session.user.id), 'collaborators.permission': { $in: ['edit', 'admin'] } }
        ]
      },
      {
        $set: {
          ...updates,
          dateUpdated: new Date()
        }
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
    
    // Only owner can delete playlist
    const playlistResult = await db.collection('Playlists').deleteOne({
      _id: new ObjectId(playlistId),
      ownerId: new ObjectId(session.user.id)
    })

    if (playlistResult.deletedCount > 0) {
      // Move all items in this playlist to default (null playlist)
      await db.collection('Watchlist').updateMany(
        {
          userId: new ObjectId(session.user.id),
          playlistId: new ObjectId(playlistId)
        },
        {
          $set: {
            playlistId: null,
            dateUpdated: new Date()
          }
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
    
    // Get user IDs for the emails
    const userIds = await Promise.all(
      collaborators.map(async ({ email, permission }) => {
        const user = await db.collection('users').findOne({ email })
        return user ? {
          userId: user._id,
          email,
          permission,
          dateAdded: new Date()
        } : null
      })
    )

    const validCollaborators = userIds.filter(Boolean)

    const result = await db.collection('Playlists').updateOne(
      {
        _id: new ObjectId(playlistId),
        ownerId: new ObjectId(session.user.id)
      },
      {
        $addToSet: {
          collaborators: { $each: validCollaborators }
        },
        $set: {
          dateUpdated: new Date()
        }
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
          { 'collaborators.userId': new ObjectId(session.user.id), 'collaborators.permission': { $in: ['edit', 'admin'] } }
        ]
      },
      {
        $set: {
          sortBy,
          sortOrder,
          dateUpdated: new Date()
        }
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
          { 'collaborators.userId': new ObjectId(session.user.id), 'collaborators.permission': { $in: ['edit', 'admin'] } }
        ]
      },
      {
        $set: {
          customOrder: itemIds,
          sortBy: 'custom',
          dateUpdated: new Date()
        }
      }
    )

    return result.modifiedCount > 0
  } catch (error) {
    console.error('Error updating playlist custom order:', error)
    throw new Error('Failed to update playlist custom order')
  }
}
