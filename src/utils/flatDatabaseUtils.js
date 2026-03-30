import clientPromise from '@src/lib/mongodb'
import { ObjectId } from 'mongodb'
import {
  arrangeMediaByLatestModification,
  sanitizeRecord,
  generateClipVideoURL,
} from '@src/utils/auth_utils'
import { getFullImageUrl } from '@src/utils'
import { userQueries } from '@src/lib/userQueries'
import { countPlaybackForUser, findPlaybackForUser } from '@src/utils/watchHistory/database'

/**
 * Projection profiles for different use cases to optimize data transfer
 */
const PROJECTION_PROFILES = {
  // Minimal fields for admin overview - optimized for compact display
  'admin-overview': {
    movies: {
      _id: 1,
      title: 1,
      videoURL: 1,
      posterURL: 1,
      duration: 1,
      normalizedVideoId: 1,
      hdr: 1, // Keep for basic quality info
      // Include trailer URL so admin views can also resolve trailer-based watches
      'metadata.trailer_url': 1,
    },
    episodes: {
      _id: 1,
      title: 1,
      videoURL: 1,
      episodeNumber: 1,
      seasonNumber: 1,
      seasonId: 1,
      showId: 1,
      thumbnail: 1,
      duration: 1,
      normalizedVideoId: 1,
    },
    shows: {
      _id: 1,
      title: 1,
      posterURL: 1,
      // Include trailer URL so we can map YouTube watches back to TV shows
      'metadata.trailer_url': 1,
    },
    seasons: {
      _id: 1,
      seasonNumber: 1,
    },
  },

  // Enhanced fields for TV devices - includes clip generation requirements
  'tv-device': {
    movies: {
      _id: 1,
      title: 1,
      videoURL: 1,
      posterURL: 1,
      posterBlurhash: 1,
      posterBlurhashSource: 1,
      duration: 1,
      hdr: 1,
      normalizedVideoId: 1,
      'metadata.overview': 1, // For descriptions
    },
    episodes: {
      _id: 1,
      title: 1,
      videoURL: 1,
      episodeNumber: 1,
      seasonNumber: 1,
      seasonId: 1,
      showId: 1,
      thumbnail: 1,
      thumbnailBlurhash: 1,
      thumbnailBlurhashSource: 1,
      duration: 1,
      normalizedVideoId: 1,
    },
    shows: {
      _id: 1,
      title: 1,
      originalTitle: 1,
      posterURL: 1,
      posterBlurhash: 1,
      posterBlurhashSource: 1,
      logo: 1,
    },
    seasons: {
      _id: 1,
      seasonNumber: 1,
      posterURL: 1,
    },
  },

  // Standard fields for general web usage
  standard: {
    movies: {
      _id: 1,
      title: 1,
      videoURL: 1,
      posterURL: 1,
      posterBlurhash: 1,
      posterBlurhashSource: 1,
      duration: 1,
      hdr: 1,
      normalizedVideoId: 1,
      'metadata.overview': 1,
      // Include trailer URL so we can map YouTube watches back to movies
      'metadata.trailer_url': 1,
    },
    episodes: {
      _id: 1,
      title: 1,
      videoURL: 1,
      duration: 1,
      episodeNumber: 1,
      seasonNumber: 1,
      seasonId: 1,
      showId: 1,
      thumbnail: 1,
      thumbnailBlurhash: 1,
      thumbnailBlurhashSource: 1,
      normalizedVideoId: 1,
    },
    shows: {
      _id: 1,
      title: 1,
      posterURL: 1,
      posterBlurhash: 1,
      posterBlurhashSource: 1,
      'metadata.overview': 1,
      // Include trailer URL so we can map YouTube watches back to TV shows
      'metadata.trailer_url': 1,
    },
    seasons: {
      _id: 1,
      seasonNumber: 1,
    },
  },

  // Horizontal list profile - includes backdrop data for PopupCard preloading
  'horizontal-list': {
    movies: {
      _id: 1,
      title: 1,
      videoURL: 1,
      posterURL: 1,
      posterBlurhash: 1,
      posterBlurhashSource: 1,
      backdrop: 1,
      backdropBlurhash: 1,
      backdropBlurhashSource: 1,
      backdropSource: 1,
      duration: 1,
      hdr: 1,
      normalizedVideoId: 1,
      'metadata.id': 1,
      'metadata.overview': 1,
      // Include trailer URL so we can map YouTube watches back to movies
      'metadata.trailer_url': 1,
    },
    episodes: {
      _id: 1,
      title: 1,
      videoURL: 1,
      duration: 1,
      episodeNumber: 1,
      seasonNumber: 1,
      seasonId: 1,
      showId: 1,
      thumbnail: 1,
      thumbnailBlurhash: 1,
      thumbnailBlurhashSource: 1,
      normalizedVideoId: 1,
    },
    shows: {
      _id: 1,
      title: 1,
      posterURL: 1,
      posterBlurhash: 1,
      posterBlurhashSource: 1,
      backdrop: 1,
      backdropBlurhash: 1,
      backdropBlurhashSource: 1,
      backdropSource: 1,
      'metadata.id': 1,
      'metadata.overview': 1,
      logo: 1,
      // Include trailer URL so we can map YouTube watches back to TV shows
      'metadata.trailer_url': 1,
    },
    seasons: {
      _id: 1,
      seasonNumber: 1,
    },
  },

  // Full compatibility mode - returns all fields
  full: {
    movies: {
      _id: 1,
      title: 1,
      videoURL: 1,
      normalizedVideoId: 1,
      posterURL: 1,
      posterBlurhash: 1,
      posterBlurhashSource: 1,
      backdrop: 1,
      backdropBlurhash: 1,
      backdropBlurhashSource: 1,
      hdr: 1,
      duration: 1,
      metadata: 1,
    },
    episodes: {
      _id: 1,
      title: 1,
      videoURL: 1,
      duration: 1,
      normalizedVideoId: 1,
      episodeNumber: 1,
      seasonNumber: 1,
      seasonId: 1,
      showId: 1,
      thumbnail: 1,
      thumbnailBlurhash: 1,
      thumbnailBlurhashSource: 1,
      metadata: 1,
      // Include duration conditionally based on shouldExposeAdditionalData
    },
    shows: {}, // Empty projection = all fields
    seasons: {}, // Empty projection = all fields
  },
}

/**
 * Selects the optimal projection profile based on context
 */
function selectProjectionProfile(projection, shouldExposeAdditionalData, contextHints = {}) {
  // Explicit projection profile requested
  if (projection && PROJECTION_PROFILES[projection]) {
    return projection
  }

  // Auto-detect based on context hints
  if (contextHints.isAdmin) {
    return 'admin-overview'
  }

  if (contextHints.horizontalList) {
    return 'horizontal-list'
  }

  if (shouldExposeAdditionalData || contextHints.isTVdevice) {
    return 'tv-device'
  }

  // Default to standard for general web usage
  return 'standard'
}

/**
 * Gets the appropriate projection for a collection based on the selected profile
 */
function getProjectionForCollection(profile, collection, shouldExposeAdditionalData = false) {
  const projectionProfile = PROJECTION_PROFILES[profile]
  if (!projectionProfile) {
    // Fallback to full profile if unknown profile requested
    return PROJECTION_PROFILES['full'][collection] || {}
  }

  let projection = { ...projectionProfile[collection] }

  // Handle special cases for shouldExposeAdditionalData
  if (shouldExposeAdditionalData && collection === 'episodes' && profile !== 'full') {
    projection.duration = 1 // Always include duration for TV devices
  }

  return projection
}

/**
 * Generates a consistent hash identifier from a video URL.
 * Uses cryptographic hashing for reliability across different encoding variations.
 *
 * @param {string} url - The original video URL
 * @returns {string} A hash string identifier
 */
export function generateNormalizedVideoId(url) {
  if (!url) return ''

  try {
    // Import Node.js crypto module dynamically for hashing
    const crypto = require('crypto')

    // Normalize URL before hashing to handle encoding variations
    let normalizedUrl = url

    // Decode URL-encoded characters to ensure consistent hashing
    // Keep decoding until fully decoded (handles multiple encoding levels)
    let previousUrl = ''
    while (previousUrl !== normalizedUrl) {
      previousUrl = normalizedUrl
      try {
        const decoded = decodeURIComponent(normalizedUrl)
        // Only accept the decode if it actually changed something
        if (decoded !== normalizedUrl) {
          normalizedUrl = decoded
        } else {
          break // Already fully decoded
        }
      } catch (e) {
        // Decode failed - URL is either malformed or already decoded
        break
      }
    }

    // Extract URL portions based on URL type
    try {
      const urlObj = new URL(normalizedUrl)

      // Detect if this is a true external service (YouTube, Vimeo, etc.)
      // vs an internal file server (even if served over HTTPS)
      const isYouTubeOrSimilar =
        urlObj.hostname.includes('youtube.com') ||
        urlObj.hostname.includes('youtu.be') ||
        urlObj.hostname.includes('vimeo.com') ||
        urlObj.hostname.includes('dailymotion.com')

      if (isYouTubeOrSimilar) {
        // Keep full URL for external video services to preserve video ID in query params
        // Example: youtube.com/watch?v=ABC123 vs youtube.com/watch?v=XYZ789
        normalizedUrl = urlObj.href
      } else {
        // For internal file servers, use just the pathname (strips protocol/hostname/port)
        // This handles different server URLs pointing to the same file
        // Example: http://server1/video.mp4 and https://server2/video.mp4 → same hash
        normalizedUrl = urlObj.pathname
      }
    } catch (e) {
      // If URL parsing fails, use the whole string
    }

    // Convert to lowercase before hashing to ensure case-insensitive matching
    normalizedUrl = normalizedUrl.toLowerCase()

    // Use SHA-256 for hashing - a modern, reliable hash algorithm
    // We're not using this for security, just for consistent identifiers
    const hash = crypto.createHash('sha256')
    hash.update(normalizedUrl)

    // Return first 16 characters of hex digest - good balance of uniqueness vs length
    return hash.digest('hex').substring(0, 16)
  } catch (error) {
    console.error(`Error generating hash for URL: ${url}`, error)

    // Fallback: if crypto fails, use basic string manipulation
    // This should almost never happen, but just in case
    const fallbackStr = url.toLowerCase().replace(/[^a-z0-9]/g, '')
    return `fallback_${fallbackStr.substring(0, 10)}`
  }
}

/**
 * Gets posters for movies or TV shows from the flat database structure.
 * Note: This function uses 1-based pagination (page 1 is first page)
 *
 * @param {string} type - The type of media (movie or tv).
 * @param {boolean} [countOnly=false] - If true, returns only the count of records.
 * @param {number} [page=1] - The page number for pagination (1-based).
 * @param {number} [limit=0] - The number of items per page.
 * @param {object} [customProjection={}] - Optional custom projection object to merge with default.
 * @returns {Promise} Resolves to an array of poster objects or the count of records.
 */
export async function getFlatPosters(
  type,
  countOnly = false,
  page = 1,
  limit = 15,
  customProjection = {}
) {
  const client = await clientPromise
  const collection = type === 'movie' ? 'FlatMovies' : 'FlatTVShows'

  // Define default projections for fields to include
  const defaultProjection = {
    _id: 1,
    normalizedVideoId: 1,
    title: 1,
    posterURL: 1,
    posterBlurhash: 1,
    backdrop: 1,
    backdropBlurhash: 1,
    metadata: 1,
  }
  if (type === 'movie') {
    defaultProjection.hdr = 1
    defaultProjection.videoURL = 1
  }

  // Merge default projection with custom projection
  const finalProjection = { ...defaultProjection, ...customProjection }

  if (countOnly) {
    return await client.db('Media').collection(collection).countDocuments()
  }

  // Ensure page is at least 1 for 1-based pagination
  const skip = page * limit
  const queryOptions = { projection: finalProjection } // Use the merged projection
  if (limit > 0) {
    queryOptions.limit = limit
    queryOptions.skip = skip
  }

  const records = await client.db('Media').collection(collection).find({}, queryOptions).toArray()

  return await Promise.all(
    records.map(async (record) => {
      let poster =
        record.posterURL ||
        getFullImageUrl(record.metadata?.poster_path) ||
        `/sorry-image-not-available.jpg`

      if (!poster) {
        poster = null
      }

      if (record._id) {
        record._id = record._id.toString()
      }

      const returnData = {
        ...record,
        posterURL: poster,
        link: encodeURIComponent(record.title) || null,
        type: type,
        //media: record
      }

      return returnData
    })
  )
}

/**
 * Add custom URL and other fields to media items from flat structure.
 *
 * @param {Array} mediaArray - Array of media objects.
 * @param {string} type - Media type ('movie' or 'tv').
 * @param {boolean} [preserveAdditionalFields=false] - Whether to preserve videoURL and duration fields for TV device mode.
 * @returns {Promise<Array>} Media array with custom URLs added.
 */
export async function addCustomUrlToFlatMedia(mediaArray, type, preserveAdditionalFields = false) {
  return await Promise.all(
    mediaArray.map(async (media) => {
      const id = media._id.toString()
      delete media._id
      let returnObj = {
        ...media,
        _id: id,
        url: `/list/${type}/${encodeURIComponent(media.title)}`,
        link: encodeURIComponent(media.title) || null,
        description: media.metadata?.overview,
        type,
        // Preserve additional fields for TV device mode when requested
        ...(preserveAdditionalFields &&
          type === 'movie' && {
            videoURL: media.videoURL,
            duration: media.duration,
          }),
        // Preserve episode data for TV shows when TV device mode is enabled
        // used for recently added
        ...(preserveAdditionalFields &&
          type === 'tv' &&
          media.episode && {
            episode: media.episode,
          }),
      }

      // For TV episodes, use the episode thumbnail as the poster if available
      if (type === 'tv' && media.episode && media.episode.thumbnail) {
        returnObj.posterURL = media.episode.thumbnail
        returnObj.thumbnail = media.episode.thumbnail

        // Preserve episode's raw thumbnail blurhash data for later processing
        if (media.episode.thumbnailBlurhash) {
          returnObj.thumbnailBlurhash = media.episode.thumbnailBlurhash
          returnObj.thumbnailBlurhashSource = media.episode.thumbnailBlurhashSource
          // Also use thumbnail blurhash as poster blurhash (keeping them raw)
          returnObj.posterBlurhash = media.episode.thumbnailBlurhash
          returnObj.posterBlurhashSource = media.episode.thumbnailBlurhashSource
        }
      }
      // Standard poster handling for non-episode media
      else if (!media.posterURL) {
        returnObj.posterURL = media.metadata?.poster_path
          ? getFullImageUrl(media.metadata.poster_path, 'w780')
          : `/sorry-image-not-available.jpg`
      }

      // Preserve poster blurhash raw data (no fetching)
      if (!returnObj.posterBlurhash && media.posterBlurhash) {
        returnObj.posterBlurhash = media.posterBlurhash
        returnObj.posterBlurhashSource = media.posterBlurhashSource
      }

      // Preserve backdrop blurhash raw data (no fetching)
      if (media.backdropBlurhash) {
        returnObj.backdropBlurhash = media.backdropBlurhash
        returnObj.backdropBlurhashSource = media.backdropBlurhashSource
        returnObj.backdropSource = media.backdropSource
      }

      // Make sure backdrop is set if it exists in metadata
      if (!returnObj.backdrop && media.metadata?.backdrop_path) {
        returnObj.backdrop = getFullImageUrl(media.metadata.backdrop_path, 'original')
      }

      return returnObj
    })
  )
}

