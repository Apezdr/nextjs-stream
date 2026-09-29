'use server'

import { cache } from 'react'
import clientPromise from '@src/lib/mongodb'
import { ObjectId } from 'mongodb'
import { getFullImageUrl } from '@src/utils'
import { mediaLinkKey } from '@src/utils/media/urlParser'
import { batchResolveMedia, getMediaByTMDBId } from './mediaResolver.js'
import { asResolvedMedia, untitledLabel } from './tmdbMissing.js'
import {
  DETAILS_RESOLVED_AT,
  SORTS_NEEDING_DETAILS,
  sortDetailUpdates,
  watchlistOrderStages,
} from './listOrder.js'
import { planPlaylistMerge } from './playlistMerge.js'
import { ensurePlaylistVisibilityIndexes } from './playlistVisibilityIndexes.js'
import { getSession } from '@src/lib/cachedAuth.js'
import { userQueries } from '@src/lib/userQueries'
import { visibleMovieFilter, visibleShowFilter } from '@src/utils/mediaVisibility'

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

function stringifyCollaborators(collaborators = []) {
  return collaborators.map((collab) => ({
    ...collab,
    userId: collab.userId?.toString() || null,
  }))
}

function sanitizePlaylistDoc(playlist) {
  if (!playlist) return playlist

  const { _id, ownerId, collaborators, ...rest } = playlist
  return {
    ...rest,
    id: _id?.toString() || null,
    ownerId: ownerId?.toString() || null,
    collaborators: stringifyCollaborators(collaborators),
  }
}

function toObjectId(value) {
  if (!value) return null
  if (value instanceof ObjectId) return value
  if (typeof value === 'string' && isValidObjectId(value)) return new ObjectId(value)

  if (typeof value === 'object') {
    if (typeof value.$oid === 'string' && isValidObjectId(value.$oid)) {
      return new ObjectId(value.$oid)
    }

    if (typeof value.toHexString === 'function') {
      const hex = value.toHexString()
      if (isValidObjectId(hex)) return new ObjectId(hex)
    }

    if (typeof value.toString === 'function') {
      const stringValue = value.toString()
      if (isValidObjectId(stringValue)) return new ObjectId(stringValue)
    }
  }

  return null
}

function normalizePlaylistIdentityFields(playlist) {
  if (!playlist) return playlist

  const ownerId = toObjectId(playlist.ownerId)
  const collaborators = Array.isArray(playlist.collaborators)
    ? playlist.collaborators.map((collab) => ({
        ...collab,
        userId: toObjectId(collab?.userId),
      }))
    : []

  return {
    ...playlist,
    ownerId,
    collaborators,
  }
}

function getCollaboratorPermission(playlist, userObjectId) {
  return playlist.collaborators?.find((collab) => collab.userId?.equals(userObjectId))?.permission || null
}

function canCollaboratorAdd(permission) {
  return ['add', 'edit', 'admin'].includes(permission)
}

function canCollaboratorEdit(permission) {
  return ['edit', 'admin'].includes(permission)
}

function isAdminPermission(permission) {
  return permission === 'admin'
}

function getGlobalPermission(playlist) {
  const permission = playlist?.globalPermission
  return ['view', 'add', 'edit', 'admin'].includes(permission) ? permission : null
}

function isGlobalAdminUser(user) {
  if (!user) return false
  return (
    user.role === 'admin' ||
    user.role === 'Admin' ||
    (Array.isArray(user.permissions) && user.permissions.includes('Admin'))
  )
}

// Who may do what with a playlist. Each takes a playlist that has been through
// normalizePlaylistIdentityFields. View matches getPlaylistById's query; add
// and edit match the canAdd / canEdit that getUserPlaylists sends the client.
function canViewPlaylist(playlist, userObjectId, isGlobalAdmin) {
  return Boolean(
    playlist &&
      (isGlobalAdmin ||
        playlist.ownerId?.equals(userObjectId) ||
        getCollaboratorPermission(playlist, userObjectId) ||
        playlist.privacy === 'shared' ||
        playlist.privacy === 'public')
  )
}

function canAddToPlaylist(playlist, userObjectId, isGlobalAdmin) {
  return Boolean(
    playlist &&
      (isGlobalAdmin ||
        playlist.ownerId?.equals(userObjectId) ||
        canCollaboratorAdd(getCollaboratorPermission(playlist, userObjectId)) ||
        canCollaboratorAdd(getGlobalPermission(playlist)))
  )
}

function canEditPlaylist(playlist, userObjectId, isGlobalAdmin) {
  return Boolean(
    playlist &&
      (isGlobalAdmin ||
        playlist.ownerId?.equals(userObjectId) ||
        canCollaboratorEdit(getCollaboratorPermission(playlist, userObjectId)) ||
        canCollaboratorEdit(getGlobalPermission(playlist)))
  )
}

/**
 * Get a map of owner IDs to display names (name or email)
 * Simplified to use userQueries factory - no more manual database handling
 * @param {Array} ownerIds - Array of owner ID strings
 * @returns {Promise<Map>} Map of userId string -> display name
 */
async function getOwnerNameMap(ownerIds = []) {
  const validOwnerIds = ownerIds.filter((id) => isValidObjectId(id))
  if (validOwnerIds.length === 0) return new Map()

  const ownerObjectIds = validOwnerIds.map((id) => new ObjectId(id))

  // Single query using userQueries factory (handles all database logic internally)
  const ownerDocs = await userQueries.find(
    { _id: { $in: ownerObjectIds } },
    { _id: 1, name: 1, email: 1 }
  )

  return new Map(
    ownerDocs.map((owner) => [owner._id.toString(), owner.name || owner.email || null])
  )
}

/**
 * Database operations for watchlist functionality with playlist support
 * Supports both internal media (in library) and external media (TMDB only)
 */

/**
 * Cached helper: Check library availability for TMDB IDs
 * Returns Set of available TMDB IDs
 * @param {Array<number>} movieTmdbIds - Movie TMDB IDs to check
 * @param {Array<number>} tvTmdbIds - TV TMDB IDs to check
 * @returns {Promise<Set<number>>} Set of available TMDB IDs
 */
const checkLibraryAvailability = cache(async (movieTmdbIds, tvTmdbIds) => {
  const client = await clientPromise
  const db = client.db('Media')
  
  // "Available" means in the library AND web-visible — hidden titles degrade
  // to the external/unavailable card (must agree with every availability site)
  const [movieMatches, tvMatches] = await Promise.all([
    movieTmdbIds.length > 0
      ? db.collection('FlatMovies').find(
          { $and: [{ 'metadata.id': { $in: movieTmdbIds } }, visibleMovieFilter()] },
          { projection: { 'metadata.id': 1 } }
        ).toArray()
      : Promise.resolve([]),
    tvTmdbIds.length > 0
      ? db.collection('FlatTVShows').find(
          { $and: [{ 'metadata.id': { $in: tvTmdbIds } }, visibleShowFilter()] },
          { projection: { 'metadata.id': 1 } }
        ).toArray()
      : Promise.resolve([])
  ])

  return new Set([
    ...movieMatches.map(m => m.metadata?.id).filter(Boolean),
    ...tvMatches.map(t => t.metadata?.id).filter(Boolean)
  ])
})

/**
 * Cached helper: Get playlist metadata
 * @param {string} playlistId - Playlist ID
 * @returns {Promise<Object|null>} Playlist metadata
 */
const getPlaylistMetadata = cache(async (playlistId) => {
  const client = await clientPromise
  const db = client.db('Media')
  const playlistsCollection = db.collection('Playlists')
  
  return await playlistsCollection.findOne(
    { _id: new ObjectId(playlistId) },
    { projection: { sortBy: 1, sortOrder: 1, customOrder: 1 } }
  )
})