/**
 * Get the most recently watched media for the current user from flat database structure.
 * Optimized version that uses MongoDB aggregation pipeline for filtering, sorting, and pagination.
 *
 * @param {Object} params - Parameters for the function.
 * @param {Object} params.client - MongoDB client instance.
 * @param {string|object} params.userId - The ID of the current user.
 * @param {number} [params.page=0] - The page number for pagination (0-based).
 * @param {number} [params.limit=15] - The number of items per page.
 * @param {boolean} [params.countOnly=false] - Whether to only get the document count.
 * @param {boolean} [params.shouldExposeAdditionalData=false] - Whether to include additional fields for TV device mode.
 * @param {object|null} [params.projection=null] - Optional custom projection to override defaults.
 * @param {object} [params.contextHints={}] - Optional context hints for projection selection.
 * @returns {Promise<Array|number>} The recently watched media details or the document count.
 */
export async function getFlatRecentlyWatchedForUser({
  client = null,
  userId,
  page = 0,
  limit = 15,
  countOnly = false,
  shouldExposeAdditionalData = false,
  projection = null,
  contextHints = {},
}) {
  try {
    if (Boolean(process.env.DEBUG) == true) {
      console.time('getFlatRecentlyWatchedForUser:total')
      console.log(
        `[PERF] Starting getFlatRecentlyWatchedForUser for userId: ${userId}, page: ${page}, limit: ${limit}, countOnly: ${countOnly}, projection: ${projection}`
      )
    }

    const _client = client ?? (await clientPromise)
    const validPage = Math.max(page, 0) // Ensure page is at least 0
    const userObjectId = typeof userId === 'object' ? userId : new ObjectId(userId)
    const userIdString = typeof userId === 'object' ? userId.toString() : userId

    // Select appropriate projection profile based on parameters and context
    const selectedProfile = selectProjectionProfile(
      projection,
      shouldExposeAdditionalData,
      contextHints
    )

    if (Boolean(process.env.DEBUG) == true) {
      console.log(`[PERF] Selected projection profile: ${selectedProfile}`)
    }

    // Validate user exists (Better Auth stores users in 'user' collection)
    const userExists = await userQueries.exists(userId)

    if (!userExists) {
      throw new Error(`User with ID ${userIdString} not found`)
    }

    // Step 1: Use centralized query to get count of valid videos (for countOnly)
    if (countOnly) {
      if (Boolean(process.env.DEBUG) == true) {
        console.time('getFlatRecentlyWatchedForUser:count')
      }

      const count = await countPlaybackForUser(userId, { isValid: { $ne: false } })

      if (Boolean(process.env.DEBUG) == true) {
        console.timeEnd('getFlatRecentlyWatchedForUser:count')
        console.timeEnd('getFlatRecentlyWatchedForUser:total')
        console.log(`[PERF] Total valid videos count: ${count}`)
      }

      return count
    }

    // Step 2: Query WatchHistory using centralized function
    // Each WatchHistory document = one user+video pair (no arrays, no locks)
    if (Boolean(process.env.DEBUG) == true) {
      console.time('getFlatRecentlyWatchedForUser:aggregate')
    }

    const watchedVideos = await findPlaybackForUser(userId, {
      filter: { isValid: { $ne: false } },
      projection: {
        videoId: 1,
        playbackTime: 1,
        lastUpdated: 1,
        normalizedVideoId: 1,
        deviceInfo: 1,
        mediaType: 1,
        mediaId: 1,
        seasonNumber: 1,
        episodeNumber: 1,
        showId: 1,
      },
      sort: { lastUpdated: -1 },
      skip: validPage * limit,
      limit: limit,
    })

    if (Boolean(process.env.DEBUG) == true) {
      console.timeEnd('getFlatRecentlyWatchedForUser:aggregate')
      console.log(`[PERF] Paginated watched videos: ${watchedVideos.length}`)
    }

    // If no videos found, return null
    if (!watchedVideos || watchedVideos.length === 0) {
      if (Boolean(process.env.DEBUG) == true) {
        console.timeEnd('getFlatRecentlyWatchedForUser:total')
      }
      return null
    }

    // Step 3: Extract videoIds, normalizedVideoIds, and mediaIds for batch fetching
    const videoIds = watchedVideos.map((video) => video.videoId)
    const normalizedVideoIds = watchedVideos
      .filter((video) => video.normalizedVideoId)
      .map((video) => video.normalizedVideoId)

    // Extract mediaIds for direct indexed lookups (much faster than URL matching)
    const movieMediaIds = watchedVideos
      .filter((v) => v.mediaId && v.mediaType === 'movie')
      .map((v) => {
        try {
          return new ObjectId(v.mediaId)
        } catch (e) {
          console.warn(`Invalid mediaId for movie: ${v.mediaId}`)
          return null
        }
      })
      .filter(Boolean)

    const tvShowMediaIds = watchedVideos
      .filter((v) => (v.showId || v.mediaId) && v.mediaType === 'tv')
      .map((v) => {
        try {
          // For TV, mediaId often contains the showId
          return new ObjectId(v.showId || v.mediaId)
        } catch (e) {
          console.warn(`Invalid showId/mediaId for TV: ${v.showId || v.mediaId}`)
          return null
        }
      })
      .filter(Boolean)

    // Extract episode lookups for TV trailers (showId + season + episode combination)
    const episodeLookups = watchedVideos
      .filter((v) => v.mediaType === 'tv' && v.seasonNumber && v.episodeNumber)
      .map((v) => ({
        showId: v.showId || v.mediaId, // mediaId is often the showId for TV
        seasonNumber: v.seasonNumber,
        episodeNumber: v.episodeNumber,
      }))
      .filter((lookup) => lookup.showId)

    if (Boolean(process.env.DEBUG) == true) {
      console.time('getFlatRecentlyWatchedForUser:fetchMediaData')
      console.log(
        `[PERF] Searching for ${videoIds.length} direct videoIds, ${normalizedVideoIds.length} normalized videoIds, ${movieMediaIds.length} movie mediaIds, ${tvShowMediaIds.length} TV show mediaIds`
      )
    }

    // Get dynamic projections based on selected profile
    const movieProjection = getProjectionForCollection(
      selectedProfile,
      'movies',
      shouldExposeAdditionalData
    )
    const episodeProjection = getProjectionForCollection(
      selectedProfile,
      'episodes',
      shouldExposeAdditionalData
    )
    const showProjection = getProjectionForCollection(
      selectedProfile,
      'shows',
      shouldExposeAdditionalData
    )
    const seasonProjection = getProjectionForCollection(
      selectedProfile,
      'seasons',
      shouldExposeAdditionalData
    )

    if (Boolean(process.env.DEBUG) == true) {
      console.log(
        `[PERF] Using projections - Movies: ${Object.keys(movieProjection).length} fields, Episodes: ${Object.keys(episodeProjection).length} fields`
      )
    }

    // Step 4: Fetch movies and episodes in parallel - using direct URL, hash matching, trailer URL matching, and mediaId lookup
    const [
      movies,
      episodes,
      episodesByLookup,
      tvShowsByTrailer,
      moviesByMediaId,
      tvShowsByMediaId,
    ] = await Promise.all([
      _client
        .db('Media')
        .collection('FlatMovies')
        .find(
          {
            $or: [
              { normalizedVideoId: { $in: normalizedVideoIds } },
              { videoURL: { $in: videoIds } },
              // Match YouTube trailer URLs stored on the movie metadata
              { 'metadata.trailer_url': { $in: videoIds } },
            ],
          },
          { projection: movieProjection }
        )
        .toArray(),
      _client
        .db('Media')
        .collection('FlatEpisodes')
        .find(
          {
            $or: [
              { normalizedVideoId: { $in: normalizedVideoIds } },
              { videoURL: { $in: videoIds } },
            ],
          },
          { projection: episodeProjection }
        )
        .toArray(),
      // Query episodes by showId + season + episode for trailer-based watches
      episodeLookups.length > 0
        ? _client
            .db('Media')
            .collection('FlatEpisodes')
            .find(
              {
                $or: episodeLookups.map((lookup) => ({
                  showId: new ObjectId(lookup.showId),
                  seasonNumber: lookup.seasonNumber,
                  episodeNumber: lookup.episodeNumber,
                })),
              },
              { projection: episodeProjection }
            )
            .toArray()
        : [],
      _client
        .db('Media')
        .collection('FlatTVShows')
        .find(
          {
            'metadata.trailer_url': { $in: videoIds },
          },
          { projection: showProjection }
        )
        .toArray(),
      // Direct mediaId lookup for movies (indexed _id field, fastest)
      movieMediaIds.length > 0
        ? _client
            .db('Media')
            .collection('FlatMovies')
            .find({ _id: { $in: movieMediaIds } }, { projection: movieProjection })
            .toArray()
        : [],
      // Direct mediaId lookup for TV shows (indexed _id field, fastest)
      tvShowMediaIds.length > 0
        ? _client
            .db('Media')
            .collection('FlatTVShows')
            .find({ _id: { $in: tvShowMediaIds } }, { projection: showProjection })
            .toArray()
        : [],
    ])

    // Merge episode results (deduplicate by _id)
    const allEpisodes = [...episodes, ...episodesByLookup]
    const uniqueEpisodesMap = new Map(allEpisodes.map((ep) => [ep._id.toString(), ep]))
    const uniqueEpisodes = Array.from(uniqueEpisodesMap.values())

    if (Boolean(process.env.DEBUG) == true) {
      console.timeEnd('getFlatRecentlyWatchedForUser:fetchMediaData')
      console.log(
        `[PERF] Found ${movies.length} movies, ${episodes.length} episodes by URL, ${episodesByLookup.length} episodes by lookup, ${uniqueEpisodes.length} unique episodes total, ${tvShowsByTrailer.length} TV shows by trailer URL, ${moviesByMediaId.length} movies by mediaId, ${tvShowsByMediaId.length} TV shows by mediaId`
      )
    }

    // Step 5: Optimize episode data fetching with $lookup aggregation
    if (Boolean(process.env.DEBUG) == true) {
      console.time('getFlatRecentlyWatchedForUser:episodeDetails')
    }

    // Create enhanced movie lookup maps that support direct URL and normalized ID lookups,
    // plus separate trailer lookup maps to preserve clean map semantics.
    const movieMap = new Map()
    const episodeMap = new Map()
    const trailerToMovieMap = new Map()
    const trailerToShowMap = new Map()

    // Populate movie map with direct videoURL and normalizedVideoId keys,
    // and build a separate trailerToMovieMap keyed by metadata.trailer_url.
    movies.forEach((movie) => {
      // Primary key - direct videoURL
      if (movie.videoURL) {
        movieMap.set(movie.videoURL, movie)
      }

      // Secondary key - normalizedVideoId (if available)
      if (movie.normalizedVideoId) {
        movieMap.set(movie.normalizedVideoId, movie)
      }

      // Separate lookup for trailer URLs (e.g., YouTube trailers)
      if (movie.metadata && typeof movie.metadata.trailer_url === 'string') {
        trailerToMovieMap.set(movie.metadata.trailer_url, movie)
      }
    })

    // Add movies found by direct mediaId lookup (fastest path - indexed _id field)
    moviesByMediaId.forEach((movie) => {
      const movieId = movie._id.toString()

      // Add by _id string for direct mediaId lookups
      movieMap.set(movieId, movie)

      // Also add by videoURL and normalizedVideoId if not already present
      if (movie.videoURL && !movieMap.has(movie.videoURL)) {
        movieMap.set(movie.videoURL, movie)
      }

      if (movie.normalizedVideoId && !movieMap.has(movie.normalizedVideoId)) {
        movieMap.set(movie.normalizedVideoId, movie)
      }

      // Also add to trailer map if needed
      if (
        movie.metadata &&
        typeof movie.metadata.trailer_url === 'string' &&
        !trailerToMovieMap.has(movie.metadata.trailer_url)
      ) {
        trailerToMovieMap.set(movie.metadata.trailer_url, movie)
      }
    })

    if (uniqueEpisodes.length > 0) {
      // Get all unique season and show IDs from merged episodes
      const seasonIds = [...new Set(uniqueEpisodes.map((ep) => ep.seasonId))].filter(Boolean)
      const showIds = [...new Set(uniqueEpisodes.map((ep) => ep.showId))].filter(Boolean)

      // Batch fetch seasons and shows
      const [seasons, shows] = await Promise.all([
        seasonIds.length > 0
          ? _client
              .db('Media')
              .collection('FlatSeasons')
              .find({ _id: { $in: seasonIds } }, { projection: seasonProjection })
              .toArray()
          : [],
        showIds.length > 0
          ? _client
              .db('Media')
              .collection('FlatTVShows')
              .find({ _id: { $in: showIds } }, { projection: showProjection })
              .toArray()
          : [],
      ])

      // Create lookup maps
      const seasonMap = new Map(seasons.map((season) => [season._id.toString(), season]))
      const showMap = new Map(shows.map((show) => [show._id.toString(), show]))

      // Build episode map with joined data, supporting both direct URL and normalized ID lookups
      uniqueEpisodes.forEach((episode) => {
        const seasonId = episode.seasonId ? episode.seasonId.toString() : null
        const showId = episode.showId ? episode.showId.toString() : null

        const season = seasonId ? seasonMap.get(seasonId) : null
        const show = showId ? showMap.get(showId) : null

        if (season && show) {
          // Create the full episode object with show and season data
          const fullEpisodeObj = {
            ...show,
            showId: show._id.toString(),
            showTmdbId: show.metadata?.id || null,
            episode,
            seasons: [
              {
                ...season,
                episodes: [episode],
              },
            ],
          }

          // Add to map using direct videoURL key (primary)
          if (episode.videoURL) {
            episodeMap.set(episode.videoURL, fullEpisodeObj)
          }

          // Also add using normalizedVideoId key (secondary) if available
          if (episode.normalizedVideoId) {
            episodeMap.set(episode.normalizedVideoId, fullEpisodeObj)
          }
        }
      })
    }

    // Build trailer-to-TV-show map using metadata.trailer_url for YouTube trailer matching
    tvShowsByTrailer.forEach((show) => {
      if (show.metadata && typeof show.metadata.trailer_url === 'string') {
        trailerToShowMap.set(show.metadata.trailer_url, show)
      }
    })

    // Add TV shows found by direct mediaId lookup (fastest path - indexed _id field)
    tvShowsByMediaId.forEach((show) => {
      const showId = show._id.toString()

      // Add by _id string for direct showId/mediaId lookups
      trailerToShowMap.set(showId, show)

      // Also add by trailer URL if exists and not already present
      if (
        show.metadata &&
        typeof show.metadata.trailer_url === 'string' &&
        !trailerToShowMap.has(show.metadata.trailer_url)
      ) {
        trailerToShowMap.set(show.metadata.trailer_url, show)
      }
    })

    if (Boolean(process.env.DEBUG) == true) {
      console.timeEnd('getFlatRecentlyWatchedForUser:episodeDetails')
      console.log(
        `[PERF] Created lookup maps - Movies: ${movieMap.size}, Episodes: ${episodeMap.size}, TrailerToShowMap: ${trailerToShowMap.size}`
      )
    }

    // Step 6: Create format expected by processWatchedDetails
    if (Boolean(process.env.DEBUG) == true) {
      console.time('getFlatRecentlyWatchedForUser:prepareData')
    }

    // Format watched videos to structure expected by processWatchedDetails,
    // normalizing trailer URLs to internal movie identifiers while preserving
    // the original external URL for limited-access playback.
    const formattedWatchedVideos = watchedVideos.map((video) => {
      const originalVideoId = video.videoId
      let effectiveVideoId = video.videoId
      // IMPORTANT: keep the original normalizedVideoId from WatchHistory so that
      // downstream watch history lookups continue to work correctly, even when
      // we swap the video URL to an internal movie stream.
      const effectiveNormalizedId = video.normalizedVideoId
      let externalVideoURL = null

      // If this watch entry corresponds to a trailer_url on a movie, normalize it
      // to that movie's internal playback URL, but keep the YouTube URL and the
      // original normalizedVideoId (trailer-based) for history linkage.
      const trailerMatchedMovie =
        typeof originalVideoId === 'string' ? trailerToMovieMap.get(originalVideoId) : null

      if (trailerMatchedMovie && trailerMatchedMovie.videoURL) {
        effectiveVideoId = trailerMatchedMovie.videoURL
        externalVideoURL = originalVideoId
      }

      return {
        _id: video._id.toString(),
        videoId: effectiveVideoId,
        playbackTime: video.playbackTime,
        lastUpdated: video.lastUpdated,
        normalizedVideoId: effectiveNormalizedId,
        deviceInfo: video.deviceInfo,
        externalVideoURL, // Optional: present only for trailer-based watches
        mediaType: video.mediaType || null,
        mediaId: video.mediaId || null,
        seasonNumber: video.seasonNumber ?? null,
        episodeNumber: video.episodeNumber ?? null,
        showId: video.showId || null,
      }
    })

    const lastWatched = [
      {
        _id: userObjectId,
        videosWatched: formattedWatchedVideos,
      },
    ]

    if (Boolean(process.env.DEBUG) == true) {
      console.timeEnd('getFlatRecentlyWatchedForUser:prepareData')
      console.time('getFlatRecentlyWatchedForUser:processWatchedDetails')
    }

    // Step 7: Process watched details with flat database specific function
    const contextObj = {
      dateContext: 'watchHistory',
      shouldExposeAdditionalData,
    }
    const watchedDetails = await processFlatWatchedDetails(
      lastWatched,
      movieMap,
      episodeMap,
      trailerToShowMap,
      limit,
      contextObj
    )

    // Enhanced diagnostic logging for pagination consistency
    if (
      Boolean(process.env.DEBUG) == true ||
      watchedVideos.length !== (watchedDetails?.length || 0)
    ) {
      console.timeEnd('getFlatRecentlyWatchedForUser:processWatchedDetails')

      // Log pagination metrics
      console.log(
        `[PAGINATION METRICS] Page: ${validPage}, Limit: ${limit}, Valid videos from DB: ${watchedVideos.length}, Final results: ${watchedDetails?.length || 0}`
      )

      // Log warning if the counts don't match (always log this regardless of DEBUG flag)
      if (watchedVideos.length !== (watchedDetails?.length || 0)) {
        console.warn(
          `[PAGINATION INCONSISTENCY] Expected ${watchedVideos.length} items but got ${watchedDetails?.length || 0} items`
        )

        // Identify which videos were expected but missing from results
        const expectedVideoIds = new Set(watchedVideos.map((v) => v.videoId))
        const actualVideoIds = new Set(
          (watchedDetails || []).map(
            (item) => item.videoURL || item.media?.videoURL || item.media?.episode?.videoURL
          )
        )

        const missingVideoIds = [...expectedVideoIds].filter((id) => !actualVideoIds.has(id))
        if (missingVideoIds.length > 0) {
          console.warn(
            `[MISSING VIDEOS] The following videos were expected but missing in results: ${JSON.stringify(missingVideoIds)}`
          )

          // Log details about the missing videos for debugging
          missingVideoIds.forEach((videoId) => {
            const watchedVideo = watchedVideos.find((v) => v.videoId === videoId)
            if (watchedVideo) {
              console.warn(
                `[MISSING VIDEO DETAILS] VideoId: ${videoId}, LastUpdated: ${watchedVideo.lastUpdated}, NormalizedId: ${watchedVideo.normalizedVideoId || 'none'}`
              )

              // Check if it exists in the movie/episode maps using both keys
              const inMovieMapDirect = movieMap.has(videoId)
              const inMovieMapNormalized = watchedVideo.normalizedVideoId
                ? movieMap.has(watchedVideo.normalizedVideoId)
                : false
              const inEpisodeMapDirect = episodeMap.has(videoId)
              const inEpisodeMapNormalized = watchedVideo.normalizedVideoId
                ? episodeMap.has(watchedVideo.normalizedVideoId)
                : false

              console.warn(
                `[MISSING VIDEO MAPS] MovieMap(direct): ${inMovieMapDirect}, MovieMap(normalized): ${inMovieMapNormalized}, EpisodeMap(direct): ${inEpisodeMapDirect}, EpisodeMap(normalized): ${inEpisodeMapNormalized}`
              )
            }
          })
        }

        // Also log unexpected extra videos
        const extraVideoIds = [...actualVideoIds].filter((id) => !expectedVideoIds.has(id))
        if (extraVideoIds.length > 0) {
          console.warn(
            `[EXTRA VIDEOS] The following videos were in results but not expected: ${JSON.stringify(extraVideoIds)}`
          )
        }
      } else {
        console.log(
          `[PERF] Pagination consistency maintained - ${watchedDetails ? watchedDetails.length : 0} items processed successfully`
        )
      }

      console.timeEnd('getFlatRecentlyWatchedForUser:total')
    }

    return watchedDetails || []
  } catch (error) {
    if (Boolean(process.env.DEBUG) == true) {
      console.timeEnd('getFlatRecentlyWatchedForUser:total')
    }
    console.error(`Error in getFlatRecentlyWatchedForUser: ${error.message}`)
    throw error
  }
}

/**
 * Process watched details specifically for flat database structure.
 * This function is optimized for the episode map structure created by getFlatRecentlyWatchedForUser.
 *
 * @param {Array} lastWatched - Array containing user's watched videos
 * @param {Map} movieMap - Map of movies keyed by videoURL and normalizedVideoId
 * @param {Map} episodeMap - Map of episodes with joined show/season data keyed by videoURL and normalizedVideoId
 * @param {Map} trailerToShowMap - Map of YouTube trailer URLs to TV show records
 * @param {number} limit - Pagination limit (not used here as pagination is handled upstream)
 * @param {Object} context - Context object with additional data
 * @returns {Promise<Array>} Array of processed watched details
 */
export async function processFlatWatchedDetails(
  lastWatched,
  movieMap,
  episodeMap,
  trailerToShowMap,
  limit,
  context = {}
) {
  if (Boolean(process.env.DEBUG) == true) {
    console.time('processFlatWatchedDetails:total')
    console.log(
      `[PERF] Starting processFlatWatchedDetails with ${lastWatched[0].videosWatched.length} videos, limit: ${limit}`
    )
  }

  const results = []
  const processingErrors = []

  for (let i = 0; i < lastWatched[0].videosWatched.length; i++) {
    const video = lastWatched[0].videosWatched[i]

    try {
      if (Boolean(process.env.DEBUG) == true) {
        console.log(`[FLAT_DEBUG] Processing video ${i + 1}: ${video.videoId}`)
        console.log(
          `[FLAT_DEBUG] Video normalizedVideoId: ${video.normalizedVideoId || 'none'}, mediaId: ${video.mediaId || 'none'}, mediaType: ${video.mediaType || 'none'}`
        )
      }

      let movie = null

      // PRIORITY 1: Try direct mediaId lookup (fastest - indexed _id field)
      if (video.mediaId && video.mediaType === 'movie') {
        if (Boolean(process.env.DEBUG) == true) {
          console.log(
            `[FLAT_DEBUG] Trying mediaId movie lookup for ${video.videoId} with mediaId: ${video.mediaId}`
          )
        }
        movie = movieMap.get(video.mediaId)
      }

      // PRIORITY 2: Try direct video ID (URL-based lookup)
      if (!movie) {
        movie = movieMap.get(video.videoId)
      }

      // PRIORITY 3: Try normalizedVideoId if available
      if (!movie && video.normalizedVideoId) {
        if (Boolean(process.env.DEBUG) == true) {
          console.log(
            `[FLAT_DEBUG] Trying normalizedVideoId movie lookup for ${video.videoId} with normalized ID: ${video.normalizedVideoId}`
          )
        }
        movie = movieMap.get(video.normalizedVideoId)
      }

      // Process movie if found
      if (movie) {
        if (Boolean(process.env.DEBUG) == true) {
          console.time(`processFlatWatchedDetails:sanitizeMovie:${results.length}`)
        }

        // Detect if this watch came from a trailer (YouTube/external URL)
        const isTrailerWatch =
          (video.externalVideoURL && typeof video.externalVideoURL === 'string') ||
          (typeof video.videoId === 'string' &&
            (video.videoId.includes('youtube.com/') || video.videoId.includes('youtu.be/')))

        // Prepare movie for sanitization, ensuring we preserve the WatchHistory's normalizedVideoId
        // (which is based on what was actually watched), not the movie's normalizedVideoId
        const movieForSanitize = {
          ...movie,
          _id: isTrailerWatch ? video._id : movie._id, // Use WatchHistory _id for trailer watches to preserve history linkage
          // CRITICAL: Use the WatchHistory normalizedVideoId (based on actual watched URL)
          // NOT the movie's normalizedVideoId (based on internal videoURL)
          normalizedVideoId: video.normalizedVideoId,
          // If trailer watch, add trailer-specific fields
          ...(isTrailerWatch && {
            url: video.externalVideoURL || video.videoId,
            isTrailer: true,
          }),
        }
        if (isTrailerWatch) {
          movieForSanitize.isTrailer = true
        }

        // Pass the context to sanitizeRecord
        const mergedContext = { ...context, lastWatchedVideo: video }
        const sanitizedMovie = await sanitizeRecord(movieForSanitize, 'movie', mergedContext)

        if (Boolean(process.env.DEBUG) == true) {
          console.timeEnd(`processFlatWatchedDetails:sanitizeMovie:${results.length}`)
        }

        if (sanitizedMovie) {
          results.push(sanitizedMovie)
        }
        continue // Move to the next video
      }

      // Try TV episode lookup with priority ordering
      let episodeDetails = null

      // Note: For TV episodes, we don't use mediaId directly since episodes aren't top-level media
      // The showId is tracked instead, but episode lookup still relies on videoId/normalizedVideoId

      // PRIORITY 1: Try direct video ID (URL-based lookup)
      episodeDetails = episodeMap.get(video.videoId)

      // PRIORITY 2: Try normalizedVideoId if available
      if (!episodeDetails && video.normalizedVideoId) {
        if (Boolean(process.env.DEBUG) == true) {
          console.log(
            `[FLAT_DEBUG] Trying normalizedVideoId episode lookup for ${video.videoId} with normalized ID: ${video.normalizedVideoId}`
          )
        }
        episodeDetails = episodeMap.get(video.normalizedVideoId)
      }

      // Process TV episode if found
      if (episodeDetails) {
        if (Boolean(process.env.DEBUG) == true) {
          console.log(`[FLAT_DEBUG] Found episode details for ${video.videoId}`)
          console.log(`[FLAT_DEBUG] Episode structure:`, {
            hasEpisode: !!episodeDetails.episode,
            hasSeasons: !!episodeDetails.seasons,
            title: episodeDetails.title,
            episodeVideoURL: episodeDetails.episode?.videoURL,
            episodeNormalizedId: episodeDetails.episode?.normalizedVideoId,
          })
        }

        // The episodeMap from getFlatRecentlyWatchedForUser contains episode objects with joined show/season data
        // Structure: { ...show, episode: episodeData, seasons: [{ ...season, episodes: [episode] }] }
        if (episodeDetails.episode && episodeDetails.seasons) {
          // Create the TV show object in the format expected by sanitizeRecord
          const detailedTVShow = {
            _id: episodeDetails._id?.toString() || episodeDetails.id,
            showId: episodeDetails.episode.showId.toString() || null,
            showTmdbId: episodeDetails.showTmdbId || null,
            title: episodeDetails.title,
            showTitleFormatted: `${episodeDetails.title} S${episodeDetails.episode.seasonNumber?.toString().padStart(2, '0') || '01'}E${episodeDetails.episode.episodeNumber?.toString().padStart(2, '0') || '01'}`,
            seasonNumber: episodeDetails.episode.seasonNumber,
            seasons: episodeDetails.seasons,
            posterURL:
              episodeDetails.episode.thumbnail ||
              episodeDetails.posterURL ||
              '/sorry-image-not-available.jpg',
            backdrop: episodeDetails.backdrop || null,
            metadata: episodeDetails.metadata || {},
            episode: {
              ...episodeDetails.episode,
              videoURL: video.videoId, // Ensure we use the original videoId for consistency
            },
          }

          // Include additional optional properties if they exist
          if (episodeDetails.logo) detailedTVShow.logo = episodeDetails.logo
          if (episodeDetails.posterBlurhash)
            detailedTVShow.posterBlurhash = episodeDetails.posterBlurhash
          if (episodeDetails.episode.thumbnailBlurhash)
            detailedTVShow.thumbnailBlurhash = episodeDetails.episode.thumbnailBlurhash
          if (episodeDetails.episode.thumbnailSource)
            detailedTVShow.thumbnailSource = episodeDetails.episode.thumbnailSource
          if (episodeDetails.episode.hdr) detailedTVShow.hdr = episodeDetails.episode.hdr
          if (episodeDetails.backdropBlurhash)
            detailedTVShow.backdropBlurhash = episodeDetails.backdropBlurhash
          if (episodeDetails.posterBlurhashSource)
            detailedTVShow.posterBlurhashSource = episodeDetails.posterBlurhashSource
          if (episodeDetails.backdropBlurhashSource)
            detailedTVShow.backdropBlurhashSource = episodeDetails.backdropBlurhashSource

          if (Boolean(process.env.DEBUG) == true) {
            console.time(`processFlatWatchedDetails:sanitizeTV:${results.length}`)
            console.log(`[FLAT_DEBUG] Created detailedTVShow object for ${video.videoId}`)
          }

          // Pass the context to sanitizeRecord
          const mergedContext = { ...context, lastWatchedVideo: video }
          const sanitizedData = await sanitizeRecord(detailedTVShow, 'tv', mergedContext)

          if (Boolean(process.env.DEBUG) == true) {
            console.timeEnd(`processFlatWatchedDetails:sanitizeTV:${results.length}`)
            console.log(
              `[FLAT_DEBUG] sanitizeRecord result: ${sanitizedData ? 'SUCCESS' : 'FAILED'}`
            )
          }

          if (sanitizedData) {
            results.push(sanitizedData)
          } else if (Boolean(process.env.DEBUG) == true) {
            console.warn(`[FLAT_DEBUG] sanitizeRecord returned null for ${video.videoId}`)
          }
          continue
        } else {
          if (Boolean(process.env.DEBUG) == true) {
            console.warn(
              `[FLAT_DEBUG] Episode details found but missing episode or seasons data for ${video.videoId}`
            )
            console.warn(`[FLAT_DEBUG] Episode details structure:`, {
              hasEpisode: !!episodeDetails.episode,
              hasSeasons: !!episodeDetails.seasons,
              keys: Object.keys(episodeDetails),
            })
          }

          processingErrors.push({
            videoId: video.videoId,
            type: 'tv',
            error: 'Episode details missing episode or seasons data',
          })
          // Fall through to external handling so we still show something if possible
        }
      }

      // Debug info about missed videos
      if (Boolean(process.env.DEBUG) == true && !movie && !episodeDetails) {
        if (video.normalizedVideoId) {
          console.log(
            `[FLAT_DEBUG] Video not found despite normalized ID: ${video.videoId} (normalized: ${video.normalizedVideoId})`
          )

          // Additional debugging: check if the normalized ID exists in the maps
          const inMovieMap = movieMap.has(video.normalizedVideoId)
          const inEpisodeMap = episodeMap.has(video.normalizedVideoId)
          console.log(
            `[FLAT_DEBUG] Normalized ID ${video.normalizedVideoId} in movieMap: ${inMovieMap}, in episodeMap: ${inEpisodeMap}`
          )

          // Log some sample keys from the maps for debugging
          const movieKeys = Array.from(movieMap.keys()).slice(0, 3)
          const episodeKeys = Array.from(episodeMap.keys()).slice(0, 3)
          console.log(`[FLAT_DEBUG] Sample movieMap keys: ${JSON.stringify(movieKeys)}`)
          console.log(`[FLAT_DEBUG] Sample episodeMap keys: ${JSON.stringify(episodeKeys)}`)
        } else {
          console.log(
            `[FLAT_DEBUG] Video not found and no normalized ID available: ${video.videoId}`
          )
        }
      }

      // Fallback handling for external videos (e.g., YouTube trailers) that don't exist in flat collections
      const isYouTubeUrl =
        typeof video.videoId === 'string' &&
        (video.videoId.includes('youtube.com/') || video.videoId.includes('youtu.be/'))

      if (isYouTubeUrl) {
        if (Boolean(process.env.DEBUG) == true) {
          console.log(
            `[FLAT_DEBUG] Treating unmatched video as external YouTube trailer: ${video.videoId}`
          )
        }

        // First, try to resolve this as a TV show trailer
        let matchedShow = null

        // PRIORITY 1: Try direct showId lookup (fastest if we have it)
        if (video.showId && video.mediaType === 'tv') {
          matchedShow = trailerToShowMap.get(video.showId)
          if (Boolean(process.env.DEBUG) == true && matchedShow) {
            console.log(
              `[FLAT_DEBUG] Matched YouTube video to TV show by showId: ${matchedShow.title}`
            )
          }
        }

        // PRIORITY 2: Try trailer URL matching
        if (!matchedShow && trailerToShowMap && typeof video.videoId === 'string') {
          matchedShow = trailerToShowMap.get(video.videoId)
          if (Boolean(process.env.DEBUG) == true && matchedShow) {
            console.log(
              `[FLAT_DEBUG] Matched YouTube video to TV show by trailer_url: ${matchedShow.title}`
            )
          }
        }

        if (matchedShow) {
          if (Boolean(process.env.DEBUG) == true) {
            console.log(
              `[FLAT_DEBUG] Matched YouTube trailer to TV show: ${matchedShow.title}, Season ${video.seasonNumber}, Episode ${video.episodeNumber}`
            )
          }

          // Try to find the actual episode record in episodeMap for better poster/thumbnail
          let episodeData = null
          const matchedShowId = matchedShow._id?.toString()

          if (matchedShowId && video.seasonNumber && video.episodeNumber) {
            // Search episodeMap for matching episode
            for (const [key, value] of episodeMap.entries()) {
              if (
                value.episode &&
                value.showId === matchedShowId &&
                value.episode.seasonNumber === video.seasonNumber &&
                value.episode.episodeNumber === video.episodeNumber
              ) {
                episodeData = value.episode
                if (Boolean(process.env.DEBUG) == true) {
                  console.log(
                    `[FLAT_DEBUG] Found episode data in episodeMap for S${video.seasonNumber}E${video.episodeNumber}`
                  )
                }
                break
              }
            }
          }

          // Use episode thumbnail if available, otherwise fall back to show poster
          const posterURL =
            episodeData?.thumbnail ||
            matchedShow.posterURL ||
            getFullImageUrl(matchedShow.metadata?.poster_path) ||
            '/sorry-image-not-available.jpg'

          const posterBlurhash =
            episodeData?.thumbnailBlurhash || matchedShow.posterBlurhash || null

          const tvExternalRecord = {
            _id:
              video._id ||
              matchedShow._id?.toString() ||
              matchedShow.id ||
              `external-tv-${i}-${video.videoId}`,
            title: matchedShow.title || matchedShow.name || 'YouTube Trailer',
            seasonNumber: video.seasonNumber ?? null,
            seasons: [], // we don't have full season data here, but sanitizeRecord tolerates this
            posterURL,
            posterBlurhash,
            backdrop:
              matchedShow.backdrop || getFullImageUrl(matchedShow.metadata?.backdrop_path) || null,
            backdropBlurhash: matchedShow.backdropBlurhash || null,
            metadata: matchedShow.metadata || {},
            logo: matchedShow.logo || null,
            // Expose the raw video URL so consumers can launch YouTube
            url: video.videoId,
            isTrailer: true,
            episode: {
              showId: matchedShow._id?.toString() || null,
              seasonNumber: video.seasonNumber ?? 1,
              episodeNumber: video.episodeNumber ?? 1,
              videoURL: video.videoId,
              normalizedVideoId: video.normalizedVideoId || null,
              duration: episodeData?.duration || 0,
              thumbnail: posterURL,
              thumbnailBlurhash: posterBlurhash,
            },
          }

          const mergedContext = { ...context, lastWatchedVideo: video }
          const sanitizedTvExternal = await sanitizeRecord(tvExternalRecord, 'tv', mergedContext)

          results.push(sanitizedTvExternal)
          continue // Successfully processed, move to next video
        }
      }

      processingErrors.push({
        videoId: video.videoId,
        normalizedVideoId: video.normalizedVideoId || 'none',
        type: 'unknown',
        error: 'Video not found in movie or episode maps',
      })
    } catch (error) {
      processingErrors.push({
        videoId: video.videoId,
        normalizedVideoId: video.normalizedVideoId || 'none',
        type: 'exception',
        error: error.message || String(error),
      })

      if (Boolean(process.env.DEBUG) == true) {
        console.error(`[FLAT_DEBUG] Exception while processing video ${video.videoId}:`, error)
      }
      // Continue to next video regardless of errors
      continue
    }
  }

  // Log processing errors summary
  if (processingErrors.length > 0) {
    console.warn(`[FLAT_DEBUG] Processing completed with ${processingErrors.length} errors:`)
    processingErrors.forEach((error, index) => {
      console.warn(
        `[FLAT_DEBUG] Error ${index + 1}: ${error.videoId} (${error.type}): ${error.error}`
      )
    })
  }

  if (Boolean(process.env.DEBUG) == true) {
    console.log(`[PERF] Completed processFlatWatchedDetails with ${results.length} results`)
    console.timeEnd('processFlatWatchedDetails:total')
  }

  return results
}