/**
 * Get user's watchlist with pagination and filtering
 * @param {Object} options - Query options
 * @param {number} [options.page=0] - Page number (0-based)
 * @param {number} [options.limit=20] - Items per page
 * @param {string} [options.mediaType] - Filter by media type ('movie', 'tv')
 * @param {string} [options.playlistId] - Filter by playlist ID
 * @param {boolean} [options.countOnly=false] - Return only count
 * @param {boolean} [options.internalOnly=false] - Only count/return items currently in library (uses TMDB ID lookup)
 * @param {string} [options.userId] - Optional user ID to skip auth() call
 * @returns {Promise<Array|number>} Watchlist items or count
 */
// The app creates the Watchlist collection's indexes itself, on first use, the
// way the sync repositories create theirs (BaseRepository.createIndexes): each
// build is idempotent and retried on transient drops, and success is cached
// only once every index exists, so a failed build is re-attempted rather than
// forgotten until the next restart.
const WATCHLIST_INDEXES = [
  // Serves the hot find({ playlistId }).sort({ dateAdded }) read.
  { key: { playlistId: 1, dateAdded: -1 }, options: { name: 'by_playlist_dateAdded' } },
  // One copy of a title per playlist, whoever added it. TMDB ids repeat across
  // media types, so mediaType is part of the key. Adds, moves and playlist
  // merges rely on it to turn a second copy into E11000. Items without a TMDB
  // id have no title to be unique on, so the index leaves them out.
  {
    key: { playlistId: 1, mediaType: 1, tmdbId: 1 },
    options: {
      name: 'unique_playlist_title',
      unique: true,
      partialFilterExpression: { tmdbId: { $exists: true } },
    },
  },
]

// Every watchlist read comes through ensureWatchlistIndexes, so after a failed
// attempt it waits before trying again rather than paying a failing build on
// each request. The unique build fails for as long as the collection holds a
// duplicate title, and succeeds on the first attempt after it is removed.
const WATCHLIST_INDEX_RETRY_MS = 5 * 60 * 1000
let watchlistIndexesEnsured = false
let watchlistIndexesInFlight = null
let watchlistIndexRetryAt = 0

// Same test as BaseRepository.createIndexSafely: a dropped connection, a
// cleared pool, or a write carrying a retryable label.
function isTransientMongoError(error) {
  if (!error) return false
  if (
    typeof error.hasErrorLabel === 'function' &&
    (error.hasErrorLabel('TransientTransactionError') || error.hasErrorLabel('RetryableWriteError'))
  ) {
    return true
  }
  return /connection .* closed|ECONNRESET|socket hang up|socket|network|pool (was )?(cleared|closed)|server is closed|MongoNetworkError/i.test(
    error.message || ''
  )
}

// Mirrors BaseRepository.createIndexSafely: an index that already exists is not
// an error, and a build dropped by a transient connection close is retried.
async function createIndexSafely(collection, key, options) {
  for (let attempt = 1; ; attempt++) {
    try {
      await collection.createIndex(key, options)
      return
    } catch (error) {
      // Same keys or name under other options. Left as is, but said out loud:
      // a non-unique twin would mean duplicates are not being refused.
      if (error?.code === 85 || error?.code === 86) {
        console.warn(`[Watchlist] Index ${options?.name} exists with other options; left as is:`, error.message)
        return
      }
      if (attempt < 4 && isTransientMongoError(error)) {
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt))
        continue
      }
      throw error
    }
  }
}

// Never throws: a failure is logged and scheduled for a retry.
async function buildWatchlistIndexes() {
  try {
    const client = await clientPromise
    const collection = client.db('Media').collection('Watchlist')
    const results = await Promise.allSettled(
      WATCHLIST_INDEXES.map(({ key, options }) => createIndexSafely(collection, key, options))
    )
    const failures = results.flatMap((result, i) =>
      result.status === 'rejected' ? [{ name: WATCHLIST_INDEXES[i].options.name, error: result.reason }] : []
    )
    if (failures.length === 0) {
      watchlistIndexesEnsured = true
      return
    }
    watchlistIndexRetryAt = Date.now() + WATCHLIST_INDEX_RETRY_MS
    for (const { name, error } of failures) {
      const hint = error?.code === 11000
        ? ' The collection holds a duplicate title; the build succeeds once it is removed.'
        : ''
      console.error(`[Watchlist] Index ${name} not created, retrying in 5 minutes.${hint}`, error?.message || error)
    }
  } catch (error) {
    watchlistIndexRetryAt = Date.now() + WATCHLIST_INDEX_RETRY_MS
    console.error('[Watchlist] Index creation failed, retrying in 5 minutes:', error?.message || error)
  }
}

async function ensureWatchlistIndexes() {
  if (watchlistIndexesEnsured || Date.now() < watchlistIndexRetryAt) return
  // Concurrent callers share one attempt
  if (!watchlistIndexesInFlight) {
    watchlistIndexesInFlight = buildWatchlistIndexes().finally(() => {
      watchlistIndexesInFlight = null
    })
  }
  await watchlistIndexesInFlight
}

// Writes what items resolved to into their stored details (listOrder.js).
// Never throws: stale details only cost sort order, never the read.
async function storeSortDetails(collection, items, resolvedMedia) {
  const updates = sortDetailUpdates(items, resolvedMedia)
  if (updates.length === 0) return
  try {
    await collection.bulkWrite(updates, { ordered: false })
  } catch (error) {
    console.error('[Watchlist] Failed to store sort details:', error?.message || error)
  }
}

// Looks up the items matching `filter` that have never had their details
// resolved, so the database can sort them by title or release date. Each item
// needs this once: new ones are resolved when added, and a lookup that fails
// is tried again on the next load.
async function backfillSortDetails(collection, filter) {
  const unresolved = await collection
    .find(
      { ...filter, [DETAILS_RESOLVED_AT]: { $exists: false } },
      { projection: { tmdbId: 1, mediaType: 1, title: 1, releaseDate: 1 } }
    )
    .toArray()
  if (unresolved.length === 0) return

  const resolvedMedia = await batchResolveMedia(
    unresolved.map((item) => ({ tmdbId: item.tmdbId, mediaType: item.mediaType }))
  )
  await storeSortDetails(collection, unresolved, resolvedMedia)
}