/**
 * Get recently added media from flat database structure.
 *
 * @param {Object} params - Parameters for the function.
 * @param {number} [params.page=0] - The page number for pagination (0-based).
 * @param {number} [params.limit=12] - The number of items per page.
 * @param {boolean} [params.countOnly=false] - Whether to only get the document count.
 * @param {boolean} [params.shouldExposeAdditionalData=false] - Whether to expose additional data in the response ex. videoURL, duration
 * @param {string} [params.projection=null] - Projection profile name ('admin-overview', 'tv-device', 'standard', 'horizontal-list', 'full')
 * @param {Object} [params.contextHints={}] - Context hints for auto-selecting projection profile
 * @returns {Promise<Array|number>} Recently added media or count.
 */
export async function getFlatRecentlyAddedMedia({
  page = 0,
  limit = 15,
  countOnly = false,
  shouldExposeAdditionalData = false,
  projection = null,
  contextHints = {},
}) {
  try {
    if (Boolean(process.env.DEBUG) == true) {
      console.time('getFlatRecentlyAddedMedia:total')
      console.log(
        `[PERF] Starting getFlatRecentlyAddedMedia: page=${page}, limit=${limit}, countOnly=${countOnly}, projection=${projection}`
      )
    }

    const client = await clientPromise
    const db = client.db('Media')

    // Select appropriate projection profile based on parameters and context
    const selectedProfile = selectProjectionProfile(
      projection,
      shouldExposeAdditionalData,
      contextHints
    )

    if (Boolean(process.env.DEBUG) == true) {
      console.log(`[PERF] Selected projection profile: ${selectedProfile}`)
    }

    // Get dynamic projections based on selected profile
    const movieProjection = getProjectionForCollection(
      selectedProfile,
      'movies',
      shouldExposeAdditionalData
    )
    const episodeProjection = getProjectionForCollection(
      selectedProfile,
      'episodes',
      shouldExposeAdditionalData
    )
    const showProjection = getProjectionForCollection(
      selectedProfile,
      'shows',
      shouldExposeAdditionalData
    )

    // Add mediaLastModified to projections since it's needed for sorting
    const movieProjectionFields = {
      ...movieProjection,
      mediaLastModified: 1,
    }

    const episodeProjectionFields = {
      ...episodeProjection,
      mediaLastModified: 1,
      showId: 1, // Needed for grouping
    }

    if (Boolean(process.env.DEBUG) == true) {
      console.log(
        `[PERF] Using projections - Movies: ${Object.keys(movieProjectionFields).length} fields, Episodes: ${Object.keys(episodeProjectionFields).length} fields, Shows: ${Object.keys(showProjection).length} fields`
      )
    }

    // For non-count queries, get a larger pool of items to combine and paginate
    const poolSize = limit * 20 // Get more items to ensure we have enough after combination/sorting

    if (Boolean(process.env.DEBUG) == true) {
      console.time('getFlatRecentlyAddedMedia:fetchMovies')
    }

    // Get most recently added movies
    const movies = await db
      .collection('FlatMovies')
      .find({}, { projection: movieProjectionFields })
      .sort({ mediaLastModified: -1 })
      .limit(poolSize)
      .toArray()

    if (Boolean(process.env.DEBUG) == true) {
      console.timeEnd('getFlatRecentlyAddedMedia:fetchMovies')
      console.log(`[PERF] Found ${movies.length} recently added movies`)
      console.time('getFlatRecentlyAddedMedia:fetchTVShows')
    }

    // Get most recently added TV shows or episodes
    // First get the most recent episodes
    const recentEpisodes = await db
      .collection('FlatEpisodes')
      .aggregate([
        { $sort: { mediaLastModified: -1 } },
        { $limit: poolSize * 2 }, // Get more than needed to account for grouping
        {
          $group: {
            _id: '$showId',
            showId: { $first: '$showId' },
            episodeId: { $first: '$_id' },
            mediaLastModified: { $max: '$mediaLastModified' },
          },
        },
        { $sort: { mediaLastModified: -1 } },
        { $limit: poolSize },
      ])
      .toArray()

    // Get the corresponding TV shows with proper projection
    const tvShowIds = recentEpisodes.map((item) => item.showId)
    const tvShowsFromDb = await db
      .collection('FlatTVShows')
      .find(
        { _id: { $in: tvShowIds } },
        { projection: showProjection }
      )
      .toArray()

    // Create a map of showId to show data for efficient lookup
    const tvShowMap = new Map(tvShowsFromDb.map((show) => [show._id.toString(), show]))

    // Merge mediaLastModified from recentEpisodes with TV show data
    const tvShows = recentEpisodes
      .map((item) => {
        const show = tvShowMap.get(item.showId.toString())
        if (show) {
          return {
            ...show,
            mediaLastModified: item.mediaLastModified,
          }
        }
        return null
      })
      .filter(Boolean) // Remove null values

    if (Boolean(process.env.DEBUG) == true) {
      console.timeEnd('getFlatRecentlyAddedMedia:fetchTVShows')
      console.log(`[PERF] Found ${tvShows.length} recently added TV shows`)
    }

    if (countOnly) {
      // For "recently added", we cap the total items at a reasonable limit
      // This prevents too many pagination buttons from being shown
      const MAX_RECENTLY_ADDED_ITEMS = 100 // Cap at 100 items total

      // Get counts but with reasonable limits
      const [moviesCount, episodeGroupsCount] = await Promise.all([
        // Get count of movies, but no more than half our maximum
        db.collection('FlatMovies').countDocuments({}, { limit: MAX_RECENTLY_ADDED_ITEMS / 2 }),

        // Get count of unique TV shows with recent episodes, but no more than half our maximum
        db
          .collection('FlatEpisodes')
          .aggregate([
            { $sort: { mediaLastModified: -1 } },
            { $limit: 1000 }, // Look at the 1000 most recent episodes
            { $group: { _id: '$showId' } },
            { $count: 'total' },
          ])
          .toArray()
          .then((res) => Math.min(res[0]?.total || 0, MAX_RECENTLY_ADDED_ITEMS / 2)),
      ])

      // Return the sum, but never more than our maximum
      return Math.min(moviesCount + episodeGroupsCount, MAX_RECENTLY_ADDED_ITEMS)
    }

    // Add URLs to media
    const [moviesWithUrl, tvShowsWithUrl] = await Promise.all([
      addCustomUrlToFlatMedia(movies, 'movie', shouldExposeAdditionalData),
      addCustomUrlToFlatMedia(tvShows, 'tv', shouldExposeAdditionalData),
    ])

    // Arrange media by latest modification
    const arrangedMedia = arrangeMediaByLatestModification(moviesWithUrl, tvShowsWithUrl)

    // Apply pagination to the combined and arranged result
    // This ensures we maintain consistent pagination across all pages
    const validPage = Math.max(page, 0) // Ensure page is at least 0
    const startIndex = validPage * limit
    const endIndex = startIndex + limit

    // If we're requesting a page beyond what we have data for, return empty array
    if (startIndex >= arrangedMedia.length) {
      return []
    }

    // Get just the items for this page
    const paginatedMedia = arrangedMedia.slice(startIndex, endIndex)

    // Sanitize each item using the flexible sanitizeRecord function with appropriate context
    const contextObj = {
      dateContext: 'recentlyAdded',
      shouldExposeAdditionalData,
    }
    const sanitizedMedia = await Promise.all(
      paginatedMedia.map(async (media) =>
        // Use the flexible sanitizeRecord function with context
        sanitizeRecord(media, media.type, contextObj)
      )
    )

    return sanitizedMedia
  } catch (error) {
    console.error(`Error in getFlatRecentlyAddedMedia: ${error.message}`)
    throw error
  }
}

/**
 * Fetch the latest movies for the banner from the flat database structure.
 *
 * @returns {Promise<Array|Object>} An array of the latest 8 movie objects or an error object.
 */
export const fetchFlatBannerMedia = async () => {
  try {
    const client = await clientPromise
    const db = client.db('Media')

    const media = await db
      .collection('FlatMovies') // Use FlatMovies collection
      .find({})
      .sort({ 'metadata.release_date': -1 }) // Sort by release date descending
      .limit(8) // Limit to 8 movies
      .toArray()

    if (!media || media.length === 0) {
      return { error: 'No media found for banner', status: 404 }
    }

    // Process items: ensure backdrop URL and remove _id
    const processedMedia = media.map((item) => {
      const processedItem = { ...item } // Clone item
      if (processedItem && !processedItem.backdrop && processedItem.metadata?.backdrop_path) {
        processedItem.backdrop = getFullImageUrl(processedItem.metadata.backdrop_path, 'original')
      }
      if (processedItem && processedItem._id) {
        processedItem.id = processedItem._id.toString() // Add string id
        delete processedItem._id // Remove ObjectId
      }
      return processedItem
    })

    return processedMedia // Return the array of processed media objects
  } catch (error) {
    console.error(`Error in fetchFlatBannerMedia: ${error.message}`)
    return { error: 'Failed to fetch banner media', details: error.message, status: 500 }
  }
}

/**
 * Fetch a random banner media from flat database structure.
 * Uses the "bias method" with indexed skip/limit instead of $sample to avoid COLLSCAN.
 *
 * @returns {Promise<Object>} A randomly selected banner media.
 */
export const fetchFlatRandomBannerMedia = async () => {
  try {
    const client = await clientPromise
    const db = client.db('Media')

    // Define your collections along with the type you want to assign
    const collectionConfigs = [
      { name: 'FlatMovies', type: 'movie' },
      { name: 'FlatTVShows', type: 'tv' },
    ]

    // Pick one config at random
    const { name: collectionName, type } =
      collectionConfigs[Math.floor(Math.random() * collectionConfigs.length)]

    const collection = db.collection(collectionName)

    // Get the total count of documents (use an indexed field for efficiency)
    const totalCount = await collection.countDocuments()

    if (totalCount === 0) {
      return { error: 'No media found', status: 404 }
    }

    // Use the "bias method": pick a random offset and use skip/limit with an indexed field
    // This is much more efficient than $sample as it uses indexes instead of COLLSCAN
    const randomOffset = Math.floor(Math.random() * totalCount)

    // Use find with _id index for consistent ordering, skip and limit
    const [item] = await collection.find({}).skip(randomOffset).limit(1).toArray()

    if (!item) {
      return { error: 'No media found', status: 404 }
    }

    // Ensure we have a backdrop URL
    if (!item.backdrop && item.metadata?.backdrop_path) {
      item.backdrop = getFullImageUrl(item.metadata.backdrop_path, 'original')
    }

    // Directly assign the type from our config
    item.type = type

    return item
  } catch (error) {
    console.error('fetchFlatRandomBannerMedia error:', error)
    return { error: 'Failed to fetch media', status: 500 }
  }
}

/**
 * Helper function to find a TV show by title or originalTitle.
 * Tries title first, then originalTitle if not found.
 *
 * @param {Object} db - MongoDB database instance.
 * @param {string} searchTitle - The title to search for.
 * @returns {Promise<Object|null>} The TV show with foundByOriginalTitle flag if found via originalTitle.
 */
async function findTVShowByTitleOrOriginal(db, searchTitle) {
  // First try to find by title
  let tvShow = await db.collection('FlatTVShows').findOne({ title: searchTitle })

  if (!tvShow) {
    // If not found, try by originalTitle
    tvShow = await db.collection('FlatTVShows').findOne({ originalTitle: searchTitle })
    if (tvShow) {
      // Return with a flag indicating it was found by originalTitle
      return { ...tvShow, foundByOriginalTitle: true }
    }
  }

  return tvShow
}

/**
 * Gets requested media from the flat database structure.
 * This function is a replacement for getRequestedMedia but uses the flat database collections.
 *
 * @param {Object} params - Parameters for fetching media.
 * @param {string} params.type - The type of media (movie or tv).
 * @param {string} [params.title] - The title of the media.
 * @param {string} [params.id] - The ID of the media (alternative to title).
 * @param {string} [params.season] - The season number (for TV shows).
 * @param {string} [params.episode] - The episode number (for TV shows with season).
 * @returns {Promise<Object|null>} The requested media or null if not found.
 */
export async function getFlatRequestedMedia({
  type,
  title = null,
  season = null,
  episode = null,
  id = null,
}) {
  try {
    if (Boolean(process.env.DEBUG) == true) {
      console.time('getFlatRequestedMedia:total')
      console.log(
        `[PERF] Fetching ${type} media: title=${title}, id=${id}, season=${season}, episode=${episode}`
      )
    }

    const client = await clientPromise
    const db = client.db('Media')

    if (type === 'movie') {
      if (Boolean(process.env.DEBUG) == true) {
        console.time('getFlatRequestedMedia:fetchMovie')
      }

      // Build query
      const query = {}
      if (title) query.title = title

      // Only treat id as a database ObjectId if it is valid; otherwise ignore it.
      const hasValidObjectId = id && ObjectId.isValid(id)
      if (hasValidObjectId) {
        query._id = new ObjectId(id)
      }

      // If we have neither a title nor a valid ObjectId, there is no way
      // to resolve this to an internal flat-media record (e.g., external IDs).
      if (!title && !hasValidObjectId) {
        if (Boolean(process.env.DEBUG) == true) {
          console.timeEnd('getFlatRequestedMedia:total')
        }
        return null
      }

      // Fetch movie
      const movie = await db.collection('FlatMovies').findOne(query)

      if (!movie) {
        if (Boolean(process.env.DEBUG) == true) {
          console.timeEnd('getFlatRequestedMedia:fetchMovie')
          console.timeEnd('getFlatRequestedMedia:total')
        }
        return null
      }

      // Convert _id to string (consistent with TV shows)
      const result = {
        ...movie,
        _id: movie._id.toString(),
        type: 'movie',
      }

      // Add cast data if available
      if (result.metadata?.cast) {
        result.cast = result.metadata.cast
      }

      if (Boolean(process.env.DEBUG) == true) {
        console.timeEnd('getFlatRequestedMedia:fetchMovie')
        console.timeEnd('getFlatRequestedMedia:total')
      }

      return result
    } else if (type === 'tv') {
      if (Boolean(process.env.DEBUG) == true) {
        console.time('getFlatRequestedMedia:fetchTV')
      }

      const hasValidObjectId = id && ObjectId.isValid(id)

      if (!title && !hasValidObjectId) {
        if (Boolean(process.env.DEBUG) == true) {
          console.timeEnd('getFlatRequestedMedia:total')
        }
        return null
      }

      // Fetch TV show using enhanced search (title first, then originalTitle)
      let tvShow
      let foundByOriginalTitle = false

      if (title) {
        // Use the helper function for title-based search
        const searchResult = await findTVShowByTitleOrOriginal(db, title)
        if (searchResult) {
          tvShow = searchResult
          foundByOriginalTitle = searchResult.foundByOriginalTitle || false
        }
      } else if (hasValidObjectId) {
        // Direct ID search for when using ObjectId
        tvShow = await db.collection('FlatTVShows').findOne({ _id: new ObjectId(id) })
      }

      if (!tvShow) {
        if (Boolean(process.env.DEBUG) == true) {
          console.timeEnd('getFlatRequestedMedia:fetchTV')
          console.timeEnd('getFlatRequestedMedia:total')
        }
        return null
      }

      // Basic TV show data (no season/episode specified)
      if (!season) {
        // Get all seasons for this show
        const seasons = await db
          .collection('FlatSeasons')
          .find({ showId: tvShow._id })
          .sort({ seasonNumber: 1 })
          .toArray()

        // Convert _id to string id
        const result = {
          ...tvShow,
          _id: tvShow._id.toString(),
          type: 'tv',
          seasons: seasons.map((season) => ({
            ...season,
            _id: season._id.toString(),
            showId: season.showId.toString(),
            seasonNumber: season.seasonNumber,
          })),
        }

        if (foundByOriginalTitle) {
          result.foundByOriginalTitle = foundByOriginalTitle // Indicate it was found by originalTitle
        }

        // Add cast data if available
        if (result.metadata?.cast) {
          // Collect all guest stars from episodes
          const compiledGuestStarsMap = new Map()

          // First fetch all episodes with guest stars
          const episodes = await db
            .collection('FlatEpisodes')
            .find({
              showId: new ObjectId(result.id),
              'metadata.guest_stars': { $exists: true, $ne: [] },
            })
            .project({ 'metadata.guest_stars': 1 })
            .toArray()

          // Process guest stars
          episodes.forEach((episode) => {
            if (episode.metadata?.guest_stars) {
              episode.metadata.guest_stars.forEach((castMember) => {
                if (!compiledGuestStarsMap.has(castMember.id)) {
                  compiledGuestStarsMap.set(castMember.id, castMember)
                }
              })
            }
          })

          // Combine the main cast with the unique guest stars
          const uniqueGuestStars = Array.from(compiledGuestStarsMap.values())
          result.cast = [...(result.metadata.cast || []), ...uniqueGuestStars]

          // Ensure all cast members are unique based on ID
          const uniqueCastMap = new Map()
          result.cast.forEach((castMember) => {
            if (!uniqueCastMap.has(castMember.id)) {
              uniqueCastMap.set(castMember.id, castMember)
            }
          })
          result.cast = Array.from(uniqueCastMap.values())
        }

        if (Boolean(process.env.DEBUG) == true) {
          console.timeEnd('getFlatRequestedMedia:fetchTV')
          console.timeEnd('getFlatRequestedMedia:total')
        }

        return result
      }
      // Season specified
      else {
        const seasonNumber = parseInt(season.replace('Season ', ''))
        const seasonData = await db.collection('FlatSeasons').findOne({
          showId: tvShow._id,
          seasonNumber: seasonNumber,
        })

        if (!seasonData) {
          if (Boolean(process.env.DEBUG) == true) {
            console.timeEnd('getFlatRequestedMedia:fetchTV')
            console.timeEnd('getFlatRequestedMedia:total')
          }
          return null
        }

        // Just season (no episode)
        if (!episode) {
          const result = {
            ...seasonData,
            id: seasonData._id.toString(),
            showId: seasonData.showId.toString(),
            title: tvShow.title,
            originalTitle: tvShow.originalTitle,
            type: 'tv',
            metadata: {
              ...(seasonData.metadata || {}),
              tvOverview: tvShow.metadata?.overview,
              trailer_url: tvShow.metadata?.trailer_url,
            },
            posterURL:
              seasonData.posterURL ||
              tvShow.posterURL ||
              getFullImageUrl(tvShow.metadata?.poster_path),
          }
          delete result._id

          if (foundByOriginalTitle) {
            result.foundByOriginalTitle = foundByOriginalTitle
          }

          if (Boolean(process.env.DEBUG) == true) {
            console.timeEnd('getFlatRequestedMedia:fetchTV')
            console.timeEnd('getFlatRequestedMedia:total')
          }

          return result
        }
        // Episode specified
        else {
          const episodeNumber = parseInt(episode.replace('Episode ', ''))
          const episodeData = await db.collection('FlatEpisodes').findOne({
            showId: tvShow._id,
            seasonId: seasonData._id,
            episodeNumber: episodeNumber,
          })

          if (!episodeData) {
            if (Boolean(process.env.DEBUG) == true) {
              console.timeEnd('getFlatRequestedMedia:fetchTV')
              console.timeEnd('getFlatRequestedMedia:total')
            }
            return null
          }

          // Get next episode (if available)
          const nextEpisode = await db.collection('FlatEpisodes').findOne(
            {
              showId: tvShow._id,
              seasonId: seasonData._id,
              episodeNumber: { $gt: episodeNumber },
            },
            {
              sort: { episodeNumber: 1 },
              projection: {
                _id: 1,
                normalizedVideoId: 1,
                episodeNumber: 1,
                title: 1,
                thumbnail: 1,
                metadata: 1,
              },
            }
          )

          const result = {
            ...episodeData,
            _id: episodeData._id.toString(),
            showId: episodeData.showId.toString(),
            showTitle: tvShow.title,
            // Add parent show data for watchlist functionality
            showMediaId: tvShow._id.toString(),
            showTmdbId: tvShow.metadata?.id,
            // Season data
            seasonId: episodeData.seasonId.toString(),
            title: episodeData.title, // Use episode title
            originalTitle: tvShow.originalTitle,
            logo: tvShow.logo,
            seasonNumber: seasonNumber,
            episodeNumber: episodeNumber,
            type: 'tv',
            posterURL:
              seasonData.posterURL ||
              tvShow.posterURL ||
              getFullImageUrl(tvShow.metadata?.poster_path),
            posterBlurhash: seasonData.posterBlurhash || tvShow.posterBlurhash || null,
            // Add episode's thumbnail as both thumbnail and backdrop
            thumbnail: episodeData.thumbnail || null,
            thumbnailSource: episodeData.thumbnailSource || null,
            thumbnailBlurhash: episodeData.thumbnailBlurhash || null,
            thumbnailBlurhashSource: episodeData.thumbnailBlurhashSource || null,
            // Set backdrop from thumbnail or show backdrop
            backdrop: episodeData.thumbnail || tvShow.backdrop,
            backdropSource: episodeData.thumbnailSource || tvShow.backdropSource,
            backdropBlurhash: episodeData.thumbnailBlurhash || tvShow.backdropBlurhash,
            backdropBlurhashSource:
              episodeData.thumbnailBlurhashSource || tvShow.backdropBlurhashSource,
            metadata: {
              ...(episodeData.metadata || {}),
              backdrop_path: episodeData.metadata?.backdrop_path || tvShow.metadata?.backdrop_path,
              rating: tvShow.metadata?.rating || null,
              trailer_url: tvShow.metadata?.trailer_url || null,
            },
          }

          if (foundByOriginalTitle) {
            result.foundByOriginalTitle = foundByOriginalTitle
          }

          // Handle next episode info
          if (nextEpisode) {
            result.hasNextEpisode = true
            result.nextEpisodeThumbnail =
              nextEpisode.thumbnail ||
              nextEpisode.metadata?.still_path ||
              seasonData.posterURL ||
              tvShow.posterURL ||
              getFullImageUrl(tvShow.metadata?.poster_path) ||
              null
            result.nextEpisodeThumbnailBlurhash = nextEpisode.thumbnailBlurhash
              ? `data:image/png;base64,${nextEpisode.thumbnailBlurhash}`
              : null
            result.nextEpisodeTitle = nextEpisode.title || nextEpisode.metadata?.name || null
            result.nextEpisodeNumber = nextEpisode.episodeNumber

            // determine which thumbnail is used; then based on that set the blurhash
            if (result.nextEpisodeThumbnailBlurhash == null) {
              if (result.nextEpisodeThumbnail === tvShow.posterURL && tvShow.posterBlurhash) {
                result.nextEpisodeThumbnailBlurhash = `data:image/png;base64,${tvShow.posterBlurhash}`
              } else if (
                result.nextEpisodeThumbnail === seasonData.posterURL &&
                seasonData.posterBlurhash
              ) {
                result.nextEpisodeThumbnailBlurhash = `data:image/png;base64,${seasonData.posterBlurhash}`
              } else {
                delete result.nextEpisodeThumbnailBlurhash // Remove if not set
              }
            }
          } else {
            result.hasNextEpisode = false
          }

          // Handle cast data - keep cast and guestStars separate
          if (tvShow.metadata?.cast) {
            const guestStars = episodeData.metadata?.guest_stars || []
            const mainCast = tvShow.metadata.cast || []

            // Create a map of guest stars for quick lookup
            const guestStarsMap = new Map(guestStars.map((star) => [star.id, star]))

            // Filter out guest stars from the main cast to avoid duplicates
            const filteredMainCast = mainCast.filter(
              (castMember) => !guestStarsMap.has(castMember.id)
            )

            // Keep cast and guestStars separate
            result.cast = filteredMainCast
            result.guestStars = guestStars
          }

          if (Boolean(process.env.DEBUG) == true) {
            console.timeEnd('getFlatRequestedMedia:fetchTV')
            console.timeEnd('getFlatRequestedMedia:total')
          }

          return result
        }
      }
    }

    return null
  } catch (error) {
    console.error(`Error in getFlatRequestedMedia: ${error.message}`)
    if (Boolean(process.env.DEBUG) == true) {
      console.timeEnd('getFlatRequestedMedia:total')
    }
    throw error
  }
}