export const getUserWatchlist = cache(async function getUserWatchlist({
  page = 0,
  limit = 20,
  offset = null,
  mediaType,
  playlistId,
  countOnly = false,
  sortBy,
  sortOrder,
  internalOnly = false,
  userId = null,
} = {}) {
  let userObjectId
  
  if (userId) {
    // Use provided user ID (for cached components)
    userObjectId = userId
  } else {
    // Fall back to getSession() for backward compatibility
    const session = await getSession()
    if (!session?.user?.id) {
      throw new Error('User not authenticated')
    }
    userObjectId = session.user.id
  }

  // Diagnostic logging to track cache effectiveness
  const callId = Math.random().toString(36).substring(7)
  console.log(`[getUserWatchlist ENTRY] callId=${callId}, playlistId=${playlistId || 'default'}, page=${page}, limit=${limit}, mediaType=${mediaType || 'all'}, internalOnly=${internalOnly}`)

  try {
    await ensureWatchlistIndexes()

    const client = await clientPromise
    const db = client.db('Media')
    const collection = db.collection('Watchlist')
    const playlistsCollection = db.collection('Playlists')

    // Ensure valid playlist ID
    let actualPlaylistId = playlistId
    if (playlistId === 'default' || !playlistId) {
      const defaultPlaylist = await ensureDefaultPlaylist(userObjectId)
      actualPlaylistId = defaultPlaylist.id
    }

    // Build query
    const filter = {
      playlistId: new ObjectId(actualPlaylistId),
    }

    if (mediaType) filter.mediaType = mediaType

    // Declared out here because batchResolveMedia reads it below. Declared
    // inside the block, it threw a ReferenceError for any internalOnly list
    // with something to show.
    let availableTmdbIds = null

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
      
      // Check which TMDB IDs exist in library AND are web-visible
      // (must agree with checkLibraryAvailability or items oscillate)
      const [movieMatches, tvMatches] = await Promise.all([
        movieTmdbIds.length > 0
          ? db.collection('FlatMovies').find(
              { $and: [{ 'metadata.id': { $in: movieTmdbIds } }, visibleMovieFilter()] },
              { projection: { 'metadata.id': 1 } }
            ).toArray()
          : Promise.resolve([]),
        tvTmdbIds.length > 0
          ? db.collection('FlatTVShows').find(
              { $and: [{ 'metadata.id': { $in: tvTmdbIds } }, visibleShowFilter()] },
              { projection: { 'metadata.id': 1 } }
            ).toArray()
          : Promise.resolve([])
      ])
      
      // Get available TMDB IDs
      availableTmdbIds = new Set([
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

    // The database sorts the whole playlist, then pages it (listOrder.js).
    // Title and release-date order read details stored on each item; items
    // saved before they were stored get them here, the first time it matters.
    if (SORTS_NEEDING_DETAILS.has(finalSortBy)) {
      await backfillSortDetails(collection, filter)
    }

    const { stages, collation } = watchlistOrderStages({
      sortBy: finalSortBy,
      sortOrder: finalSortOrder,
      customOrder: playlist?.customOrder,
    })

    // Absolute offset overrides page-based skip for windowed fetches
    const watchlistItems = await collection
      .aggregate(
        [{ $match: filter }, ...stages, { $skip: offset ?? page * limit }, { $limit: limit }],
        collation ? { collation } : {}
      )
      .toArray()

    if (watchlistItems.length === 0) {
      return []
    }

    // Batch resolve media data
    const itemsToResolve = watchlistItems.map((item) => ({
      tmdbId: item.tmdbId,
      mediaType: item.mediaType,
    }))

    // Resolve media data in batch - pass pre-computed availability to eliminate duplicate queries
    const resolvedMedia = await batchResolveMedia(itemsToResolve, {
      precomputedAvailability: internalOnly ? availableTmdbIds : null
    })

    // Combine watchlist items with resolved media data
    const enhancedItems = watchlistItems.map((item) => {
      const resolved = resolvedMedia.get(parseInt(item.tmdbId))
      const mediaData = asResolvedMedia(resolved)

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
      } else if (!internalOnly) {
        // When not filtering to internal-only, preserve unresolved items
        // so getMinimalCardDataForPlaylist can handle them with its includeUnavailable logic
        return {
          id: item._id.toString(),
          watchlistId: item._id.toString(),
          userId: item.userId.toString(),
          playlistId: item.playlistId.toString(),
          tmdbId: parseInt(item.tmdbId),
          mediaType: item.mediaType,
          title: item.title || untitledLabel(resolved),
          tmdbNotFound: resolved?.tmdbNotFound || undefined,
          dateAdded: item.dateAdded,
          notes: item.notes,
          rating: item.rating,
          isAvailable: false,  // Explicitly mark as unavailable
          // Preserve any cached poster/backdrop data stored on the watchlist item
          posterURL: item.posterURL || null,
          posterBlurhash: item.posterBlurhash || null,
          backdrop: item.backdrop || null,
          backdropBlurhash: item.backdropBlurhash || null,
        }
      } else {
        // internalOnly mode — drop unavailable items as intended
        return null
      }
    }).filter(Boolean) // Remove null entries

    // The database's order stands; re-sorting a page here would disagree with
    // the pages either side of it. What the items resolved to refreshes their
    // stored details, so a renamed title moves on the next load.
    await storeSortDetails(collection, watchlistItems, resolvedMedia)

    console.log(`[getUserWatchlist EXIT] callId=${callId}, returned ${enhancedItems.length} items for playlistId=${actualPlaylistId}`)
    return enhancedItems
  } catch (error) {
    console.error('Error fetching user watchlist:', error)
    throw new Error('Failed to fetch watchlist')
  }
})

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
  const session = await getSession()

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
    const playlistsCollection = db.collection('Playlists')
    const userObjectId = new ObjectId(session.user.id)
    const isGlobalAdmin = isGlobalAdminUser(session?.user)

    // Ensure valid playlist ID
    let actualPlaylistId = playlistId
    if (!playlistId || playlistId === 'default') {
      const defaultPlaylist = await ensureDefaultPlaylist(session.user.id)
      actualPlaylistId = defaultPlaylist.id
    } else {
      const playlistRaw = await playlistsCollection.findOne({ _id: new ObjectId(actualPlaylistId) })
      const playlist = normalizePlaylistIdentityFields(playlistRaw)

      if (!playlist) {
        throw new Error('Playlist not found')
      }

      if (!canAddToPlaylist(playlist, userObjectId, isGlobalAdmin)) {
        throw new Error('Insufficient permission to add items to this playlist')
      }
    }

    await ensureWatchlistIndexes()

    const playlistObjectId = new ObjectId(actualPlaylistId)
    const numericTmdbId = parseInt(tmdbId)
    const now = new Date()

    // Minimal watchlist entry; the playlist, TMDB ID and media type come from
    // the upsert filter below
    const watchlistItem = {
      userId: userObjectId,
      dateAdded: now,
      dateUpdated: now,
    }

    // The title the request carried, until the lookup below stores the one the
    // title resolves to: title sorting reads it (listOrder.js)
    if (typeof title === 'string' && title.trim()) watchlistItem.title = title.trim()

    // Add optional user metadata
    if (notes) watchlistItem.notes = notes
    if (rating) watchlistItem.rating = rating

    // If we have a valid mediaId, store it as a reference to internal media
    if (isValidObjectId(mediaId)) {
      watchlistItem.mediaId = new ObjectId(mediaId)
    }

    // Insert only if the playlist doesn't hold this title yet, in one atomic
    // step. A check followed by a separate insert let a retry through while the
    // first request was still busy, and the playlist got the title twice. The
    // title belongs to the playlist, not to whoever added it, so the filter has
    // no userId. When two upserts race, unique_playlist_title stops the second.
    let upsertResult
    try {
      upsertResult = await collection.updateOne(
        { playlistId: playlistObjectId, mediaType, tmdbId: numericTmdbId },
        { $setOnInsert: watchlistItem },
        { upsert: true }
      )
    } catch (error) {
      if (error?.code === 11000) {
        throw new Error('Item already exists in this playlist')
      }
      throw error
    }

    if (!upsertResult.upsertedId) {
      throw new Error('Item already exists in this playlist')
    }

    const insertedId = upsertResult.upsertedId.toString()

    // Media data is only for the response, so it is fetched after the write:
    // the lookup can be slow, and the item must not wait on it. A failed lookup
    // falls back to what the request carried; the item is already saved.
    let mediaData = null
    try {
      const resolvedMedia = await batchResolveMedia([{ tmdbId: numericTmdbId, mediaType }])
      mediaData = asResolvedMedia(resolvedMedia.get(numericTmdbId))
      await storeSortDetails(
        collection,
        [{ _id: upsertResult.upsertedId, tmdbId: numericTmdbId, mediaType, title: watchlistItem.title }],
        resolvedMedia
      )
    } catch (error) {
      console.error('[Watchlist] Media lookup failed after adding an item:', error?.message || error)
    }

    if (mediaData) {
      return {
        id: insertedId,
        watchlistId: insertedId,
        userId: userObjectId.toString(),
        playlistId: playlistObjectId.toString(),
        dateAdded: now,
        notes: watchlistItem.notes,
        rating: watchlistItem.rating,
        ...mediaData,
      }
    } else {
      // Fallback if media resolution failed
      return {
        id: insertedId,
        watchlistId: insertedId,
        userId: userObjectId.toString(),
        playlistId: playlistObjectId.toString(),
        tmdbId: numericTmdbId,
        mediaType,
        title: title || 'Unknown Title',
        posterURL: posterURL || '/sorry-image-not-available.jpg',
        dateAdded: now,
        notes: watchlistItem.notes,
        rating: watchlistItem.rating,
        isInternal: false,
        isExternal: true,
      }
    }
  } catch (error) {
    console.error('Error adding to watchlist:', error)
    if (
      error.message === 'Item already exists in this playlist' ||
      error.message === 'Playlist not found' ||
      error.message === 'Insufficient permission to add items to this playlist'
    ) {
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
  const session = await getSession()

  if (!session?.user?.id) {
    throw new Error('User not authenticated')
  }

  try {
    const client = await clientPromise
    const deletedCount = await deleteRemovableItems(client.db('Media'), [new ObjectId(watchlistId)], session.user)
    return deletedCount > 0
  } catch (error) {
    console.error('Error removing from watchlist:', error)
    throw new Error('Failed to remove item from watchlist')
  }
}

/**
 * The items among `itemObjectIds` that `user` may take out of their playlist:
 * the ones they added, and any in a playlist they can edit (owner, editors,
 * global admins; the watchlist page offers Remove and Move on those terms).
 * It used to be only the person who added an item, so a playlist's owner could
 * not remove what an admin or collaborator had put in it.
 * @returns {Promise<Array<Object>>} Full item documents
 */
async function findRemovableItems(db, itemObjectIds, user) {
  const userObjectId = new ObjectId(user.id)
  const items = await db.collection('Watchlist').find({ _id: { $in: itemObjectIds } }).toArray()

  const otherAddersPlaylistIds = [
    ...new Set(
      items
        .filter((item) => !item.userId?.equals(userObjectId))
        .map((item) => item.playlistId?.toString())
        .filter(Boolean)
    ),
  ]
  if (otherAddersPlaylistIds.length === 0) return items

  const isGlobalAdmin = isGlobalAdminUser(user)
  const playlists = await db
    .collection('Playlists')
    .find({ _id: { $in: otherAddersPlaylistIds.map((id) => new ObjectId(id)) } })
    .toArray()
  const editablePlaylistIds = new Set(
    playlists
      .map(normalizePlaylistIdentityFields)
      .filter((playlist) => canEditPlaylist(playlist, userObjectId, isGlobalAdmin))
      .map((playlist) => playlist._id.toString())
  )

  return items.filter(
    (item) => item.userId?.equals(userObjectId) || editablePlaylistIds.has(item.playlistId?.toString())
  )
}

/**
 * Delete the items among `itemObjectIds` that `user` may remove (findRemovableItems).
 * @returns {Promise<number>} How many were deleted
 */
async function deleteRemovableItems(db, itemObjectIds, user) {
  const removable = await findRemovableItems(db, itemObjectIds, user)
  if (removable.length === 0) return 0
  const result = await db.collection('Watchlist').deleteMany({ _id: { $in: removable.map((item) => item._id) } })
  return result.deletedCount
}

/**
 * Check if item exists in user's watchlist
 * @param {string} [mediaId] - Internal media ID
 * @param {number} [tmdbId] - TMDB ID
 * @param {string} [playlistId] - Specific playlist to check (optional)
 * @returns {Promise<Object|null>} Watchlist item if exists, null otherwise
 */
export const checkWatchlistStatus = cache(async function checkWatchlistStatus(
  mediaId = null,
  tmdbId = null,
  playlistId = null,
  mediaType = null
) {
  const session = await getSession()

  if (!session?.user?.id) {
    return null
  }

  try {
    const client = await clientPromise
    const db = client.db('Media')
    const collection = db.collection('Watchlist')
    const userObjectId = new ObjectId(session.user.id)

    // Ensure we have a valid playlist ID
    let actualPlaylistId = playlistId
    if (!playlistId || playlistId === 'default') {
      const defaultPlaylist = await ensureDefaultPlaylist(session.user.id)
      actualPlaylistId = defaultPlaylist.id
    } else {
      // The answer now covers everyone's additions, so give it only for a
      // playlist the caller can see
      const playlist = normalizePlaylistIdentityFields(
        await db.collection('Playlists').findOne({ _id: new ObjectId(playlistId) })
      )
      if (!canViewPlaylist(playlist, userObjectId, isGlobalAdminUser(session.user))) {
        return null
      }
    }

    // A playlist holds a title whoever added it, so no userId filter. With one,
    // a title an admin had added to your list showed as missing, and adding it
    // "again" made a second copy.
    const query = {
      playlistId: new ObjectId(actualPlaylistId),
    }

    // Prioritize TMDB ID as primary key, fall back to mediaId if needed
    if (tmdbId) {
      query.tmdbId = parseInt(tmdbId)
      // TMDB ids repeat across media types; narrow when the caller says which
      if (mediaType === 'movie' || mediaType === 'tv') {
        query.mediaType = mediaType
      }
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
})

/**
 * Get simple watchlist statistics for user
 * @returns {Promise<Object>} Watchlist statistics
 */
export async function getWatchlistStats() {
  const session = await getSession()

  if (!session?.user?.id) {
    throw new Error('User not authenticated')
  }

  try {
    const client = await clientPromise
    const db = client.db('Media')
    const collection = db.collection('Watchlist')
    const userObjectId = new ObjectId(session.user.id)

    const pipeline = [
      { $match: { userId: userObjectId } },
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
  const session = await getSession()

  if (!session?.user?.id) {
    throw new Error('User not authenticated')
  }

  try {
    const client = await clientPromise
    const db = client.db('Media')
    const collection = db.collection('Watchlist')
    const userObjectId = new ObjectId(session.user.id)

    const bulkOps = updates.map(({ id, updates: itemUpdates }) => ({
      updateOne: {
        filter: {
          _id: new ObjectId(id),
          userId: userObjectId,
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
  const session = await getSession()

  if (!session?.user?.id) {
    throw new Error('User not authenticated')
  }

  try {
    const client = await clientPromise
    return await deleteRemovableItems(
      client.db('Media'),
      watchlistIds.map((id) => new ObjectId(id)),
      session.user
    )
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
  const session = await getSession()

  if (!session?.user?.id) {
    throw new Error('User not authenticated')
  }

  try {
    const client = await clientPromise
    const db = client.db('Media')
    const collection = db.collection('Watchlist')
    const userObjectId = new ObjectId(session.user.id)

    // Ensure we have a valid target playlist ID
    let actualTargetPlaylistId = targetPlaylistId
    if (!targetPlaylistId || targetPlaylistId === 'default') {
      const defaultPlaylist = await ensureDefaultPlaylist(session.user.id)
      actualTargetPlaylistId = defaultPlaylist.id
    } else {
      // Same rule as adding to it. The target used to go unchecked, so items
      // could be moved into any playlist whose id was known.
      const target = normalizePlaylistIdentityFields(
        await db.collection('Playlists').findOne({ _id: new ObjectId(targetPlaylistId) })
      )
      if (!target) {
        throw new Error('Playlist not found')
      }
      if (!canAddToPlaylist(target, userObjectId, isGlobalAdminUser(session.user))) {
        throw new Error('Insufficient permission to add items to this playlist')
      }
    }
    const targetPlaylistObjectId = new ObjectId(actualTargetPlaylistId)

    // Items the caller may take out of their current playlist, minus any
    // already in the target
    const itemsToMove = (
      await findRemovableItems(db, itemIds.map((id) => new ObjectId(id)), session.user)
    ).filter((item) => !item.playlistId?.equals(targetPlaylistObjectId))

    if (itemsToMove.length === 0) {
      return 0
    }

    // A title the target already holds leaves its old playlist without being
    // moved in as a second copy; moved items count as added now
    return await mergeItemsIntoPlaylist(
      collection,
      { _id: { $in: itemsToMove.map((item) => item._id) } },
      targetPlaylistObjectId,
      { stampDateAdded: true }
    )
  } catch (error) {
    console.error('Error moving items to playlist:', error)
    if (
      error.message === 'Playlist not found' ||
      error.message === 'Insufficient permission to add items to this playlist'
    ) {
      throw error
    }
    throw new Error('Failed to move items to playlist')
  }
}

/**
 * Move the items matching `filter` into another playlist without giving it a
 * second copy of any title: a title the target already holds, or a repeat among
 * the items themselves, is deleted instead of moved (planPlaylistMerge; the
 * earliest-added copy is the one kept). Moving items, deleting a playlist and
 * merging duplicate default playlists all use it; each used to repoint items
 * with no duplicate check.
 * @returns {Promise<number>} How many items were moved or dropped
 */
async function mergeItemsIntoPlaylist(collection, filter, targetPlaylistId, { stampDateAdded = false } = {}) {
  await ensureWatchlistIndexes()

  const [items, targetItems] = await Promise.all([
    collection.find(filter, { projection: { mediaType: 1, tmdbId: 1 } }).sort({ dateAdded: 1, _id: 1 }).toArray(),
    collection.find({ playlistId: targetPlaylistId }, { projection: { mediaType: 1, tmdbId: 1 } }).toArray(),
  ])
  if (items.length === 0) {
    return 0
  }

  const { moveIds, dropIds } = planPlaylistMerge(items, targetItems)
  const now = new Date()
  const $set = stampDateAdded
    ? { playlistId: targetPlaylistId, dateAdded: now, dateUpdated: now }
    : { playlistId: targetPlaylistId, dateUpdated: now }

  if (dropIds.length > 0) {
    await collection.deleteMany({ _id: { $in: dropIds } })
  }

  if (moveIds.length > 0) {
    try {
      await collection.updateMany({ _id: { $in: moveIds } }, { $set })
    } catch (error) {
      if (error?.code !== 11000) throw error
      // The same title reached the target between the read above and this
      // write, and updateMany stopped part way. Finish one item at a time,
      // skipping those already moved and dropping any that collide.
      for (const _id of moveIds) {
        try {
          await collection.updateOne({ _id, playlistId: { $ne: targetPlaylistId } }, { $set })
        } catch (itemError) {
          if (itemError?.code !== 11000) throw itemError
          await collection.deleteOne({ _id })
        }
      }
    }
  }

  return items.length
}

// ===== PLAYLIST OPERATIONS =====

/**
 * Ensure user has a default playlist, create if missing
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Default playlist
 */
// Process-lifetime guard for the unique-default index ensure inside
// ensureDefaultPlaylist — the playlist existence/cleanup logic itself must
// keep running per call, only the createIndex round trip is memoized.
let defaultPlaylistIndexEnsured = false

export async function ensureDefaultPlaylist(userId) {

  if (!userId) {
    throw new Error('User not authenticated')
  }

  try {
    const client = await clientPromise
    const db = client.db('Media')
    const collection = db.collection('Playlists')
    const watchlistCollection = db.collection('Watchlist')

    const ownerObjectId = new ObjectId(userId)
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
        // Repoint items from duplicates to keeper, minus titles it already holds
        await mergeItemsIntoPlaylist(
          watchlistCollection,
          { userId: ownerObjectId, playlistId: { $in: duplicateIds } },
          keeper._id
        )
        // Remove duplicates
        await collection.deleteMany({ _id: { $in: duplicateIds } })
      }
    }

    // 2) Enforce at DB level: one default playlist per user (after cleanup to avoid duplicate key)
    // Memoized per process — this runs on every default-playlist resolution
    // and was the last remaining per-request createIndexes round trip.
    try {
      if (!defaultPlaylistIndexEnsured) {
        await collection.createIndex(
          { ownerId: 1, isDefault: 1 },
          {
            name: 'unique_default_playlist_per_user',
            unique: true,
            partialFilterExpression: { isDefault: true },
          }
        )
        defaultPlaylistIndexEnsured = true
      }
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
  const session = await getSession()

  if (!session?.user?.id) {
    throw new Error('User not authenticated')
  }

  try {
    const client = await clientPromise
    const db = client.db('Media')
    const collection = db.collection('Playlists')
    const ownerObjectId = new ObjectId(session.user.id)

    const playlist = {
      name: name.trim(),
      description: description.trim(),
      privacy,
      ownerId: ownerObjectId,
      collaborators: [],
      dateCreated: new Date(),
      dateUpdated: new Date(),
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
 * @param {string} userId - User ID (required for caching)
 * @param {boolean} [includeShared=true] - Include shared playlists
 * @param {boolean} [includePublic=true] - Include public playlists
 * @returns {Promise<Array>} User's playlists
 */
export const getUserPlaylists = cache(async function getUserPlaylists(
  userId, 
  includeShared = true, 
  includePublic = true
) {
  const session = await getSession()
  const isGlobalAdmin = isGlobalAdminUser(session?.user)

  let userObjectId
  
  if (userId) {
    // Use provided user ID (for cached components)
    userObjectId = new ObjectId(userId)
  } else {
    // Fall back to auth() for backward compatibility
    if (!session?.user?.id) {
      throw new Error('User not authenticated')
    }
    userObjectId = new ObjectId(session.user.id)
  }

  try {
    const client = await clientPromise
    const db = client.db('Media')
    const collection = db.collection('Playlists')

    // Build filter to include:
    // 1. User's own playlists
    // 2. Playlists shared with user (if includeShared)
    // 3. Public playlists (if includePublic)
    const orConditions = [{ ownerId: userObjectId }]

    if (includeShared) {
      orConditions.push({ 'collaborators.userId': userObjectId })
    }

    if (includePublic) {
      orConditions.push({ privacy: 'public' })
    }

    const filter = isGlobalAdmin ? {} : { $or: orConditions }

    const playlistsRaw = await collection.find(filter).sort({ dateUpdated: -1 }).toArray()
    const playlists = playlistsRaw.map((playlist) => normalizePlaylistIdentityFields(playlist))

    // Get unique owner IDs to fetch owner names in batch
    const ownerIds = [...new Set(playlists.map((p) => p.ownerId?.toString()).filter(Boolean))]
    const ownerMap = await getOwnerNameMap(ownerIds)

    // Get item counts for each playlist
    const watchlistCollection = db.collection('Watchlist')
    const playlistsWithCounts = await Promise.all(
      playlists.map(async (playlist) => {
        const sanitized = sanitizePlaylistDoc(playlist)

        // Count ALL items in the playlist (regardless of who added them)
        // This supports collaborative playlists where multiple users can add items
        const itemCount = await watchlistCollection.countDocuments({
          playlistId: playlist._id,
        })

        // Determine relationship type for categorization
        const isOwner = playlist.ownerId?.equals(userObjectId) || false
        const isCollaborator =
          !isOwner && playlist.collaborators?.some((collab) => collab.userId?.equals(userObjectId))
        const isPublic = playlist.privacy === 'public' && !isOwner && !isCollaborator

        // Determine if user can edit this playlist
        // Can edit if: owner, or collaborator with edit/admin permission
        // Note: Admin check only works when session is available
        const collaboratorPermission = getCollaboratorPermission(playlist, userObjectId)
        const globalPermission = getGlobalPermission(playlist)
        const canAdd =
          isOwner ||
          canCollaboratorAdd(collaboratorPermission) ||
          canCollaboratorAdd(globalPermission) ||
          isGlobalAdmin
        const canEdit =
          isOwner ||
          canCollaboratorEdit(collaboratorPermission) ||
          canCollaboratorEdit(globalPermission) ||
          isGlobalAdmin

        return {
          ...sanitized,
          ownerName:
            ownerMap.get(sanitized.ownerId) ||
            (sanitized.ownerId
              ? `Unknown User (${String(sanitized.ownerId).slice(0, 8)})`
              : 'Unknown User'),
          itemCount,
          isOwner,
          isCollaborator,
          isPublic,
          canAdd,
          canEdit,
        }
      })
    )

    return playlistsWithCounts
  } catch (error) {
    console.error('Error getting user playlists:', error)
    throw new Error('Failed to get playlists')
  }
})

/**
 * Get a single playlist by ID (includes public playlists and those shared with user)
 * @param {string} playlistId - Playlist ID
 * @returns {Promise<Object|null>} Playlist or null if not found/not accessible
 */
export async function getPlaylistById(playlistId, { user = null } = {}) {
  // Prefer the already-authenticated user from the calling route (saves a
  // session lookup); fall back to getSession() for callers without one.
  const requestUser = user ?? (await getSession())?.user

  if (!requestUser?.id) {
    throw new Error('User not authenticated')
  }

  try {
    const client = await clientPromise
    const db = client.db('Media')
    const collection = db.collection('Playlists')

    const watchlistCollection = db.collection('Watchlist')

    const userId = requestUser.id
    const userObjectId = new ObjectId(userId)
    const isGlobalAdmin = isGlobalAdminUser(requestUser)

    // Find playlist that is either:
    // 1. Owned by user
    // 2. User is a collaborator
    // 3. Shared (privacy='shared')
    // 4. Public (privacy='public')
    const playlistRaw = await collection.findOne(
      isGlobalAdmin
        ? { _id: new ObjectId(playlistId) }
        : {
            _id: new ObjectId(playlistId),
            $or: [
              { ownerId: userObjectId },
              { 'collaborators.userId': userObjectId },
              { privacy: 'shared' },
              { privacy: 'public' },
            ],
          }
    )

    const playlist = normalizePlaylistIdentityFields(playlistRaw)

    if (!playlist) {
      return null
    }

    // Get owner name
    const ownerNameMap = await getOwnerNameMap([playlist.ownerId?.toString()].filter(Boolean))
    const ownerName =
      ownerNameMap.get(playlist.ownerId?.toString()) ||
      (playlist.ownerId
        ? `Unknown User (${String(playlist.ownerId).slice(0, 8)})`
        : 'Unknown User')

    // Get item count for this playlist
    // Count ALL items in the playlist (regardless of who added them)
    // This supports collaborative playlists where multiple users can add items
    const itemCount = await watchlistCollection.countDocuments({
      playlistId: playlist._id,
    })

    // Determine relationship type for categorization
    const isOwner = playlist.ownerId?.equals(userObjectId) || false
    const isCollaborator =
      !isOwner && playlist.collaborators?.some((collab) => collab.userId?.equals(userObjectId))
    const isPublic = playlist.privacy === 'public' && !isOwner && !isCollaborator

    // Determine if user can edit this playlist
    // Can edit if: owner, or collaborator with edit/admin permission, or user is admin
    const collaboratorPermission = getCollaboratorPermission(playlist, userObjectId)
    const globalPermission = getGlobalPermission(playlist)
    const canAdd =
      isOwner ||
      canCollaboratorAdd(collaboratorPermission) ||
      canCollaboratorAdd(globalPermission) ||
      isGlobalAdmin
    const canEdit =
      isOwner ||
      canCollaboratorEdit(collaboratorPermission) ||
      canCollaboratorEdit(globalPermission) ||
      isGlobalAdmin

    const sanitized = sanitizePlaylistDoc(playlist)

    return {
      ...sanitized,
      ownerName,
      itemCount,
      isOwner,
      isCollaborator,
      isPublic,
      canAdd,
      canEdit,
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
  const session = await getSession()

  if (!session?.user?.id) {
    throw new Error('User not authenticated')
  }

  const userObjectId = new ObjectId(session.user.id)
  const isGlobalAdmin = isGlobalAdminUser(session?.user)

  try {
    const client = await clientPromise
    const db = client.db('Media')
    const collection = db.collection('Playlists')

    const playlistRaw = await collection.findOne({ _id: new ObjectId(playlistId) })
    const playlist = normalizePlaylistIdentityFields(playlistRaw)
    if (!playlist) {
      return false
    }

    const isOwner = playlist.ownerId?.equals(userObjectId) || false
    const collaboratorPermission = getCollaboratorPermission(playlist, userObjectId)
    const globalPermission = getGlobalPermission(playlist)
    const canEdit =
      isOwner ||
      canCollaboratorEdit(collaboratorPermission) ||
      canCollaboratorEdit(globalPermission) ||
      isGlobalAdmin

    if (!canEdit) {
      return false
    }

    const normalizedUpdates = {
      ...updates,
    }

    const now = new Date()
    const playlistObjectId = new ObjectId(playlistId)
    const previousOwnerId = playlist.ownerId
    let nextOwnerId = playlist.ownerId

    if (normalizedUpdates.ownerId !== undefined) {
      const parsedOwnerId = toObjectId(normalizedUpdates.ownerId)
      if (!parsedOwnerId) {
        const invalidOwnerError = new Error('Invalid ownerId')
        invalidOwnerError.status = 400
        throw invalidOwnerError
      }
      normalizedUpdates.ownerId = parsedOwnerId
      nextOwnerId = parsedOwnerId
    }

    if (normalizedUpdates.isDefault !== undefined && typeof normalizedUpdates.isDefault !== 'boolean') {
      const invalidDefaultError = new Error('isDefault must be a boolean')
      invalidDefaultError.status = 400
      throw invalidDefaultError
    }

    const ownerChanged = !previousOwnerId?.equals(nextOwnerId)
    const nextIsDefault =
      normalizedUpdates.isDefault !== undefined
        ? normalizedUpdates.isDefault
        : Boolean(playlist.isDefault)

    if (nextIsDefault) {
      await collection.updateMany(
        {
          _id: { $ne: playlistObjectId },
          ownerId: nextOwnerId,
          isDefault: true,
        },
        {
          $set: {
            isDefault: false,
            dateUpdated: now,
          },
        }
      )
    }

    const result = await collection.updateOne(
      { _id: playlistObjectId },
      {
        $set: {
          ...normalizedUpdates,
          dateUpdated: now,
        },
      }
    )

    if (ownerChanged && previousOwnerId && (playlist.isDefault || nextIsDefault)) {
      await ensureDefaultPlaylist(previousOwnerId.toString())
    }

    if (!ownerChanged && playlist.isDefault && !nextIsDefault && previousOwnerId) {
      await ensureDefaultPlaylist(previousOwnerId.toString())
    }

    return result.modifiedCount > 0
  } catch (error) {
    if (error?.status) {
      throw error
    }

    if (error?.code === 11000) {
      const duplicateKeyError = new Error('Cannot transfer a default playlist to a user who already has a default playlist')
      duplicateKeyError.status = 409
      duplicateKeyError.code = 'DEFAULT_PLAYLIST_OWNER_CONFLICT'
      throw duplicateKeyError
    }

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
  const session = await getSession()

  if (!session?.user?.id) {
    throw new Error('User not authenticated')
  }

  try {
    const client = await clientPromise
    const db = client.db('Media')
    const userObjectId = new ObjectId(session.user.id)
    const isGlobalAdmin = isGlobalAdminUser(session?.user)

    // Owner or global admin can delete playlist (never allow deleting default)
    const playlistDoc = await db.collection('Playlists').findOne(
      isGlobalAdmin
        ? { _id: new ObjectId(playlistId) }
        : {
            _id: new ObjectId(playlistId),
            ownerId: userObjectId,
          }
    )
    if (!playlistDoc) {
      return false
    }
    if (playlistDoc.isDefault) {
      // Prevent deleting default playlist
      throw new Error('Cannot delete default playlist')
    }

    const playlistResult = await db.collection('Playlists').deleteOne(
      isGlobalAdmin
        ? { _id: new ObjectId(playlistId) }
        : {
            _id: new ObjectId(playlistId),
            ownerId: userObjectId,
          }
    )

    if (playlistResult.deletedCount > 0) {
      // Move all items in this playlist to the owner's default playlist, minus
      // titles it already holds (a film in both used to end up there twice)
      const playlistOwnerId = playlistDoc.ownerId?.toString()
      const defaultPlaylist = await ensureDefaultPlaylist(playlistOwnerId)
      await mergeItemsIntoPlaylist(
        db.collection('Watchlist'),
        {
          userId: playlistDoc.ownerId,
          playlistId: new ObjectId(playlistId),
        },
        new ObjectId(defaultPlaylist.id)
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
 * @param {Array} removeCollaborators - Array of collaborator emails to remove
 * @returns {Promise<boolean>} Success status
 */
export async function sharePlaylist(playlistId, collaborators = [], globalPermission, removeCollaborators = []) {
  const session = await getSession()

  if (!session?.user?.id) {
    throw new Error('User not authenticated')
  }

  try {
    const client = await clientPromise
    const db = client.db('Media')
    const userObjectId = new ObjectId(session.user.id)
    const isGlobalAdmin = isGlobalAdminUser(session?.user)

    const playlistRaw = await db.collection('Playlists').findOne({ _id: new ObjectId(playlistId) })
    const playlist = normalizePlaylistIdentityFields(playlistRaw)
    if (!playlist) {
      return false
    }

    const isOwner = playlist.ownerId?.equals(userObjectId) || false
    const collaboratorPermission = getCollaboratorPermission(playlist, userObjectId)
    const existingGlobalPermission = getGlobalPermission(playlist)
    const canAdmin =
      isOwner ||
      isAdminPermission(collaboratorPermission) ||
      isAdminPermission(existingGlobalPermission) ||
      isGlobalAdmin

    if (!canAdmin) {
      return false
    }

    // Get user IDs for the emails
    const userIds = await Promise.all(
      collaborators.map(async ({ email, permission }) => {
        const user = await userQueries.findByEmail(email)
        const collaboratorUserId = toObjectId(user?._id)
        if (!user || !collaboratorUserId) {
          return null
        }

        return {
          userId: collaboratorUserId,
          email,
          permission,
          dateAdded: new Date(),
        }
      })
    )

    const validCollaborators = userIds.filter(Boolean)
    const validRemoveCollaborators = Array.isArray(removeCollaborators)
      ? [...new Set(removeCollaborators
          .map((email) => (typeof email === 'string' ? email.trim().toLowerCase() : ''))
          .filter(Boolean))]
      : []

    const updateDoc = {
      $set: {
        dateUpdated: new Date(),
      },
    }

    if (validCollaborators.length > 0) {
      updateDoc.$addToSet = {
        collaborators: { $each: validCollaborators },
      }
    }

    if (validRemoveCollaborators.length > 0) {
      updateDoc.$pull = {
        collaborators: {
          email: { $in: validRemoveCollaborators },
        },
      }
    }

    if (globalPermission !== undefined) {
      if (globalPermission === null || globalPermission === 'none') {
        updateDoc.$unset = { globalPermission: '' }
      } else {
        updateDoc.$set.globalPermission = globalPermission
      }
    }

    const result = await db.collection('Playlists').updateOne(
      { _id: new ObjectId(playlistId) },
      updateDoc
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
  const session = await getSession()

  if (!session?.user?.id) {
    throw new Error('User not authenticated')
  }

  try {
    const client = await clientPromise
    const db = client.db('Media')
    const collection = db.collection('Playlists')
    const userObjectId = new ObjectId(session.user.id)
    const isGlobalAdmin = isGlobalAdminUser(session?.user)

    const playlistRaw = await collection.findOne({ _id: new ObjectId(playlistId) })
    const playlist = normalizePlaylistIdentityFields(playlistRaw)
    if (!playlist) {
      return false
    }

    const isOwner = playlist.ownerId?.equals(userObjectId) || false
    const collaboratorPermission = getCollaboratorPermission(playlist, userObjectId)
    const globalPermission = getGlobalPermission(playlist)
    const canEdit =
      isOwner ||
      canCollaboratorEdit(collaboratorPermission) ||
      canCollaboratorEdit(globalPermission) ||
      isGlobalAdmin

    if (!canEdit) {
      return false
    }

    const result = await collection.updateOne(
      { _id: new ObjectId(playlistId) },
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
  const session = await getSession()

  if (!session?.user?.id) {
    throw new Error('User not authenticated')
  }

  try {
    const client = await clientPromise
    const db = client.db('Media')
    const collection = db.collection('Playlists')
    const userObjectId = new ObjectId(session.user.id)
    const isGlobalAdmin = isGlobalAdminUser(session?.user)

    const playlistRaw = await collection.findOne({ _id: new ObjectId(playlistId) })
    const playlist = normalizePlaylistIdentityFields(playlistRaw)
    if (!playlist) {
      return false
    }

    const isOwner = playlist.ownerId?.equals(userObjectId) || false
    const collaboratorPermission = getCollaboratorPermission(playlist, userObjectId)
    const globalPermission = getGlobalPermission(playlist)
    const canEdit =
      isOwner ||
      canCollaboratorEdit(collaboratorPermission) ||
      canCollaboratorEdit(globalPermission) ||
      isGlobalAdmin

    if (!canEdit) {
      return false
    }

    const result = await collection.updateOne(
      { _id: new ObjectId(playlistId) },
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
// Reads only. Home screen rows are written by homeRows.js.

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
 * List visible playlists for a user (showInApp=true),
 * ordered by appOrder asc then dateUpdated desc
 */
export const listVisiblePlaylists = cache(async function listVisiblePlaylists(userId) {
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
})

/**
 * Admin helper: list users with optional search/pagination
 * Returns minimal identity info for moderation panel
 */
export async function findUsersForAdmin({ search = '', page = 0, limit = 20 } = {}) {
  const filter = {}
  if (search && typeof search === 'string') {
    const re = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    filter.$or = [{ name: re }, { email: re }]
  }

  const safeLimit = Math.max(1, Math.min(100, parseInt(limit)))
  const safePage = Math.max(0, parseInt(page))

  // Use userQueries.collection() for complex query with sorting and pagination
  const cursor = userQueries.collection()
    .find(filter, { projection: { _id: 1, name: 1, email: 1 } })
    .sort({ name: 1, email: 1 })
    .skip(safePage * safeLimit)
    .limit(safeLimit)

  const users = await cursor.toArray()
  const total = await userQueries.collection().countDocuments(filter)
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
// Memoized per process (flag set only on success) so polling requests don't
// pay createIndex round trips — mirrors ensureWatchlistIndexes.
let comingSoonIndexesEnsured = false
async function ensureComingSoonIndexes() {
  if (comingSoonIndexesEnsured) return
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

    comingSoonIndexesEnsured = true
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

  // Check which items now exist in library AND are web-visible — a hidden
  // title is still "coming soon" to clients, so keep its entry until visible
  const [movieMatches, tvMatches] = await Promise.all([
    movieTmdbIds.length > 0
      ? db
          .collection('FlatMovies')
          .find(
            { $and: [{ 'metadata.id': { $in: movieTmdbIds } }, visibleMovieFilter()] },
            { projection: { 'metadata.id': 1 } }
          )
          .toArray()
      : Promise.resolve([]),
    tvTmdbIds.length > 0
      ? db
          .collection('FlatTVShows')
          .find(
            { $and: [{ 'metadata.id': { $in: tvTmdbIds } }, visibleShowFilter()] },
            { projection: { 'metadata.id': 1 } }
          )
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
 * @param {Object} [options={}] - Additional options
 * @param {Object} [options.authHeaders] - Authentication headers for server-to-server TMDB calls
 * @returns {Promise<Array>} Minimal card data optimized for horizontal list performance
 */
export async function getMinimalCardDataForPlaylist(watchlistItems, playlist = null, includeUnavailable = true, options = {}) {
  // itemsArePreResolved: set by callers whose watchlistItems are getUserWatchlist
  // output — those items already carry the batchResolveMedia fields (isExternal,
  // title, posterURL, blurhashes, tmdbMetadata, ...) spread onto them, so external
  // items can reuse that resolution instead of a second TMDB round trip.
  const { authHeaders = null, itemsArePreResolved = false } = options
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
      originalTitle: 1,
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
    
    // Web-hidden titles are excluded here so they fall through to the
    // external-TMDB card branch below (degrade to unavailable, not dead-end)
    if (movieTmdbIds.length > 0) {
      queries.push(
        db
          .collection('FlatMovies')
          .find(
            { $and: [{ 'metadata.id': { $in: movieTmdbIds } }, visibleMovieFilter()] },
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
            { $and: [{ 'metadata.id': { $in: tvTmdbIds } }, visibleShowFilter()] },
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

    // Identify external items that need TMDB data fetching
    const externalItems = watchlistItems.filter(item => {
      const tmdbId = parseInt(item.tmdbId)
      return !availableMediaMap.has(tmdbId) && includeUnavailable
    })

    // Resolve TMDB metadata for external items. Pre-resolved items (already
    // enhanced by getUserWatchlist's batchResolveMedia pass) are reused as-is —
    // their fields are the same resolved shape the card branch below reads —
    // and only the remainder (e.g. items whose earlier resolution failed) is fetched.
    let externalTmdbData = new Map()
    if (externalItems.length > 0) {
      const preResolvedItems = itemsArePreResolved
        ? externalItems.filter(item => item.isExternal === true && item.title)
        : []
      for (const item of preResolvedItems) {
        externalTmdbData.set(parseInt(item.tmdbId), item)
      }

      const itemsToFetch = externalItems.filter(item => !externalTmdbData.has(parseInt(item.tmdbId)))

      if (preResolvedItems.length > 0) {
        console.log(`[getMinimalCardDataForPlaylist] Reusing pre-resolved TMDB data for ${preResolvedItems.length} external items`)
      }

      if (itemsToFetch.length > 0) {
        try {
          console.log(`[getMinimalCardDataForPlaylist] Fetching TMDB data for ${itemsToFetch.length} external items:`,
            itemsToFetch.map(item => `${item.mediaType}/${item.tmdbId}`).join(', '))

          const tmdbResults = await batchResolveMedia(
            itemsToFetch.map(item => ({
              tmdbId: parseInt(item.tmdbId),
              mediaType: item.mediaType
            })),
            { authHeaders }  // Forward auth headers for authentication
          )
          for (const [tmdbId, mediaData] of tmdbResults) {
            externalTmdbData.set(tmdbId, mediaData)
          }

          // Log TMDB fetch success/failure
          const successCount = tmdbResults.size
          const failureCount = itemsToFetch.length - successCount
          console.log(`[getMinimalCardDataForPlaylist] TMDB fetch results: ${successCount} success, ${failureCount} failures`)

          if (failureCount > 0) {
            const failedItems = itemsToFetch.filter(item => !externalTmdbData.has(parseInt(item.tmdbId)))
            console.warn(`[getMinimalCardDataForPlaylist] Failed to fetch TMDB data for items:`,
              failedItems.map(item => `${item.mediaType}/${item.tmdbId}`).join(', '))
          }
        } catch (error) {
          console.error('[getMinimalCardDataForPlaylist] Error fetching TMDB data for external items:', error)
          // Continue with empty data - fallback to 'Unknown Title' / placeholder images
        }
      }
    }

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
          link: mediaLinkKey(availableMedia)
            ? encodeURIComponent(mediaLinkKey(availableMedia))
            : availableMedia.link || '',
          url: mediaLinkKey(availableMedia)
            ? `/list/${derivedType === 'tv' ? 'tv' : 'movie'}/${encodeURIComponent(mediaLinkKey(availableMedia))}`
            : availableMedia.url || null,
          // Availability flags
          isAvailable: true,
          comingSoon: comingSoonData?.comingSoon || false,
          comingSoonDate: comingSoonData?.comingSoonDate || null,
          // Preserve watchlist metadata
          watchlistId: watchlistItem._id?.toString() || watchlistItem.id,
          dateAdded: watchlistItem.dateAdded
        }
      } else if (includeUnavailable) {
        // Item is NOT in library - fetch TMDB data or use fallback
        const resolved = externalTmdbData.get(tmdbId)
        const tmdbData = asResolvedMedia(resolved)

        // Use TMDB data if available, otherwise fall back to cached watchlist data
        const title = tmdbData?.title || watchlistItem.title || untitledLabel(resolved)
        const posterURL = tmdbData?.posterURL || watchlistItem.posterURL || '/sorry-image-not-available.jpg'
        const backdropURL = tmdbData?.backdrop || watchlistItem.backdrop || watchlistItem.backdropURL || null
        const posterBlurhash = tmdbData?.posterBlurhash || watchlistItem.posterBlurhash || null
        const backdropBlurhash = tmdbData?.backdropBlurhash || watchlistItem.backdropBlurhash || null
        const releaseDate = tmdbData?.metadata?.release_date ||
                           tmdbData?.metadata?.first_air_date ||
                           watchlistItem.tmdbMetadata?.release_date ||
                           watchlistItem.tmdbMetadata?.first_air_date
        
        return {
          _id: watchlistItem._id?.toString() || watchlistItem.id,
          id: watchlistItem._id?.toString() || watchlistItem.id,
          tmdbId: tmdbId,
          type: watchlistItem.mediaType === 'tv' ? 'tv' : 'movie',
          mediaType: watchlistItem.mediaType,
          title: title,
          posterURL: posterURL,
          posterBlurhash: posterBlurhash,
          // Include backdrop for PopupCard immediate display
          backdrop: backdropURL,
          backdropBlurhash: backdropBlurhash,
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
            case 'title': {
              const titleA = (a.title || '').toLowerCase()
              const titleB = (b.title || '').toLowerCase()
              comparison = titleA.localeCompare(titleB)
              break
            }
            case 'releaseDate': {
              const aReleaseDate = a.metadata?.release_date || a.metadata?.first_air_date
              const bReleaseDate = b.metadata?.release_date || b.metadata?.first_air_date
              const dateA = aReleaseDate ? new Date(aReleaseDate) : new Date('9999-12-31')
              const dateB = bReleaseDate ? new Date(bReleaseDate) : new Date('9999-12-31')
              comparison = dateA - dateB
              break
            }
            case 'dateAdded':
            default: {
              const aTmdbId = a.metadata?.id || a.tmdbId
              const bTmdbId = b.metadata?.id || b.tmdbId
              const aWatchlistItem = watchlistItems.find(item => parseInt(item.tmdbId) === parseInt(aTmdbId))
              const bWatchlistItem = watchlistItems.find(item => parseInt(item.tmdbId) === parseInt(bTmdbId))
              const aDate = new Date(aWatchlistItem?.dateAdded || 0)
              const bDate = new Date(bWatchlistItem?.dateAdded || 0)
              comparison = aDate - bDate
              break
            }
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
      const resolved = resolvedTmdbData.get(tmdbId)
      const resolvedTmdbMedia = asResolvedMedia(resolved)

      if (availableMedia) {
        // Item is available in library - return full media document
        return {
          ...availableMedia,
          type: availableMedia.type || (availableMedia.mediaType === 'tv' ? 'tv' : 'movie'),
          id: availableMedia._id?.toString() || availableMedia.id,
          link: mediaLinkKey(availableMedia)
            ? encodeURIComponent(mediaLinkKey(availableMedia))
            : availableMedia.link || '',
          url: mediaLinkKey(availableMedia)
            ? `/list/${availableMedia.type === 'tv' ? 'tv' : 'movie'}/${encodeURIComponent(mediaLinkKey(availableMedia))}`
            : availableMedia.url || null,
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
        const title = watchlistItem.title || untitledLabel(resolved)
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
            case 'title': {
              const titleA = (a.title || '').toLowerCase()
              const titleB = (b.title || '').toLowerCase()
              comparison = titleA.localeCompare(titleB)
              break
            }
            case 'releaseDate': {
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
            }
            case 'dateAdded':
            default: {
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