// Helper function to get trailer media
export async function getTrailerMedia(type, title) {
  // Get the media and extract trailer information
  const media = await getFlatRequestedMedia({
    type: type,
    title: decodeURIComponent(title),
  })

  if (media && media.metadata?.trailer_url) {
    // Create a new object with trailer information
    // Don't override normalizedVideoId - let it be generated from the actual videoURL (YouTube)
    // so each different trailer gets a unique WatchHistory entry
    return {
      ...media,
      videoURL: media.metadata.trailer_url,
      isTrailer: true,
    }
  }

  return null
}

// Function to get the count and total duration of available movies in the flat database
export async function getFlatAvailableMoviesCount() {
  try {
    const client = await clientPromise
    const result = await client
      .db('Media')
      .collection('FlatMovies')
      .aggregate([
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            totalDuration: { $sum: { $ifNull: ['$duration', 0] } },
          },
        },
      ])
      .toArray()

    return {
      count: result.length > 0 ? result[0].count : 0,
      totalDuration: result.length > 0 ? result[0].totalDuration : 0,
    }
  } catch (error) {
    console.error('Error fetching movie count and duration:', error)
    return { count: 0, totalDuration: 0 }
  }
}

// Function to get the last updated timestamp for movies in the flat database
export async function getFlatMoviesLastUpdatedTimestamp() {
  try {
    const client = await clientPromise
    const result = await client
      .db('Media')
      .collection('FlatMovies')
      .find({})
      .sort({ mediaLastModified: -1 })
      .limit(1)
      .toArray()

    return result.length > 0 && result[0].mediaLastModified
      ? new Date(result[0].mediaLastModified).getTime()
      : Date.now()
  } catch (error) {
    console.error('Error fetching last updated timestamp:', error)
    return Date.now()
  }
}

/**
 * Gets all TV shows for the TV list page using the flat database structure.
 * This function is optimized for the TVList component with minimal projection fields.
 *
 * @param {Object} [options] - Optional parameters
 * @param {number} [options.page=0] - Page number for pagination (0-based)
 * @param {number} [options.limit=0] - Optional limit for number of records to return (0 = no limit)
 * @param {boolean} [options.sort=true] - Whether to sort by last air date
 * @returns {Promise<Array>} Array of TV shows with fields needed by the TVList component
 */
export async function getFlatTVList(options = {}) {
  const { page = 0, limit = 0, sort = true } = options

  try {
    const client = await clientPromise

    // Define minimal projection for TV list view
    const projection = {
      _id: 1,
      title: 1,
      posterURL: 1,
      posterBlurhash: 1,
      posterBlurhashSource: 1,
      metadata: 1,
    }

    // Setup query options with pagination
    const queryOptions = { projection }
    if (limit > 0) {
      const skip = page * limit // Calculate offset for pagination
      queryOptions.limit = limit
      queryOptions.skip = skip // Add skip for pagination
    }

    // Fetch TV shows from flat database
    let tvShows = await client
      .db('Media')
      .collection('FlatTVShows')
      .find({}, queryOptions)
      .toArray()

    // Sort by last air date if requested
    if (sort) {
      tvShows.sort((a, b) => {
        const dateA = new Date(a.metadata?.last_air_date || 0)
        const dateB = new Date(b.metadata?.last_air_date || 0)
        return dateB - dateA // Descending order (newest first)
      })
    }

    // Process TV shows and fetch seasons for each show
    return await Promise.all(
      tvShows.map(async (tvShow) => {
        // Ensure we have a poster URL
        const posterURL =
          tvShow.posterURL ||
          (tvShow.metadata?.poster_path ? getFullImageUrl(tvShow.metadata.poster_path) : null) ||
          '/sorry-image-not-available.jpg'

        // Get show ID as string for queries
        const showId = tvShow._id.toString()

        // Fetch all seasons for this TV show
        const seasons = await client
          .db('Media')
          .collection('FlatSeasons')
          .find({ showId: tvShow._id })
          .sort({ seasonNumber: 1 })
          .toArray()

        // For each season, create a properly serialized version with episode information
        const seasonsWithEpisodes = await Promise.all(
          seasons.map(async (season) => {
            // Get the season ID as a string for the episode query
            const seasonId = season._id.toString()

            // Just get episode count for each season, which is safer for serialization
            const episodeCount = await client
              .db('Media')
              .collection('FlatEpisodes')
              .countDocuments({ seasonId: season._id })

            // Get minimal dimension and HDR data for this season's episodes
            // We'll use aggregation to get just the specific fields we need
            const episodeStats = await client
              .db('Media')
              .collection('FlatEpisodes')
              .find(
                { seasonId: season._id },
                {
                  projection: {
                    _id: 1,
                    normalizedVideoId: 1,
                    episodeNumber: 1,
                    dimensions: 1,
                    hdr: 1,
                  },
                }
              )
              .toArray()

            // Create our serialized episode objects
            let serializedEpisodes = episodeStats.map((episode) => ({
              _id: episode._id.toString(),
              episodeNumber: episode.episodeNumber,
              dimensions: episode.dimensions || '0x0', // Ensure we have a dimension string
              hdr: episode.hdr || false,
            }))

            // If no episodes were found, create a placeholder array
            if (serializedEpisodes.length === 0) {
              serializedEpisodes = Array(episodeCount).fill({
                dimensions: '0x0',
                hdr: false,
              })
            }

            // Return a serialized season object with its episodes
            return {
              _id: seasonId,
              seasonNumber: season.seasonNumber,
              title: season.title || null,
              episodes: serializedEpisodes,
            }
          })
        )

        // Return a fully serialized TV show object
        return {
          _id: showId,
          id: showId,
          title: tvShow.title,
          posterURL: posterURL,
          posterBlurhash: tvShow.posterBlurhash || null,
          metadata: tvShow.metadata || {},
          link: encodeURIComponent(tvShow.title) || null,
          type: 'tv',
          seasons: seasonsWithEpisodes,
        }
      })
    )
  } catch (error) {
    console.error(`Error in getFlatTVList: ${error.message}`)
    throw error
  }
}

/**
 * Get the count and total duration of available TV episodes in the flat database.
 *
 * @returns {Promise<Object>} Object containing count and totalDuration.
 */
export async function getFlatAvailableTVShowsCount() {
  try {
    const client = await clientPromise

    // For TV shows, we need to get the sum of all episodes' durations
    const result = await client
      .db('Media')
      .collection('FlatEpisodes')
      .aggregate([
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            totalDuration: { $sum: { $ifNull: ['$duration', 0] } },
          },
        },
      ])
      .toArray()

    // Also get the count of TV shows for the UI
    const showCount = await client.db('Media').collection('FlatTVShows').countDocuments()

    return {
      count: showCount,
      episodeCount: result.length > 0 ? result[0].count : 0,
      totalDuration: result.length > 0 ? result[0].totalDuration : 0,
    }
  } catch (error) {
    console.error('Error fetching TV shows count and duration:', error)
    return { count: 0, episodeCount: 0, totalDuration: 0 }
  }
}

/**
 * Count unique users who have watched a specific media by its normalized video id.
 * This function searches through the WatchHistory collection to find all users
 * who have a video with the matching normalizedVideoId in their watched history.
 *
 * @param {string} normalizedVideoId - The normalized video ID to search for
 * @returns {Promise<number>} The count of unique users who have watched this media
 */
export async function countUniqueViewersByNormalizedId(normalizedVideoId) {
  try {
    if (Boolean(process.env.DEBUG) == true) {
      console.time('countUniqueViewersByNormalizedId:total')
      console.log(`[PERF] Counting unique viewers for normalizedVideoId: ${normalizedVideoId}`)
    }

    const client = await clientPromise

    // Query WatchHistory collection - much faster, no array operations or locks
    // Each document = one user+video pair, so simple distinct query on userId
    const result = await client
      .db('Media')
      .collection('WatchHistory')
      .aggregate([
        // Match videos with this normalizedVideoId and valid status
        {
          $match: {
            normalizedVideoId: normalizedVideoId,
            isValid: { $ne: false }, // Only count valid entries
          },
        },
        // Count distinct users
        {
          $group: {
            _id: null,
            uniqueViewers: { $sum: 1 },
            uniqueUserCount: { $addToSet: '$userId' },
          },
        },
        // Get the actual count of unique users
        {
          $project: {
            _id: 0,
            uniqueViewers: { $size: '$uniqueUserCount' },
          },
        },
      ])
      .toArray()

    const viewerCount = result.length > 0 ? result[0].uniqueViewers : 0

    if (Boolean(process.env.DEBUG) == true) {
      console.timeEnd('countUniqueViewersByNormalizedId:total')
      console.log(
        `[PERF] Found ${viewerCount} unique viewers for normalizedVideoId: ${normalizedVideoId}`
      )
    }

    return viewerCount
  } catch (error) {
    console.error(`Error in countUniqueViewersByNormalizedId: ${error.message}`)
    if (Boolean(process.env.DEBUG) == true) {
      console.timeEnd('countUniqueViewersByNormalizedId:total')
    }
    return 0
  }
}

/**
 * Get the last updated timestamp for TV shows in the flat database.
 * This function checks both TV shows and episodes to find the most recent update.
 *
 * @returns {Promise<number>} The timestamp of the most recent update.
 */
export async function getFlatTVShowsLastUpdatedTimestamp() {
  try {
    const client = await clientPromise

    // First, check the latest TV show update
    const tvShowsResult = await client
      .db('Media')
      .collection('FlatTVShows')
      .find({})
      .sort({ mediaLastModified: -1 })
      .limit(1)
      .toArray()

    // Then check the latest episode update
    const episodesResult = await client
      .db('Media')
      .collection('FlatEpisodes')
      .find({})
      .sort({ mediaLastModified: -1 })
      .limit(1)
      .toArray()

    // Compare both timestamps and return the most recent one
    const tvShowTimestamp =
      tvShowsResult.length > 0 && tvShowsResult[0].mediaLastModified
        ? new Date(tvShowsResult[0].mediaLastModified).getTime()
        : 0

    const episodeTimestamp =
      episodesResult.length > 0 && episodesResult[0].mediaLastModified
        ? new Date(episodesResult[0].mediaLastModified).getTime()
        : 0

    // Return the most recent timestamp or current time if none found
    return Math.max(tvShowTimestamp, episodeTimestamp) || Date.now()
  } catch (error) {
    console.error('Error fetching TV shows last updated timestamp:', error)
    return Date.now()
  }
}

/**
 * Get TV season details with its episodes from the flat database structure.
 * This function is specifically designed for the TVEpisodesListComponent.
 *
 * @param {Object} params - Parameters for fetching the season.
 * @param {string} params.showTitle - The title of the TV show. (not originalTitle)
 * @param {number} params.seasonNumber - The season number.
 * @returns {Promise<Object|null>} The season with its episodes or null if not found.
 */
export async function getFlatTVSeasonWithEpisodes({ showTitle, seasonNumber }) {
  try {
    if (Boolean(process.env.DEBUG) == true) {
      console.time('getFlatTVSeasonWithEpisodes:total')
    }

    const client = await clientPromise
    const db = client.db('Media')

    // First, get the TV show
    const tvShow = await getFlatRequestedMedia({
      type: 'tv',
      title: showTitle,
    })

    if (!tvShow) {
      if (Boolean(process.env.DEBUG) == true) {
        console.timeEnd('getFlatTVSeasonWithEpisodes:total')
      }
      return null
    }

    // From the TV show, find the requested season to get its ID
    const matchingSeason = tvShow.seasons.find((s) => s.seasonNumber === parseInt(seasonNumber))

    if (!matchingSeason) {
      if (Boolean(process.env.DEBUG) == true) {
        console.timeEnd('getFlatTVSeasonWithEpisodes:total')
      }
      return null
    }

    // Get the full season details
    const season = await getFlatRequestedMedia({
      type: 'tv',
      title: tvShow.title,
      season: `Season ${seasonNumber}`,
    })

    if (!season) {
      if (Boolean(process.env.DEBUG) == true) {
        console.timeEnd('getFlatTVSeasonWithEpisodes:total')
      }
      return null
    }

    // Fetch episodes for this season from the flat database
    const episodes = await db
      .collection('FlatEpisodes')
      .find({
        seasonId: new ObjectId(matchingSeason._id),
      })
      .sort({ episodeNumber: 1 })
      .toArray()

    if (Boolean(process.env.DEBUG) == true) {
      console.log(
        `[PERF] Found ${episodes.length} episodes for season ${seasonNumber} of "${showTitle}"`
      )
    }

    // Add episodes to the season object with proper ID conversions and clip URLs
    season.episodes = episodes.map((episode) => {
      const episodeObj = {
        ...episode,
        _id: episode._id.toString(),
        showId: episode.showId.toString(),
        seasonId: episode.seasonId.toString(),
        // Generate and add the clip URL
        clipVideoURL: generateClipVideoURL(episode, 'tv', tvShow.originalTitle || tvShow.title),
      }

      return episodeObj
    })

    // Set basic info about the parent TV show for the component
    season.showTitle = tvShow.title

    if (Boolean(process.env.DEBUG) == true) {
      console.timeEnd('getFlatTVSeasonWithEpisodes:total')
    }

    return season
  } catch (error) {
    console.error(`Error in getFlatTVSeasonWithEpisodes: ${error.message}`)
    if (Boolean(process.env.DEBUG) == true) {
      console.timeEnd('getFlatTVSeasonWithEpisodes:total')
    }
    throw error
  }
}

/**
 * Get TV shows with episode data for TV device mode.
 * For each TV show, gets the last episode the user watched, or the first episode if they haven't watched anything.
 *
 * @param {string} userId - The user ID to check watch history for
 * @param {number} page - Page number for pagination (0-based)
 * @param {number} limit - Number of items per page
 * @returns {Promise<Array>} Array of TV shows enhanced with episode data
 */
export async function getFlatTVShowsWithEpisodeData(userId, page = 0, limit = 15) {
  try {
    const client = await clientPromise
    const db = client.db('Media')

    // Get TV shows with pagination
    const skip = page * limit
    const tvShows = await db.collection('FlatTVShows').find({}).skip(skip).limit(limit).toArray()

    // Get user's watch history for TV episodes from WatchHistory collection
    const userObjectId = typeof userId === 'object' ? userId : new ObjectId(userId)
    const watchHistoryDocs = await db
      .collection('WatchHistory')
      .find({ userId: userObjectId, isValid: { $ne: false } })
      .toArray()

    // Create a map of watched episodes by show with enhanced metadata-based logic
    const watchedEpisodesByShow = new Map()
    if (watchHistoryDocs && watchHistoryDocs.length > 0) {
      // Filter for TV shows with metadata (showId present)
      const videosWithMetadata = watchHistoryDocs.filter(
        (video) => video.mediaType === 'tv' && video.showId
      )
      const videosWithoutMetadata = watchHistoryDocs.filter(
        (video) => !video.mediaType || video.mediaType !== 'tv' || !video.showId
      )

      // Process videos with metadata (new enhanced schema)
      if (videosWithMetadata.length > 0) {
        // Group by show and find the highest season/episode watched for each show
        videosWithMetadata.forEach((watchedVideo) => {
          const showId = watchedVideo.showId.toString()
          const seasonNumber = watchedVideo.seasonNumber || 1
          const episodeNumber = watchedVideo.episodeNumber || 1

          if (
            !watchedEpisodesByShow.has(showId) ||
            seasonNumber > watchedEpisodesByShow.get(showId).seasonNumber ||
            (seasonNumber === watchedEpisodesByShow.get(showId).seasonNumber &&
              episodeNumber > watchedEpisodesByShow.get(showId).episodeNumber)
          ) {
            watchedEpisodesByShow.set(showId, {
              showId: watchedVideo.showId,
              seasonNumber,
              episodeNumber,
              lastWatched: watchedVideo.lastUpdated,
              hasMetadata: true,
            })
          }
        })
      }

      // Fallback: Process videos without metadata (legacy approach)
      if (videosWithoutMetadata.length > 0) {
        const watchedVideoIds = videosWithoutMetadata.map((video) => video.videoId)

        const watchedEpisodes = await db
          .collection('FlatEpisodes')
          .find({ videoURL: { $in: watchedVideoIds } })
          .toArray()

        // Group by show and find the most recently watched episode for each show (legacy logic)
        watchedEpisodes.forEach((episode) => {
          const showId = episode.showId.toString()
          const watchedVideo = videosWithoutMetadata.find((v) => v.videoId === episode.videoURL)

          // Only use legacy logic if we don't already have metadata-based info for this show
          if (watchedVideo && !watchedEpisodesByShow.has(showId)) {
            watchedEpisodesByShow.set(showId, {
              episode,
              lastWatched: watchedVideo.lastUpdated,
              hasMetadata: false,
            })
          }
        })
      }
    }

    // For each TV show, get the appropriate episode
    const tvShowsWithEpisodes = await Promise.all(
      tvShows.map(async (tvShow) => {
        const showId = tvShow._id.toString()
        let episodeToUse = null

        // Check if user has watched any episodes of this show
        if (watchedEpisodesByShow.has(showId)) {
          const watchedInfo = watchedEpisodesByShow.get(showId)

          if (watchedInfo.hasMetadata) {
            // Use enhanced metadata to find the next episode to watch
            const lastWatchedSeason = watchedInfo.seasonNumber
            const lastWatchedEpisode = watchedInfo.episodeNumber

            // Try to find the next episode in the same season
            let nextEpisode = await db.collection('FlatEpisodes').findOne({
              showId: tvShow._id,
              seasonNumber: lastWatchedSeason,
              episodeNumber: lastWatchedEpisode + 1,
            })

            // If no next episode in current season, try first episode of next season
            if (!nextEpisode) {
              nextEpisode = await db.collection('FlatEpisodes').findOne(
                {
                  showId: tvShow._id,
                  seasonNumber: { $gt: lastWatchedSeason },
                },
                {
                  sort: { seasonNumber: 1, episodeNumber: 1 },
                }
              )
            }

            // If still no next episode found, fall back to the last watched episode
            if (!nextEpisode) {
              nextEpisode = await db.collection('FlatEpisodes').findOne({
                showId: tvShow._id,
                seasonNumber: lastWatchedSeason,
                episodeNumber: lastWatchedEpisode,
              })
            }

            episodeToUse = nextEpisode
          } else {
            // Legacy approach: use the most recently watched episode
            episodeToUse = watchedInfo.episode
          }
        } else {
          // Get the first episode of the first season
          const firstSeason = await db
            .collection('FlatSeasons')
            .findOne({ showId: tvShow._id }, { sort: { seasonNumber: 1 } })

          if (firstSeason) {
            episodeToUse = await db
              .collection('FlatEpisodes')
              .findOne({ seasonId: firstSeason._id }, { sort: { episodeNumber: 1 } })
          }
        }

        if (episodeToUse) {
          return {
            ...tvShow,
            type: 'tv',
            videoURL: episodeToUse.videoURL,
            duration: episodeToUse.duration,
            // Keep episode reference for potential future use
            episodeData: {
              episodeNumber: episodeToUse.episodeNumber,
              seasonId: episodeToUse.seasonId,
              seasonNumber: episodeToUse.seasonNumber,
              thumbnail:
                episodeToUse.thumbnail ||
                tvShow.posterURL ||
                getFullImageUrl(tvShow.metadata?.poster_path),
              thumbnailBlurhash: episodeToUse.thumbnailBlurhash || tvShow.posterBlurhash || null,
            },
          }
        }

        // If no episodes found, return the show without episode data
        return {
          ...tvShow,
          type: 'tv',
        }
      })
    )

    return tvShowsWithEpisodes
  } catch (error) {
    console.error(`Error in getFlatTVShowsWithEpisodeData: ${error.message}`)
    throw error
  }
}

/**
 * Get all available genres with metadata and counts from flat database structure.
 *
 * @param {Object} params - Parameters for the function.
 * @param {string} [params.type='all'] - Media type filter: 'movie', 'tv', 'all'.
 * @param {boolean} [params.includeCounts=true] - Whether to include content counts per genre.
 * @param {boolean} [params.countOnly=false] - Whether to only return the total genre count.
 * @returns {Promise<Array|Object|number>} Available genres with metadata or count.
 */
export async function getFlatAvailableGenres({
  type = 'all',
  includeCounts = true,
  countOnly = false,
} = {}) {
  try {
    if (Boolean(process.env.DEBUG) == true) {
      console.time('getFlatAvailableGenres:total')
      console.log(
        `[PERF] Getting available genres for type: ${type}, includeCounts: ${includeCounts}, countOnly: ${countOnly}`
      )
    }

    const client = await clientPromise
    const db = client.db('Media')

    // Determine which collections to query based on type
    const collections = []
    if (type === 'all' || type === 'movie') {
      collections.push({ name: 'FlatMovies', type: 'movie' })
    }
    if (type === 'all' || type === 'tv') {
      collections.push({ name: 'FlatTVShows', type: 'tv' })
    }

    if (countOnly) {
      // Get unique genre count across all specified collections
      const genreCountPromises = collections.map(async (collection) => {
        const pipeline = [
          { $unwind: '$metadata.genres' },
          { $group: { _id: '$metadata.genres.name' } },
          { $count: 'uniqueGenres' },
        ]

        const result = await db.collection(collection.name).aggregate(pipeline).toArray()
        return result.length > 0 ? result[0].uniqueGenres : 0
      })

      const counts = await Promise.all(genreCountPromises)
      // Use Set to get unique genres across collections
      const allGenresSet = new Set()

      for (const collection of collections) {
        const pipeline = [
          { $unwind: '$metadata.genres' },
          { $group: { _id: '$metadata.genres.name' } },
        ]

        const genres = await db.collection(collection.name).aggregate(pipeline).toArray()
        genres.forEach((genre) => allGenresSet.add(genre._id))
      }

      if (Boolean(process.env.DEBUG) == true) {
        console.timeEnd('getFlatAvailableGenres:total')
      }

      return allGenresSet.size
    }

    // Get detailed genre information with counts
    const genreDataMap = new Map()

    for (const collection of collections) {
      if (Boolean(process.env.DEBUG) == true) {
        console.time(`getFlatAvailableGenres:${collection.name}`)
      }

      const pipeline = [
        { $unwind: '$metadata.genres' },
        {
          $group: {
            _id: {
              id: '$metadata.genres.id',
              name: '$metadata.genres.name',
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { '_id.name': 1 } },
      ]

      const genreResults = await db.collection(collection.name).aggregate(pipeline).toArray()

      genreResults.forEach((result) => {
        const genreName = result._id.name
        const genreId = result._id.id
        const count = result.count

        if (!genreDataMap.has(genreName)) {
          genreDataMap.set(genreName, {
            id: genreId,
            name: genreName,
            movieCount: 0,
            tvShowCount: 0,
            totalCount: 0,
          })
        }

        const genreData = genreDataMap.get(genreName)
        if (collection.type === 'movie') {
          genreData.movieCount = count
        } else if (collection.type === 'tv') {
          genreData.tvShowCount = count
        }
        genreData.totalCount += count
      })

      if (Boolean(process.env.DEBUG) == true) {
        console.timeEnd(`getFlatAvailableGenres:${collection.name}`)
      }
    }

    // Convert map to sorted array
    const availableGenres = Array.from(genreDataMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    )

    if (!includeCounts) {
      // Return simplified genre list without counts
      const result = availableGenres.map((genre) => ({
        id: genre.id,
        name: genre.name,
      }))

      if (Boolean(process.env.DEBUG) == true) {
        console.timeEnd('getFlatAvailableGenres:total')
      }

      return result
    }

    // Get total media counts for summary
    const mediaTypeCounts = {
      movies: 0,
      tvShows: 0,
      total: 0,
    }

    if (type === 'all' || type === 'movie') {
      mediaTypeCounts.movies = await db.collection('FlatMovies').countDocuments()
    }
    if (type === 'all' || type === 'tv') {
      mediaTypeCounts.tvShows = await db.collection('FlatTVShows').countDocuments()
    }
    mediaTypeCounts.total = mediaTypeCounts.movies + mediaTypeCounts.tvShows

    const result = {
      availableGenres,
      totalGenres: availableGenres.length,
      mediaTypeCounts,
    }

    if (Boolean(process.env.DEBUG) == true) {
      console.log(`[PERF] Found ${availableGenres.length} unique genres`)
      console.timeEnd('getFlatAvailableGenres:total')
    }

    return result
  } catch (error) {
    console.error(`Error in getFlatAvailableGenres: ${error.message}`)
    if (Boolean(process.env.DEBUG) == true) {
      console.timeEnd('getFlatAvailableGenres:total')
    }
    throw error
  }
}

/**
 * Get content filtered by specific genres from flat database structure.
 *
 * @param {Object} params - Parameters for the function.
 * @param {Array<string>} params.genres - Array of genre names to filter by.
 * @param {string} [params.type='all'] - Media type filter: 'movie', 'tv', 'all'.
 * @param {number} [params.page=0] - Page number for pagination (0-based).
 * @param {number} [params.limit=30] - Number of items per page.
 * @param {string} [params.sort='newest'] - Sort method: 'newest', 'oldest', 'title', 'rating'.
 * @param {string} [params.sortOrder='desc'] - Sort direction: 'asc', 'desc'.
 * @param {boolean} [params.shouldExposeAdditionalData=false] - Whether to expose additional data for TV devices.
 * @param {string} [params.userId] - User ID for TV show episode data.
 * @param {boolean} [params.countOnly=false] - Whether to only return the count of matching items.
 * @returns {Promise<Array|number>} Filtered content or count.
 */
export async function getFlatContentByGenres({
  genres,
  type = 'all',
  page = 0,
  limit = 30,
  sort = 'newest',
  sortOrder = 'desc',
  shouldExposeAdditionalData = false,
  userId = null,
  countOnly = false,
} = {}) {
  try {
    if (Boolean(process.env.DEBUG) == true) {
      console.time('getFlatContentByGenres:total')
      console.log(
        `[PERF] Getting content by genres: ${genres.join(', ')}, type: ${type}, page: ${page}, limit: ${limit}`
      )
    }

    const client = await clientPromise
    const db = client.db('Media')

    // Validate genres parameter
    if (!genres || !Array.isArray(genres) || genres.length === 0) {
      throw new Error('Genres parameter must be a non-empty array')
    }

    // Build the genre filter query
    const genreQuery = {
      'metadata.genres.name': { $in: genres },
    }

    if (countOnly) {
      let totalCount = 0

      if (type === 'all' || type === 'movie') {
        totalCount += await db.collection('FlatMovies').countDocuments(genreQuery)
      }
      if (type === 'all' || type === 'tv') {
        totalCount += await db.collection('FlatTVShows').countDocuments(genreQuery)
      }

      if (Boolean(process.env.DEBUG) == true) {
        console.timeEnd('getFlatContentByGenres:total')
      }

      return totalCount
    }

    // Define sort mappings
    const sortMappings = {
      newest: { field: 'metadata.release_date', order: -1, tvField: 'metadata.first_air_date' },
      oldest: { field: 'metadata.release_date', order: 1, tvField: 'metadata.first_air_date' },
      title: { field: 'title', order: 1 },
      rating: { field: 'metadata.vote_average', order: -1 },
    }

    const sortConfig = sortMappings[sort] || sortMappings.newest
    const sortDirection = sortOrder === 'asc' ? 1 : -1
    const finalSortDirection = sortConfig.order * sortDirection

    // Fetch content based on type
    let allContent = []

    if (type === 'all' || type === 'movie') {
      if (Boolean(process.env.DEBUG) == true) {
        console.time('getFlatContentByGenres:movies')
      }

      // Define movie projection - minimal fields only for performance
      const movieProjection = {
        _id: 1,
        normalizedVideoId: 1,
        title: 1,
        posterURL: 1,
        posterBlurhash: 1,
        backdrop: 1,
        backdropBlurhash: 1,
        logo: 1,
        hdr: 1,
        // Only fetch metadata fields needed for sorting/filtering
        'metadata.release_date': 1,
        'metadata.vote_average': 1,
        'metadata.genres': 1,
        'metadata.id': 1,
        ...(shouldExposeAdditionalData && {
          videoURL: 1,
          duration: 1,
        }),
      }

      const movieSort = {}
      movieSort[sortConfig.field] = finalSortDirection

      const movies = await db
        .collection('FlatMovies')
        .find(genreQuery, { projection: movieProjection })
        .sort(movieSort)
        .toArray()

      // Add type and process movies
      const processedMovies = await addCustomUrlToFlatMedia(
        movies.map((movie) => ({ ...movie, type: 'movie' })),
        'movie',
        shouldExposeAdditionalData
      )

      allContent.push(...processedMovies)

      if (Boolean(process.env.DEBUG) == true) {
        console.timeEnd('getFlatContentByGenres:movies')
        console.log(`[PERF] Found ${movies.length} movies matching genres`)
      }
    }

    if (type === 'all' || type === 'tv') {
      if (Boolean(process.env.DEBUG) == true) {
        console.time('getFlatContentByGenres:tvShows')
      }

      const tvSort = {}
      tvSort[sortConfig.tvField || sortConfig.field] = finalSortDirection

      let tvShows

      // Define TV show projection - minimal fields only for performance
      const tvProjection = {
        _id: 1,
        normalizedVideoId: 1,
        title: 1,
        posterURL: 1,
        posterBlurhash: 1,
        backdrop: 1,
        backdropBlurhash: 1,
        logo: 1,
        hdr: 1,
        // Only fetch metadata fields needed for sorting/filtering
        'metadata.first_air_date': 1,
        'metadata.vote_average': 1,
        'metadata.genres': 1,
        'metadata.id': 1,
        ...(shouldExposeAdditionalData && {
          totalEpisodeCount: 1,
          availableEpisodeCount: 1,
        }),
      }

      // For genre filtering, we don't need full episode data
      // Just get the TV shows with basic info - episode data is too expensive here
      // If needed, episode data should be fetched separately when viewing a specific show
      {
        // Standard TV show retrieval with minimal projection
        tvShows = await db
          .collection('FlatTVShows')
          .find(genreQuery, { projection: tvProjection })
          .sort(tvSort)
          .toArray()

        // Add type and process TV shows
        tvShows = await addCustomUrlToFlatMedia(
          tvShows.map((show) => ({ ...show, type: 'tv' })),
          'tv',
          shouldExposeAdditionalData
        )
      }

      allContent.push(...tvShows)

      if (Boolean(process.env.DEBUG) == true) {
        console.timeEnd('getFlatContentByGenres:tvShows')
        console.log(`[PERF] Found ${tvShows.length} TV shows matching genres`)
      }
    }

    // Apply final sorting across all content types
    if (type === 'all') {
      allContent.sort((a, b) => {
        let aValue, bValue

        if (sort === 'newest' || sort === 'oldest') {
          aValue = new Date(a.metadata?.release_date || a.metadata?.first_air_date || 0)
          bValue = new Date(b.metadata?.release_date || b.metadata?.first_air_date || 0)
        } else if (sort === 'title') {
          aValue = a.title || ''
          bValue = b.title || ''
        } else if (sort === 'rating') {
          aValue = a.metadata?.vote_average || 0
          bValue = b.metadata?.vote_average || 0
        }

        if (typeof aValue === 'string') {
          return finalSortDirection > 0
            ? aValue.localeCompare(bValue)
            : bValue.localeCompare(aValue)
        } else {
          return finalSortDirection > 0 ? aValue - bValue : bValue - aValue
        }
      })
    }

    // Apply pagination
    const validPage = Math.max(page, 0)
    const startIndex = validPage * limit
    const endIndex = startIndex + limit
    const paginatedContent = allContent.slice(startIndex, endIndex)

    if (Boolean(process.env.DEBUG) == true) {
      console.log(
        `[PERF] Total content found: ${allContent.length}, returning page ${validPage} (${paginatedContent.length} items)`
      )
      console.timeEnd('getFlatContentByGenres:total')
    }

    return {
      items: paginatedContent,
      totalResults: allContent.length,
      currentPage: validPage,
      totalPages: Math.ceil(allContent.length / limit),
    }
  } catch (error) {
    console.error(`Error in getFlatContentByGenres: ${error.message}`)
    if (Boolean(process.env.DEBUG) == true) {
      console.timeEnd('getFlatContentByGenres:total')
    }
    throw error
  }
}

/**
 * Get genre statistics including content counts and metadata.
 *
 * @param {Object} params - Parameters for the function.
 * @param {string} [params.type='all'] - Media type filter: 'movie', 'tv', 'all'.
 * @param {Array<string>} [params.genres] - Specific genres to get statistics for.
 * @returns {Promise<Object>} Genre statistics and metadata.
 */
export async function getFlatGenreStatistics({ type = 'all', genres = null } = {}) {
  try {
    if (Boolean(process.env.DEBUG) == true) {
      console.time('getFlatGenreStatistics:total')
      console.log(`[PERF] Getting genre statistics for type: ${type}`)
    }

    const client = await clientPromise
    const db = client.db('Media')

    // Get available genres with counts
    const genreData = await getFlatAvailableGenres({ type, includeCounts: true })

    // Filter to specific genres if requested
    let filteredGenres = genreData.availableGenres
    if (genres && Array.isArray(genres) && genres.length > 0) {
      filteredGenres = genreData.availableGenres.filter((genre) => genres.includes(genre.name))
    }

    // Calculate additional statistics
    const statistics = {
      genreBreakdown: filteredGenres,
      totalGenres: filteredGenres.length,
      mediaTypeCounts: genreData.mediaTypeCounts,
      topGenres: {
        byTotalContent: [...filteredGenres]
          .sort((a, b) => b.totalCount - a.totalCount)
          .slice(0, 10),
        byMovieContent: [...filteredGenres]
          .sort((a, b) => b.movieCount - a.movieCount)
          .slice(0, 10),
        byTVContent: [...filteredGenres].sort((a, b) => b.tvShowCount - a.tvShowCount).slice(0, 10),
      },
    }

    if (Boolean(process.env.DEBUG) == true) {
      console.log(`[PERF] Generated statistics for ${filteredGenres.length} genres`)
      console.timeEnd('getFlatGenreStatistics:total')
    }

    return statistics
  } catch (error) {
    console.error(`Error in getFlatGenreStatistics: ${error.message}`)
    if (Boolean(process.env.DEBUG) == true) {
      console.timeEnd('getFlatGenreStatistics:total')
    }
    throw error
  }
}

/**
 * Get movies that belong to a specific TMDB collection from the flat database.
 *
 * @param {number} collectionId - The TMDB collection ID
 * @returns {Promise<Array>} Array of movies in the collection
 */
export async function getFlatMoviesByCollectionId(collectionId) {
  try {
    if (Boolean(process.env.DEBUG) == true) {
      console.time('getFlatMoviesByCollectionId:total')
      console.log(`[PERF] Getting movies for collection ID: ${collectionId}`)
    }

    const client = await clientPromise
    const db = client.db('Media')

    // Query movies that belong to this collection
    const movies = await db
      .collection('FlatMovies')
      .find({
        'metadata.belongs_to_collection.id': parseInt(collectionId),
      })
      .toArray()

    if (Boolean(process.env.DEBUG) == true) {
      console.log(`[PERF] Found ${movies.length} owned movies in collection ${collectionId}`)
      console.timeEnd('getFlatMoviesByCollectionId:total')
    }

    // Process movies to add proper URLs and format data
    return await addCustomUrlToFlatMedia(
      movies.map((movie) => ({
        ...movie,
        type: 'movie',
        isOwned: true,
      })),
      'movie'
    )
  } catch (error) {
    console.error(`Error in getFlatMoviesByCollectionId: ${error.message}`)
    if (Boolean(process.env.DEBUG) == true) {
      console.timeEnd('getFlatMoviesByCollectionId:total')
    }
    throw error
  }
}

/**
 * Merge local owned movies with complete TMDB collection data.
 *
 * @param {Array} ownedMovies - Movies owned locally
 * @param {Object} tmdbCollection - Complete TMDB collection data
 * @returns {Object} Collection with ownership status for each movie
 */
export function mergeCollectionWithOwnership(ownedMovies, tmdbCollection) {
  try {
    if (Boolean(process.env.DEBUG) == true) {
      console.log(
        `[COLLECTION] Merging ${ownedMovies.length} owned movies with TMDB collection data`
      )
    }

    // Create a map of owned movies by TMDB ID for quick lookup
    const ownedMoviesMap = new Map()
    ownedMovies.forEach((movie) => {
      const tmdbId = movie.metadata?.id
      if (tmdbId) {
        ownedMoviesMap.set(tmdbId, movie)
      }
    })

    // Process TMDB collection movies and mark ownership status
    const moviesWithOwnership =
      tmdbCollection.parts?.map((tmdbMovie) => {
        const ownedMovie = ownedMoviesMap.get(tmdbMovie.id)

        if (ownedMovie) {
          // Movie is owned - use local data with TMDB metadata
          return {
            ...ownedMovie,
            isOwned: true,
            mediaId: ownedMovie.id || ownedMovie._id?.toString(), // Explicit mediaId for watchlist
            tmdbId: tmdbMovie.id, // Explicit tmdbId for watchlist
            tmdbData: tmdbMovie,
            // Ensure we have poster and backdrop URLs
            posterURL: ownedMovie.posterURL || getFullImageUrl(tmdbMovie.poster_path),
            backdrop: ownedMovie.backdrop || getFullImageUrl(tmdbMovie.backdrop_path, 'original'),
          }
        } else {
          // Movie is not owned - use TMDB data only
          return {
            id: `tmdb-${tmdbMovie.id}`,
            title: tmdbMovie.title,
            isOwned: false,
            mediaId: null, // Explicit null for non-owned
            tmdbId: tmdbMovie.id, // Explicit tmdbId for watchlist
            tmdbData: tmdbMovie,
            metadata: {
              id: tmdbMovie.id,
              overview: tmdbMovie.overview,
              release_date: tmdbMovie.release_date,
              genres: tmdbMovie.genres || [],
              vote_average: tmdbMovie.vote_average,
              vote_count: tmdbMovie.vote_count,
            },
            posterURL: getFullImageUrl(tmdbMovie.poster_path),
            backdrop: getFullImageUrl(tmdbMovie.backdrop_path, 'original'),
            type: 'movie',
          }
        }
      }) || []

    // Sort movies by release date (newest first)
    moviesWithOwnership.sort((a, b) => {
      const dateA = new Date(a.metadata?.release_date || a.tmdbData?.release_date || 0)
      const dateB = new Date(b.metadata?.release_date || b.tmdbData?.release_date || 0)
      return dateB - dateA
    })

    // Calculate ownership statistics
    const ownedCount = moviesWithOwnership.filter((movie) => movie.isOwned).length
    const totalCount = moviesWithOwnership.length

    const result = {
      ...tmdbCollection,
      parts: moviesWithOwnership,
      ownershipStats: {
        owned: ownedCount,
        total: totalCount,
        percentage: totalCount > 0 ? Math.round((ownedCount / totalCount) * 100) : 0,
      },
      backdrop: tmdbCollection.backdrop_path
        ? getFullImageUrl(tmdbCollection.backdrop_path, 'original')
        : null,
      posterURL: tmdbCollection.poster_path ? getFullImageUrl(tmdbCollection.poster_path) : null,
    }

    if (Boolean(process.env.DEBUG) == true) {
      console.log(
        `[COLLECTION] Processed collection: ${ownedCount}/${totalCount} movies owned (${result.ownershipStats.percentage}%)`
      )
    }

    return result
  } catch (error) {
    console.error(`Error in mergeCollectionWithOwnership: ${error.message}`)
    throw error
  }
}
