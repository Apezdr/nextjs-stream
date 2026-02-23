/**
 * Blurhash sync utilities for flat structure
 *
 * This module provides functions to sync blurhash data using both optimized API endpoints
 * and traditional file-based methods, with automatic detection of available capabilities.
 */

import { createLogger, logError } from '@src/lib/logger'
import fetch from 'node-fetch'
import { filterLockedFields, isCurrentServerHighestPriorityForField } from '../sync/utils'
import { getServer } from '../config'
import { fetchMetadataMultiServer } from '../admin_utils'
import { updateMovieInFlatDB } from './movies/database'
import { getTVShowFromFlatDB } from './tvShows/database'
import { getFlatRequestedMedia } from '../flatDatabaseUtils'

// Capability detection constants
const BLURHASH_ENDPOINT_CAPABILITIES = {
  UNAVAILABLE: 'unavailable',
  BASIC: 'basic', // Individual endpoints only
  OPTIMIZED: 'optimized', // Full API with changes/bulk support
}

/**
 * Checks if an endpoint exists on the server with timeout
 * @param {Object} serverConfig - Server configuration
 * @param {string} endpoint - Endpoint path
 * @returns {Promise<boolean>} True if endpoint exists
 */
async function checkEndpoint(serverConfig, endpoint) {
  const log = createLogger('FlatSync.BlurhashSync');
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 2000) // 2 second timeout

    const server = getServer(serverConfig.id)
    // Using internalEndpoint for server-to-server requests; falls back to syncEndpoint if unset.
    const fullUrl = `${server.internalEndpoint || server.syncEndpoint}${endpoint}`

    log.debug({ fullUrl, endpoint }, 'Checking blurhash endpoint');

    const response = await fetch(fullUrl, {
      method: 'HEAD',
      headers: { 'Cache-Control': 'no-cache' },
      signal: controller.signal,
    })

    clearTimeout(timeoutId)
    return response.status < 400
  } catch (error) {
    // AbortError or network error - endpoint doesn't exist or is unreachable
    log.debug({ endpoint, error: error.message }, 'Endpoint check failed');
    return false
  }
}

/**
 * Detects blurhash API capabilities for a server
 * @param {Object} serverConfig - Server configuration
 * @returns {Promise<string>} Capability level
 */
async function detectBlurhashEndpointCapabilities(serverConfig) {
  const log = createLogger('FlatSync.BlurhashSync');
  try {
    // Check for forced method in server config
    if (serverConfig.forceBlurhashMethod) {
      log.info({
        serverId: serverConfig.id,
        method: serverConfig.forceBlurhashMethod
      }, 'Using forced blurhash method');
      return serverConfig.forceBlurhashMethod
    }

    log.info({ serverId: serverConfig.id }, 'Detecting blurhash API capabilities');

    // Run all checks in parallel
    const [changesResponse, movieResponse, tvResponse] = await Promise.allSettled([
      checkEndpoint(serverConfig, '/api/blurhash-changes?since=2000-01-01T00:00:00.000Z'),
      checkEndpoint(serverConfig, '/api/blurhash/movie/test'),
      checkEndpoint(serverConfig, '/api/blurhash/tv/test'),
    ])

    // Check for optimized API
    if (changesResponse.status === 'fulfilled' && changesResponse.value) {
      log.info({ serverId: serverConfig.id }, 'Detected optimized blurhash API')
      return BLURHASH_ENDPOINT_CAPABILITIES.OPTIMIZED
    }

    // Check for basic API
    if (
      (movieResponse.status === 'fulfilled' && movieResponse.value) ||
      (tvResponse.status === 'fulfilled' && tvResponse.value)
    ) {
      log.info({ serverId: serverConfig.id }, 'Detected basic blurhash API')
      return BLURHASH_ENDPOINT_CAPABILITIES.BASIC
    }

    log.info({ serverId: serverConfig.id }, 'No blurhash API detected')
  } catch (error) {
    logError(log, error, {
      serverId: serverConfig.id,
      context: 'detect_capabilities'
    });
  }

  // Default to unavailable
  return BLURHASH_ENDPOINT_CAPABILITIES.UNAVAILABLE
}

/**
 * Fetches changes since a given timestamp from the blurhash changes endpoint
 * @param {Object} serverConfig - Server configuration
 * @param {String} lastSyncTimestamp - Last sync timestamp
 * @returns {Promise<Object>} Changes object with changes array
 */
async function fetchBlurhashChanges(serverConfig, lastSyncTimestamp) {
  const log = createLogger('FlatSync.BlurhashSync');
  try {
    const server = getServer(serverConfig.id)
    // Using internalEndpoint for server-to-server requests; falls back to syncEndpoint if unset.
    const fullUrl = `${server.internalEndpoint || server.syncEndpoint}/api/blurhash-changes?since=${lastSyncTimestamp}`

    log.debug({ fullUrl }, 'Fetching blurhash changes');

    const response = await fetch(fullUrl, {
      headers: { 'Cache-Control': 'no-cache' },
      timeout: 30000, // 30 second timeout
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch changes: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()

    const movieChanges = data.changes?.filter((c) => c.mediaType === 'movies') || []
    const tvChanges = data.changes?.filter((c) => c.mediaType === 'tv') || []

    log.info({
      serverId: serverConfig.id,
      movieChanges: movieChanges.length,
      tvChanges: tvChanges.length
    }, 'Fetched blurhash changes');

    return data
  } catch (error) {
    logError(log, error, {
      serverId: serverConfig.id,
      context: 'fetch_blurhash_changes'
    })
    return { timestamp: new Date().toISOString(), changes: [] }
  }
}

/**
 * Fetches blurhash data for a movie
 * @param {Object} serverConfig - Server configuration
 * @param {string} movieTitle - Movie title
 * @returns {Promise<Object|null>} Blurhash data or null
 */
async function fetchMovieBlurhash(serverConfig, movieTitle) {
  const log = createLogger('FlatSync.BlurhashSync');
  try {
    const server = getServer(serverConfig.id)
    const encodedTitle = encodeURIComponent(movieTitle)
    // Using internalEndpoint for server-to-server requests; falls back to syncEndpoint if unset.
    const fullUrl = `${server.internalEndpoint || server.syncEndpoint}/api/blurhash/movie/${encodedTitle}`

    const response = await fetch(fullUrl, {
      headers: { 'Cache-Control': 'no-cache' },
      timeout: 10000, // 10 second timeout
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch movie blurhash: ${response.status} ${response.statusText}`)
    }

    return await response.json()
  } catch (error) {
    logError(log, error, {
      serverId: serverConfig.id,
      movieTitle,
      context: 'fetch_movie_blurhash'
    })
    return null
  }
}

/**
 * Fetches blurhash data for a TV show
 * @param {Object} serverConfig - Server configuration
 * @param {string} showTitle - TV show title
 * @returns {Promise<Object|null>} Blurhash data or null
 */
async function fetchTVShowBlurhash(serverConfig, showTitle) {
  const log = createLogger('FlatSync.BlurhashSync');
  try {
    const server = getServer(serverConfig.id)
    const encodedTitle = encodeURIComponent(showTitle)
    // Using internalEndpoint for server-to-server requests; falls back to syncEndpoint if unset.
    const fullUrl = `${server.internalEndpoint || server.syncEndpoint}/api/blurhash/tv/${encodedTitle}`

    const response = await fetch(fullUrl, {
      headers: { 'Cache-Control': 'no-cache' },
      timeout: 10000, // 10 second timeout
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch TV show blurhash: ${response.status} ${response.statusText}`)
    }

    return await response.json()
  } catch (error) {
    logError(log, error, {
      serverId: serverConfig.id,
      showTitle,
      context: 'fetch_tv_blurhash'
    })
    return null
  }
}

/**
 * Fetches blurhash data for multiple items in bulk
 * @param {Object} serverConfig - Server configuration
 * @param {Object} items - Object with movies and tvShows arrays
 * @returns {Promise<Object|null>} Bulk blurhash data or null
 */
async function fetchBulkBlurhashes(serverConfig, items) {
  const log = createLogger('FlatSync.BlurhashSync');
  try {
    const server = getServer(serverConfig.id)
    // Using internalEndpoint for server-to-server requests; falls back to syncEndpoint if unset.
    const fullUrl = `${server.internalEndpoint || server.syncEndpoint}/api/blurhash/bulk`

    // Convert from our internal format to the format expected by the API
    // The API expects { mediaItems: [ { type: 'movie|tv', name: 'title' }, ... ] }
    const mediaItems = []

    // Add movies
    if (items.movies && items.movies.length > 0) {
      items.movies.forEach((movie) => {
        mediaItems.push({
          type: 'movie',
          name: movie.title,
        })
      })
    }

    // Add TV shows
    if (items.tvShows && items.tvShows.length > 0) {
      items.tvShows.forEach((show) => {
        mediaItems.push({
          type: 'tv',
          name: show.title,
        })
      })
    }

    // Make API request with the converted format
    const response = await fetch(fullUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      },
      body: JSON.stringify({ mediaItems }),
      timeout: 60000, // 60 second timeout for bulk operations
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch bulk blurhashes: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()

    // Convert the response format back to our internal format
    // API returns { results: { "movie_Title": data, "tv_Title": data } }
    const result = {
      movies: {},
      tvShows: {},
    }

    if (data.results) {
      // Process each result and add to the appropriate category
      Object.entries(data.results).forEach(([key, value]) => {
        // Keys are in format "type_name"
        const [type, ...nameParts] = key.split('_')
        const name = nameParts.join('_') // Rejoin in case name contains underscores

        if (type === 'movie') {
          // For movies, we need to extract the blurhashes.poster and blurhashes.backdrop
          if (value && value.imageHashes) {
            result.movies[name] = {
              blurhashes: {
                poster: value.imageHashes.poster?.hash || null,
                backdrop: value.imageHashes.backdrop?.hash || null,
              },
              posterBlurhash: value.posterBlurhash || null,
              backdropBlurhash: value.backdropBlurhash || null,
            }
          } else {
            // Fallback to the original structure if imageHashes is missing
            result.movies[name] = value
          }
        } else if (type === 'tv') {
          // For TV shows, we need to transform the deeply nested structure
          const transformedData = {
            show: {
              blurhashes: {
                poster: value.imageHashes?.poster?.hash || null,
                backdrop: value.imageHashes?.backdrop?.hash || null,
              },
              posterBlurhash: value.posterBlurhash || null,
              backdropBlurhash: value.backdropBlurhash || null,
            },
            seasons: [],
            episodes: [],
          }

          // Extract season data
          if (value.seasons) {
            Object.entries(value.seasons).forEach(([seasonKey, seasonData]) => {
              if (seasonData.seasonNumber && seasonData.imageHashes?.season_poster?.hash) {
                transformedData.seasons.push({
                  seasonNumber: seasonData.seasonNumber,
                  blurhashes: {
                    poster: seasonData.imageHashes.season_poster.hash,
                  },
                  seasonPosterBlurhash: seasonData.seasonPosterBlurhash || null,
                })
              }

              // Extract episode data
              if (seasonData.episodes) {
                Object.entries(seasonData.episodes).forEach(([episodeKey, episodeData]) => {
                  // Extract episode number from key like "S01E02"
                  const episodeMatch = episodeKey.match(/E(\d+)$/)
                  if (episodeMatch && episodeData.imageHashes?.thumbnail?.hash) {
                    const episodeNumber = parseInt(episodeMatch[1], 10)
                    transformedData.episodes.push({
                      seasonNumber: seasonData.seasonNumber,
                      episodeNumber: episodeNumber,
                      blurhashes: {
                        thumbnail: episodeData.imageHashes.thumbnail.hash,
                      },
                      thumbnailBlurhash: episodeData.thumbnailBlurhash || null,
                    })
                  }
                })
              }
            })
          }

          result.tvShows[name] = transformedData
        }
      })
    }

    return result
  } catch (error) {
    logError(log, error, {
      serverId: serverConfig.id,
      context: 'fetch_bulk_blurhashes'
    })
    return null
  }
}

/**
 * Updates movie blurhash in database using new schema
 * @param {Object} client - MongoDB client
 * @param {Object} movie - Movie object
 * @param {Object} blurhashData - Blurhash data
 * @param {Object} serverConfig - Server configuration
 * @returns {Promise<boolean>} Success indicator
 */
async function updateMovieBlurhashInDB(client, movie, blurhashData, serverConfig) {
  const log = createLogger('FlatSync.BlurhashSync');
  // Variables for cleanup later
  let posterBlurhash = null
  let backdropBlurhash = null

  try {
    if (!blurhashData || !blurhashData.blurhashes) return false

    const updateData = {}
    const now = new Date()

    // Update poster blurhash if available
    if (blurhashData.blurhashes.poster && blurhashData.posterBlurhash) {
      // Store the file hash in a separate field
      updateData['blurhash.posterFileHash'] = blurhashData.blurhashes.poster

      try {
        // Fetch the actual blurhash data using the file hash
        posterBlurhash = await fetchMetadataMultiServer(
          serverConfig.id,
          blurhashData.posterBlurhash,
          'blurhash',
          'movie',
          movie.originalTitle
        )

        if (posterBlurhash) {
          updateData['blurhash.posterBlurhashSource'] = serverConfig.id
          updateData['blurhash.updatedAt'] = now

          // Legacy fields for backward compatibility
          updateData.posterBlurhash = posterBlurhash
          updateData.posterBlurhashSource = serverConfig.id
        }
      } catch (posterError) {
        logError(log, posterError, {
          movieTitle: movie.title,
          context: 'fetch_movie_poster_blurhash'
        })
        // Continue processing with other fields even if poster blurhash fails
      }
    }

    // Update backdrop blurhash if available
    if (blurhashData.blurhashes.backdrop && blurhashData.backdropBlurhash) {
      try {
        // Store the file hash in a separate field
        updateData['blurhash.backdropFileHash'] = blurhashData.blurhashes.backdrop

        // Fetch the actual blurhash data using the file hash
        backdropBlurhash = await fetchMetadataMultiServer(
          serverConfig.id,
          blurhashData.backdropBlurhash,
          'blurhash',
          'movie',
          movie.originalTitle
        )

        if (backdropBlurhash) {
          updateData['blurhash.backdropBlurhashSource'] = serverConfig.id
          updateData['blurhash.updatedAt'] = now

          // Legacy fields for backward compatibility
          updateData.backdropBlurhash = backdropBlurhash
          updateData.backdropBlurhashSource = serverConfig.id
        }
      } catch (backdropError) {
        logError(log, backdropError, {
          movieTitle: movie.title,
          context: 'fetch_movie_backdrop_blurhash'
        })
        // Continue processing with other fields even if backdrop blurhash fails
      }
    }

    // If no updates, return early
    if (Object.keys(updateData).length === 0) return false

    // Filter locked fields
    const filteredUpdateData = filterLockedFields(movie, updateData)

    // If no fields to update after filtering, return early
    if (Object.keys(filteredUpdateData).length === 0) return false

    try {
      // Update the movie in the database
      const result = await client
        .db('Media')
        .collection('FlatMovies')
        .updateOne({ title: movie.title }, { $set: filteredUpdateData })

      return result.modifiedCount > 0
    } catch (dbError) {
      logError(log, dbError, {
        movieTitle: movie.title,
        context: 'db_update_movie_blurhash'
      })
      return false
    }
  } catch (error) {
    logError(log, error, {
      movieTitle: movie.title,
      context: 'update_movie_blurhash'
    })
    return false
  } finally {
    // Explicitly clean up references to help garbage collection
    posterBlurhash = null
    backdropBlurhash = null
  }
}

/**
 * Updates TV show blurhash in database using new schema
 * @param {Object} client - MongoDB client
 * @param {Object} show - TV show object
 * @param {Object} blurhashData - Blurhash data
 * @param {Object} serverConfig - Server configuration
 * @returns {Promise<Object>} Update results
 */
async function updateTVShowBlurhashInDB(client, show, blurhashData, serverConfig) {
  const log = createLogger('FlatSync.BlurhashSync');
  // Variables for cleanup later
  let posterBlurhash = null
  let backdropBlurhash = null
  let seasonPosterBlurhash = null
  let thumbnailBlurhash = null

  try {
    const results = {
      show: false,
      seasons: 0,
      episodes: 0,
    }

    if (!blurhashData || !blurhashData.show) return results

    // Update show blurhashes
    if (blurhashData.show.blurhashes) {
      const updateData = {}
      const now = new Date()

      // Update poster blurhash
      if (blurhashData.show.blurhashes.poster && blurhashData.show.posterBlurhash) {
        try {
          // Fetch the actual blurhash data
          posterBlurhash = await fetchMetadataMultiServer(
            serverConfig.id,
            blurhashData.show.posterBlurhash,
            'blurhash',
            'tv',
            show.originalTitle
          )

          if (posterBlurhash && show.posterBlurhash !== posterBlurhash) {
            // Store the file hash
            updateData['blurhash.posterFileHash'] = blurhashData.show.blurhashes.poster
            updateData['blurhash.posterBlurhashSource'] = serverConfig.id
            updateData['blurhash.updatedAt'] = now

            // Legacy fields
            updateData.posterBlurhash = posterBlurhash
            updateData.posterBlurhashSource = serverConfig.id
          }
        } catch (posterError) {
          logError(log, posterError, {
            showTitle: show.title,
            context: 'fetch_tv_poster_blurhash'
          })
          // Continue processing other blurhashes
        }
      }

      // Update backdrop blurhash
      if (blurhashData.show.blurhashes.backdrop && blurhashData.show.backdropBlurhash) {
        try {
          // Fetch the actual blurhash data
          backdropBlurhash = await fetchMetadataMultiServer(
            serverConfig.id,
            blurhashData.show.backdropBlurhash,
            'blurhash',
            'tv',
            show.originalTitle
          )

          if (backdropBlurhash && show.backdropBlurhash !== backdropBlurhash) {
            // Store the file hash
            updateData['blurhash.backdropFileHash'] = blurhashData.show.blurhashes.backdrop
            updateData['blurhash.backdropBlurhashSource'] = serverConfig.id
            updateData['blurhash.updatedAt'] = now

            // Legacy fields
            updateData.backdropBlurhash = backdropBlurhash
            updateData.backdropBlurhashSource = serverConfig.id
          }
        } catch (backdropError) {
          logError(log, backdropError, {
            showTitle: show.title,
            context: 'fetch_tv_backdrop_blurhash'
          })
          // Continue processing other blurhashes
        }
      }

      // Update show if there are changes
      if (Object.keys(updateData).length > 0) {
        try {
          const filteredUpdateData = filterLockedFields(show, updateData)

          if (Object.keys(filteredUpdateData).length > 0) {
            const result = await client
              .db('Media')
              .collection('FlatTVShows')
              .updateOne({ title: show.title }, { $set: filteredUpdateData })

            results.show = result.modifiedCount > 0
          }
          } catch (dbError) {
            logError(log, dbError, {
              showTitle: show.title,
              context: 'db_update_tv_blurhash'
            })
          // Continue with other updates
        }
      }
    }

    // Update seasons
    if (blurhashData.seasons && blurhashData.seasons.length > 0) {
      for (const seasonData of blurhashData.seasons) {
        if (!seasonData.seasonNumber || !seasonData.blurhashes || !seasonData.blurhashes.poster)
          continue

        try {
          const updateData = {}
          const dbSeason = show.seasons.find((s) => s.seasonNumber === seasonData.seasonNumber)
          if (!dbSeason) continue

          // Fetch the actual blurhash data
          seasonPosterBlurhash = await fetchMetadataMultiServer(
            serverConfig.id,
            seasonData.seasonPosterBlurhash,
            'blurhash',
            'tv',
            show.originalTitle
          )

          if (seasonPosterBlurhash && dbSeason.posterBlurhash !== seasonPosterBlurhash) {
            // Store the file hash
            updateData['blurhash.posterFileHash'] = seasonData.blurhashes.poster
            updateData['blurhash.posterBlurhashSource'] = serverConfig.id
            updateData['blurhash.updatedAt'] = new Date()
            updateData['posterBlurhash'] = seasonPosterBlurhash
            updateData['posterBlurhashSource'] = serverConfig.id

            try {
              // Find the season in the database
              const season = await client.db('Media').collection('FlatSeasons').findOne({
                showTitle: show.title,
                seasonNumber: seasonData.seasonNumber,
              })

              if (!season) continue

              // Filter locked fields
              const filteredUpdateData = filterLockedFields(season, updateData)

              if (Object.keys(filteredUpdateData).length > 0) {
                // Update the season
                const result = await client.db('Media').collection('FlatSeasons').updateOne(
                  {
                    showTitle: show.title,
                    seasonNumber: seasonData.seasonNumber,
                  },
                  { $set: filteredUpdateData }
                )

                if (result.modifiedCount > 0) {
                  results.seasons++
                }
              }
            } catch (dbError) {
              log.error({
                showTitle: show.title,
                seasonNumber: seasonData.seasonNumber,
                error: dbError.message
              }, 'Database error updating season blurhash')
              // Continue with other updates
            }
          }
        } catch (seasonError) {
          logError(log, seasonError, {
            showTitle: show.title,
            seasonNumber: seasonData.seasonNumber,
            context: 'process_season_blurhash'
          })
          // Continue with next season
        }
      }
    }

    // Update episodes
    if (blurhashData.episodes && blurhashData.episodes.length > 0) {
      for (const episodeData of blurhashData.episodes) {
        if (
          !episodeData.seasonNumber ||
          !episodeData.episodeNumber ||
          !episodeData.blurhashes ||
          !episodeData.blurhashes.thumbnail
        )
          continue

        try {
          const updateData = {}
          const dbSeason = show.seasons.find((s) => s.seasonNumber === episodeData.seasonNumber)
          if (!dbSeason) continue

          const dbEpisode = dbSeason?.episodes.find(
            (e) => e.episodeNumber === episodeData.episodeNumber
          )
          if (!dbEpisode) continue

          // Fetch the actual blurhash data
          thumbnailBlurhash = await fetchMetadataMultiServer(
            serverConfig.id,
            episodeData.thumbnailBlurhash,
            'blurhash',
            'tv',
            show.originalTitle
          )

          if (thumbnailBlurhash && dbEpisode.thumbnailBlurhash !== thumbnailBlurhash) {
            // Store the file hash
            updateData['blurhash.thumbnailFileHash'] = episodeData.blurhashes.thumbnail
            updateData['thumbnailBlurhash'] = thumbnailBlurhash
            updateData['blurhash.thumbnailBlurhashSource'] = serverConfig.id
            updateData['blurhash.updatedAt'] = new Date()

            try {
              // Find the episode in the database
              const episode = await client.db('Media').collection('FlatEpisodes').findOne({
                showTitle: show.title,
                seasonNumber: episodeData.seasonNumber,
                episodeNumber: episodeData.episodeNumber,
              })

              if (!episode) continue

              // Filter locked fields
              const filteredUpdateData = filterLockedFields(episode, updateData)

              if (Object.keys(filteredUpdateData).length > 0) {
                // Update the episode
                const result = await client.db('Media').collection('FlatEpisodes').updateOne(
                  {
                    showTitle: show.title,
                    seasonNumber: episodeData.seasonNumber,
                    episodeNumber: episodeData.episodeNumber,
                  },
                  { $set: filteredUpdateData }
                )

                if (result.modifiedCount > 0) {
                  results.episodes++
                }
              }
            } catch (dbError) {
              logError(log, dbError, {
                showTitle: show.title,
                seasonNumber: episodeData.seasonNumber,
                episodeNumber: episodeData.episodeNumber,
                context: 'db_update_episode_blurhash'
              })
              // Continue with other updates
            }
          }
        } catch (episodeError) {
          logError(log, episodeError, {
            showTitle: show.title,
            seasonNumber: episodeData.seasonNumber,
            episodeNumber: episodeData.episodeNumber,
            context: 'process_episode_blurhash'
          })
          // Continue with next episode
        }
      }
    }

    return results
  } catch (error) {
    logError(log, error, {
      showTitle: show?.title,
      context: 'update_tv_blurhash'
    })
    return { show: false, seasons: 0, episodes: 0 }
  } finally {
    // Explicitly clean up references to help garbage collection
    posterBlurhash = null
    backdropBlurhash = null
    seasonPosterBlurhash = null
    thumbnailBlurhash = null
  }
}

/**
 * Processes bulk blurhash changes with controlled concurrency using Promise.allSettled
 * @param {Object} client - MongoDB client
 * @param {Object} changes - Changes object with movies and tvShows arrays
 * @param {Object} serverConfig - Server configuration
 * @returns {Promise<Object>} Processing results
 */
async function processBulkBlurhashChanges(client, changes, serverConfig) {
  const log = createLogger('FlatSync.BlurhashSync');
  try {
    log.info({
      movieCount: changes.movies.length,
      tvCount: changes.tvShows.length,
      serverId: serverConfig.id
    }, 'Processing blurhash changes in bulk');

    // Split into manageable batches of 20 items
    const batches = []
    const batchSize = 20

    // Create movie batches
    for (let i = 0; i < changes.movies.length; i += batchSize) {
      const batch = changes.movies.slice(i, i + batchSize)
      batches.push({ movies: batch, tvShows: [] })
    }

    // Create TV show batches
    for (let i = 0; i < changes.tvShows.length; i += batchSize) {
      const batch = changes.tvShows.slice(i, i + batchSize)
      batches.push({ movies: [], tvShows: batch })
    }

    const results = {
      movies: { processed: [], errors: [] },
      tvShows: { processed: [], errors: [] },
    }

    // Process batches sequentially but process items within each batch concurrently
    // This prevents overwhelming the system with too many simultaneous operations
    for (const [index, batch] of batches.entries()) {
      log.debug({ batch: index + 1, totalBatches: batches.length }, 'Processing blurhash batch');

      try {
        const batchData = await fetchBulkBlurhashes(serverConfig, batch)
        if (!batchData) continue

        // Process movies in this batch with Promise.allSettled
        if (batchData.movies && Object.keys(batchData.movies).length > 0) {
          const moviePromises = Object.entries(batchData.movies).map(async ([title, data]) => {
            try {
              // Find the movie in the database
              const movie = await client.db('Media').collection('FlatMovies').findOne({ title })

              if (!movie) {
                return { status: 'rejected', title, reason: 'Movie not found in database' }
              }

              // Update movie blurhash
              const updated = await updateMovieBlurhashInDB(client, movie, data, serverConfig)

              return {
                status: updated ? 'fulfilled' : 'skipped',
                title,
                value: updated ? 'Updated successfully' : 'No changes needed',
              }
            } catch (error) {
              return { status: 'rejected', title, reason: error.message }
            }
          })

          // Process all movie promises concurrently but with controlled parallelism
          const movieResults = await Promise.allSettled(moviePromises)

          // Process results
          for (const result of movieResults) {
            if (result.status === 'fulfilled') {
              const movieResult = result.value
              if (movieResult.status === 'fulfilled') {
                results.movies.processed.push(movieResult.title)
              } else if (movieResult.status === 'rejected') {
                results.movies.errors.push({
                  title: movieResult.title,
                  error: movieResult.reason,
                })
              }
            } else if (result.status === 'rejected') {
              logError(log, result.reason, {
                context: 'movie_processing_promise'
              })
            }
          }

          // Explicitly suggest garbage collection if available
          if (global.gc && index % 3 === 0) {
            try {
              global.gc()
            } catch (gcError) {
              // Ignore errors from garbage collection
            }
          }
        }

        // Process TV shows in this batch with Promise.allSettled
        if (batchData.tvShows && Object.keys(batchData.tvShows).length > 0) {
          const tvPromises = Object.entries(batchData.tvShows).map(async ([title, data]) => {
            try {
              // Find the TV show in the database
              const show = await getFlatRequestedMedia({ type: 'tv', title: title })

              if (!show) {
                return { status: 'rejected', title, reason: 'TV show not found in database' }
              }

              // Update TV show blurhash
              const updated = await updateTVShowBlurhashInDB(client, show, data, serverConfig)

              return {
                status:
                  updated.show || updated.seasons > 0 || updated.episodes > 0
                    ? 'fulfilled'
                    : 'skipped',
                title,
                value: {
                  show: updated.show,
                  seasons: updated.seasons,
                  episodes: updated.episodes,
                },
              }
            } catch (error) {
              return { status: 'rejected', title, reason: error.message }
            }
          })

          // Process all TV show promises concurrently but with controlled parallelism
          const tvResults = await Promise.allSettled(tvPromises)

          // Process results
          for (const result of tvResults) {
            if (result.status === 'fulfilled') {
              const tvResult = result.value
              if (tvResult.status === 'fulfilled') {
                results.tvShows.processed.push({
                  title: tvResult.title,
                  ...tvResult.value,
                })
              } else if (tvResult.status === 'rejected') {
                results.tvShows.errors.push({
                  title: tvResult.title,
                  error: tvResult.reason,
                })
              }
            } else if (result.status === 'rejected') {
              logError(log, result.reason, {
                context: 'tv_processing_promise'
              })
            }
          }
        }

        // Add a small delay between batches to allow for resource recovery
        await new Promise((resolve) => setTimeout(resolve, 100))
      } catch (batchError) {
        logError(log, batchError, {
          batch: index + 1,
          context: 'process_bulk_batch'
        })
      }
    }

    return results
  } catch (error) {
    logError(log, error, {
      context: 'process_bulk_blurhash_changes'
    })
    return {
      movies: { processed: [], errors: [] },
      tvShows: { processed: [], errors: [] },
      error: error.message,
    }
  }
}

/**
 * Process individual blurhash changes with controlled concurrency using Promise.allSettled
 * @param {Object} client - MongoDB client
 * @param {Object} changes - Changes object with movies and tvShows arrays
 * @param {Object} serverConfig - Server configuration
 * @returns {Promise<Object>} Processing results
 */
async function processIndividualBlurhashChanges(client, changes, serverConfig) {
  const log = createLogger('FlatSync.BlurhashSync');
  const results = {
    movies: { processed: [], errors: [] },
    tvShows: { processed: [], errors: [] },
  }

  // Process movies and TV shows in batches to control concurrency
  const BATCH_SIZE = 5 // Process 5 items at a time

  // Process movies with Promise.allSettled
  if (changes.movies && changes.movies.length > 0) {
    // Break movies into smaller batches
    for (let i = 0; i < changes.movies.length; i += BATCH_SIZE) {
      const batch = changes.movies.slice(i, i + BATCH_SIZE)
      log.debug({
        batch: Math.floor(i / BATCH_SIZE) + 1,
        totalBatches: Math.ceil(changes.movies.length / BATCH_SIZE)
      }, 'Processing movie blurhash batch');

      // Create promises for all movies in this batch
      const moviePromises = batch.map(async (movie) => {
        try {
          // Find the movie in the database
          const movieDoc = await client
            .db('Media')
            .collection('FlatMovies')
            .findOne({ title: movie.title })

          if (!movieDoc) {
            return { status: 'rejected', title: movie.title, reason: 'Movie not found in database' }
          }

          // Fetch movie blurhash
          const blurhashData = await fetchMovieBlurhash(serverConfig, movie.title)
          if (!blurhashData) {
            return {
              status: 'rejected',
              title: movie.title,
              reason: 'Failed to fetch blurhash data',
            }
          }

          // Update movie blurhash
          const updated = await updateMovieBlurhashInDB(
            client,
            movieDoc,
            blurhashData,
            serverConfig
          )

          return {
            status: updated ? 'fulfilled' : 'skipped',
            title: movie.title,
            value: updated ? 'Updated successfully' : 'No changes needed',
          }
        } catch (error) {
          return { status: 'rejected', title: movie.title, reason: error.message }
        }
      })

      // Process all movie promises in this batch concurrently
      const batchResults = await Promise.allSettled(moviePromises)

      // Process results
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          const movieResult = result.value
          if (movieResult.status === 'fulfilled') {
            results.movies.processed.push(movieResult.title)
          } else if (movieResult.status === 'rejected') {
            results.movies.errors.push({
              title: movieResult.title,
              error: movieResult.reason,
            })
          }
        } else if (result.status === 'rejected') {
          logError(log, result.reason, {
            context: 'movie_processing_promise'
          })
        }
      }

      // Add a small delay between batches to allow for resource recovery
      if (i + BATCH_SIZE < changes.movies.length) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }

      // Suggest garbage collection after processing each batch
      if (global.gc && i % (BATCH_SIZE * 2) === 0) {
        try {
          global.gc()
        } catch (gcError) {
          // Ignore errors from garbage collection
        }
      }
    }
  }

  // Process TV shows with Promise.allSettled
  if (changes.tvShows && changes.tvShows.length > 0) {
    // TV shows may generate more network activity, so use an even smaller batch size
    const TV_BATCH_SIZE = 3

    // Break TV shows into smaller batches
    for (let i = 0; i < changes.tvShows.length; i += TV_BATCH_SIZE) {
      const batch = changes.tvShows.slice(i, i + TV_BATCH_SIZE)
      log.debug({
        batch: Math.floor(i / TV_BATCH_SIZE) + 1,
        totalBatches: Math.ceil(changes.tvShows.length / TV_BATCH_SIZE)
      }, 'Processing TV blurhash batch');

      // Create promises for all TV shows in this batch
      const tvPromises = batch.map(async (show) => {
        try {
          // Find the TV show in the database
          const showDoc = await client
            .db('Media')
            .collection('FlatTVShows')
            .findOne({ title: show.title })

          if (!showDoc) {
            return {
              status: 'rejected',
              title: show.title,
              reason: 'TV show not found in database',
            }
          }

          // Fetch TV show blurhash
          const blurhashData = await fetchTVShowBlurhash(serverConfig, show.title)
          if (!blurhashData) {
            return {
              status: 'rejected',
              title: show.title,
              reason: 'Failed to fetch blurhash data',
            }
          }

          // Update TV show blurhash
          const updated = await updateTVShowBlurhashInDB(
            client,
            showDoc,
            blurhashData,
            serverConfig
          )

          return {
            status:
              updated.show || updated.seasons > 0 || updated.episodes > 0 ? 'fulfilled' : 'skipped',
            title: show.title,
            value: {
              show: updated.show,
              seasons: updated.seasons,
              episodes: updated.episodes,
            },
          }
        } catch (error) {
          return { status: 'rejected', title: show.title, reason: error.message }
        }
      })

      // Process all TV show promises in this batch concurrently
      const batchResults = await Promise.allSettled(tvPromises)

      // Process results
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          const tvResult = result.value
          if (tvResult.status === 'fulfilled') {
            results.tvShows.processed.push({
              title: tvResult.title,
              ...tvResult.value,
            })
          } else if (tvResult.status === 'rejected') {
            results.tvShows.errors.push({
              title: tvResult.title,
              error: tvResult.reason,
            })
          }
        } else if (result.status === 'rejected') {
          logError(log, result.reason, {
            context: 'tv_processing_promise'
          })
        }
      }

      // Add a small delay between batches to allow for resource recovery
      if (i + TV_BATCH_SIZE < changes.tvShows.length) {
        await new Promise((resolve) => setTimeout(resolve, 250)) // Longer delay for TV shows
      }

      // Suggest garbage collection after processing each batch
      if (global.gc) {
        try {
          global.gc()
        } catch (gcError) {
          // Ignore errors from garbage collection
        }
      }
    }
  }

  return results
}

/**
 * Syncs blurhashes using the optimized API with changes endpoint
 * @param {Object} client - MongoDB client
 * @param {Object} flatDB - Flat database structure
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object>} Sync results
 */
async function syncBlurhashOptimized(client, flatDB, serverConfig, fieldAvailability) {
  try {
    const log = createLogger('FlatSync.BlurhashSync');
    // Get last sync timestamp
    let lastSyncTimestamp = await getLastSynced()

    // Convert to a Date object and format as ISO string
    if (lastSyncTimestamp) {
      lastSyncTimestamp = new Date(lastSyncTimestamp).toISOString()
    }

    //let lastSyncTimestamp = '2000-01-01T00:00:00.000Z'; // Default to a very old date for now

    // Fetch changes since last sync
    const data = await fetchBlurhashChanges(serverConfig, lastSyncTimestamp)

    // Convert flat changes array to grouped format for compatibility with existing functions
    const flatChanges = data.changes || []

    // Group changes by mediaType - mediaId is not needed as we use title for database operations
    const movieChanges = flatChanges
      .filter((change) => change.mediaType === 'movies')
      .map((change) => ({
        title: change.title,
        imageType: change.imageType,
        hash: change.hash,
        lastModified: change.lastModified,
      }))

    const tvChanges = flatChanges
      .filter((change) => change.mediaType === 'tv')
      .map((change) => ({
        title: change.title,
        seasonNumber: change.seasonNumber,
        episodeKey: change.episodeKey,
        imageType: change.imageType,
        hash: change.hash,
        lastModified: change.lastModified,
      }))

    // Create compatible changes object
    const changes = {
      movies: movieChanges,
      tvShows: tvChanges,
    }

    // Early return if no changes
    if (!changes.movies.length && !changes.tvShows.length) {
      log.info({ serverId: serverConfig.id }, 'No blurhash changes detected')
      return { status: 'no_changes' }
    }

    log.info({ 
      serverId: serverConfig.id,
      movieCount: changes.movies.length,
      tvShowCount: changes.tvShows.length 
    }, 'Processing blurhash changes')

    // Process in batches based on count
    let results
    if (changes.movies.length + changes.tvShows.length > 20) {
      // Use bulk API for many changes
      results = await processBulkBlurhashChanges(client, changes, serverConfig)
    } else {
      // Use individual APIs for fewer changes
      results = await processIndividualBlurhashChanges(client, changes, serverConfig)
    }

    // In a production implementation, store the new sync timestamp
    // await storeLastBlurhashSyncTimestamp(client, serverConfig.id, data.timestamp);

    return {
      status: 'success',
      method: 'optimized',
      timestamp: data.timestamp,
      results,
    }
  } catch (error) {
    log.error({ 
      error: error.message, 
      context: 'optimized_blurhash_sync' 
    }, 'Error in optimized blurhash sync')
    
    return {
      status: 'error',
      method: 'optimized',
      error: error.message,
    }
  }
}

/**
 * Syncs blurhashes using basic individual endpoints
 * @param {Object} client - MongoDB client
 * @param {Object} flatDB - Flat database structure
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object>} Sync results
 */
async function syncBlurhashBasic(client, flatDB, serverConfig, fieldAvailability) {
  const log = createLogger('FlatSync.BlurhashSync');
  try {
    const results = {
      movies: { processed: [], errors: [] },
      tvShows: { processed: [], errors: [] },
    }

    log.info({
      movieCount: flatDB.movies.length,
      tvShowCount: flatDB.tv.length,
      serverId: serverConfig.id
    }, 'Starting basic blurhash sync');

    // Process a subset of movies to avoid processing too many at once
    // In a production implementation, you could process all movies or implement pagination
    const moviesToProcess = flatDB.movies.slice(0, 50) // Process up to 50 movies

    for (const movie of moviesToProcess) {
      try {
        log.debug({ movieTitle: movie.title }, 'Fetching movie blurhash');
        const blurhashData = await fetchMovieBlurhash(serverConfig, movie.title)
        
        if (blurhashData) {
          const updated = await updateMovieBlurhashInDB(client, movie, blurhashData, serverConfig)
          
          if (updated) {
            log.info({ movieTitle: movie.title }, 'Movie blurhash updated successfully');
            results.movies.processed.push(movie.title)
          } else {
            log.debug({ movieTitle: movie.title }, 'No updates needed for movie blurhash');
          }
        } else {
          log.debug({ movieTitle: movie.title }, 'No blurhash data available for movie');
        }
      } catch (error) {
        log.error({ 
          movieTitle: movie.title, 
          error: error.message 
        }, 'Error processing movie blurhash');
        
        results.movies.errors.push({ 
          title: movie.title, 
          error: error.message 
        })
      }
    }

    // Process a subset of TV shows
    const showsToProcess = flatDB.tv.slice(0, 20) // Process up to 20 shows

    for (const show of showsToProcess) {
      try {
        log.debug({ showTitle: show.title }, 'Fetching TV show blurhash');
        const blurhashData = await fetchTVShowBlurhash(serverConfig, show.title)
        
        if (blurhashData) {
          const updated = await updateTVShowBlurhashInDB(client, show, blurhashData, serverConfig)
          
          if (updated.show || updated.seasons > 0 || updated.episodes > 0) {
            log.info({ 
              showTitle: show.title, 
              showUpdated: updated.show, 
              seasonsUpdated: updated.seasons, 
              episodesUpdated: updated.episodes 
            }, 'TV show blurhash updated successfully');
            
            results.tvShows.processed.push({
              title: show.title,
              show: updated.show,
              seasons: updated.seasons,
              episodes: updated.episodes,
            })
          } else {
            log.debug({ showTitle: show.title }, 'No updates needed for TV show blurhash');
          }
        } else {
          log.debug({ showTitle: show.title }, 'No blurhash data available for TV show');
        }
      } catch (error) {
        log.error({ 
          showTitle: show.title, 
          error: error.message 
        }, 'Error processing TV show blurhash');
        
        results.tvShows.errors.push({ 
          title: show.title, 
          error: error.message 
        })
      }
    }

    log.info({
      moviesProcessed: results.movies.processed.length,
      movieErrors: results.movies.errors.length,
      tvShowsProcessed: results.tvShows.processed.length,
      tvShowErrors: results.tvShows.errors.length
    }, 'Basic blurhash sync completed');

    return {
      status: 'success',
      method: 'basic',
      results,
    }
  } catch (error) {
    log.error({ 
      error: error.message, 
      context: 'basic_blurhash_sync' 
    }, 'Error in basic blurhash sync');
    
    return {
      status: 'error',
      method: 'basic',
      error: error.message,
    }
  }
}

/**
 * Syncs blurhashes using traditional file-based method
 * @param {Object} client - MongoDB client
 * @param {Object} flatDB - Flat database structure
 * @param {Object} fileServer - File server data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object>} Sync results
 */
async function syncBlurhashTraditional(
  client,
  flatDB,
  fileServer,
  serverConfig,
  fieldAvailability
) {
  const log = createLogger('FlatSync.BlurhashSync');
  try {
    log.info({ serverId: serverConfig.id }, 'Using traditional file-based blurhash sync');

    const results = {
      movies: { poster: 0, backdrop: 0, errors: [] },
      tvShows: { show: 0, seasons: 0, errors: [] },
    }

    // Process movies
    for (const movie of flatDB.movies) {
      try {
        const movieTitle = movie.title
        const fileServerData = fileServer?.movies?.[movie.originalTitle]
        if (!fileServerData) {
          log.debug({ movieTitle }, 'No file server data for movie');
          continue
        }

        // Process poster blurhash
        if (fileServerData.urls?.posterBlurhash) {
          const fieldPath = 'urls.posterBlurhash'

          // Check if this server has highest priority for the field
          const isHighestPriority = isCurrentServerHighestPriorityForField(
            fieldAvailability,
            'movies',
            movie.originalTitle,
            fieldPath,
            serverConfig
          )

          if (isHighestPriority) {
            // Use the poster URL as the hash key
            const posterBlurhashUrl = fileServerData.urls.posterBlurhash

            log.debug({ 
              movieTitle, 
              posterBlurhashUrl 
            }, 'Fetching movie poster blurhash');

            // Fetch the actual blurhash data using fetchMetadataMultiServer
            const posterBlurhash = await fetchMetadataMultiServer(
              serverConfig.id,
              posterBlurhashUrl,
              'blurhash',
              'movie',
              movie.originalTitle
            )

            // Only update if we got a valid blurhash and it's different from the current one
            if (posterBlurhash && posterBlurhash !== movie.posterBlurhash) {
              const updateData = {
                'blurhash.posterBlurhashSource': serverConfig.id,
                'blurhash.updatedAt': new Date(),

                // Legacy fields for backward compatibility
                posterBlurhash: posterBlurhash,
                posterBlurhashSource: serverConfig.id,
              }

              // Filter locked fields
              const filteredUpdateData = filterLockedFields(movie, updateData)

              if (Object.keys(filteredUpdateData).length > 0) {
                // Update in database
                await updateMovieInFlatDB(client, movie.originalTitle, { $set: filteredUpdateData })
                results.movies.poster++
                log.info({ 
                  movieTitle, 
                  blurhash: posterBlurhash 
                }, 'Updated poster blurhash for movie')
              }
            }
          }
        }

        // Process backdrop blurhash
        if (fileServerData.urls?.backdropBlurhash) {
          const fieldPath = 'urls.backdropBlurhash'

          const isHighestPriority = isCurrentServerHighestPriorityForField(
            fieldAvailability,
            'movies',
            movie.originalTitle,
            fieldPath,
            serverConfig
          )

          if (isHighestPriority) {
            const backdropBlurhashUrl = fileServerData.urls.backdropBlurhash

            log.debug({ 
              movieTitle, 
              backdropBlurhashUrl 
            }, 'Fetching movie backdrop blurhash');

            const backdropBlurhash = await fetchMetadataMultiServer(
              serverConfig.id,
              backdropBlurhashUrl,
              'blurhash',
              'movie',
              movie.originalTitle
            )

            if (backdropBlurhash && backdropBlurhash !== movie.backdropBlurhash) {
              const updateData = {
                'blurhash.backdropBlurhashSource': serverConfig.id,
                'blurhash.updatedAt': new Date(),

                // Legacy fields
                backdropBlurhash: backdropBlurhash,
                backdropBlurhashSource: serverConfig.id,
              }

              const filteredUpdateData = filterLockedFields(movie, updateData)

              if (Object.keys(filteredUpdateData).length > 0) {
                await updateMovieInFlatDB(client, movie.originalTitle, { $set: filteredUpdateData })
                results.movies.backdrop++
                log.info({ 
                  movieTitle, 
                  blurhash: backdropBlurhash 
                }, 'Updated backdrop blurhash for movie')
              }
            }
          }
        }
      } catch (error) {
        log.error({ 
          movieTitle: movie.title, 
          error: error.message 
        }, 'Error processing movie blurhash');
        results.movies.errors.push({ title: movie.title, error: error.message })
      }
    }

    // Process TV shows
    for (const show of flatDB.tv) {
      try {
        const showTitle = show.title
        const fileServerData = fileServer?.tv?.[show.originalTitle]
        if (!fileServerData) {
          log.debug({ showTitle }, 'No file server data for TV show');
          continue
        }

        // Process TV show poster blurhash
        if (fileServerData?.posterBlurhash) {
          const fieldPath = 'posterBlurhash'

          const isHighestPriority = isCurrentServerHighestPriorityForField(
            fieldAvailability,
            'tv',
            show.originalTitle,
            fieldPath,
            serverConfig
          )

          if (isHighestPriority) {
            const posterBlurhashURL = fileServerData.posterBlurhash

            log.debug({ 
              showTitle, 
              posterBlurhashURL 
            }, 'Fetching TV show poster blurhash');

            const posterBlurhash = await fetchMetadataMultiServer(
              serverConfig.id,
              posterBlurhashURL,
              'blurhash',
              'tv',
              showTitle
            )

            if (posterBlurhash && posterBlurhash !== show.posterBlurhash) {
              const updateData = {
                'blurhash.posterBlurhashSource': serverConfig.id,
                'blurhash.updatedAt': new Date(),

                // Legacy fields
                posterBlurhash: posterBlurhash,
                posterBlurhashSource: serverConfig.id,
              }

              const filteredUpdateData = filterLockedFields(show, updateData)

              if (Object.keys(filteredUpdateData).length > 0) {
                await client
                  .db('Media')
                  .collection('FlatTVShows')
                  .updateOne({ title: showTitle }, { $set: filteredUpdateData })
                results.tvShows.show++
                log.info({ 
                  showTitle, 
                  blurhash: posterBlurhash 
                }, 'Updated TV show poster blurhash')
              }
            }
          }
        }

        // Process TV show backdrop blurhash
        if (fileServerData?.backdropBlurhash) {
          const fieldPath = 'backdropBlurhash'

          const isHighestPriority = isCurrentServerHighestPriorityForField(
            fieldAvailability,
            'tv',
            show.originalTitle,
            fieldPath,
            serverConfig
          )

          if (isHighestPriority) {
            const backdropBlurhashUrl = fileServerData.backdropBlurhash

            log.debug({ 
              showTitle, 
              backdropBlurhashUrl 
            }, 'Fetching TV show backdrop blurhash');

            const backdropBlurhash = await fetchMetadataMultiServer(
              serverConfig.id,
              backdropBlurhashUrl,
              'blurhash',
              'tv',
              show.originalTitle
            )

            if (backdropBlurhash && backdropBlurhash !== show.backdropBlurhash) {
              const updateData = {
                'blurhash.backdropBlurhashSource': serverConfig.id,
                'blurhash.updatedAt': new Date(),

                // Legacy fields
                backdropBlurhash: backdropBlurhash,
                backdropBlurhashSource: serverConfig.id,
              }

              const filteredUpdateData = filterLockedFields(show, updateData)

              if (Object.keys(filteredUpdateData).length > 0) {
                await client
                  .db('Media')
                  .collection('FlatTVShows')
                  .updateOne({ title: showTitle }, { $set: filteredUpdateData })
                results.tvShows.show++
                log.info({ 
                  showTitle, 
                  blurhash: backdropBlurhash 
                }, 'Updated TV show backdrop blurhash')
              }
            }
          }
        }

        // Process seasons
        for (const season of show.seasons || []) {
          try {
            const seasonNumber = season.seasonNumber
            const seasonData = fileServerData.seasons?.[`Season ${seasonNumber}`]
            if (!seasonData || !seasonData?.seasonPosterBlurhash) {
              log.debug({ 
                showTitle, 
                seasonNumber 
              }, 'No season poster blurhash data');
              continue
            }

            const fieldPath = 'seasonPosterBlurhash'

            const isHighestPriority = isCurrentServerHighestPriorityForField(
              fieldAvailability,
              'tv',
              show.originalTitle,
              `seasons.Season ${seasonNumber}.${fieldPath}`,
              serverConfig
            )

            if (isHighestPriority) {
              const posterBlurhashUrl = seasonData.seasonPosterBlurhash

              log.debug({ 
                showTitle, 
                seasonNumber, 
                posterBlurhashUrl 
              }, 'Fetching season poster blurhash');

              const posterBlurhash = await fetchMetadataMultiServer(
                serverConfig.id,
                posterBlurhashUrl,
                'blurhash',
                'tv',
                show.originalTitle
              )

              if (posterBlurhash && posterBlurhash !== season.posterBlurhash) {
                const updateData = {
                  'blurhash.posterBlurhashSource': serverConfig.id,
                  'blurhash.updatedAt': new Date(),

                  // Legacy fields
                  posterBlurhash: posterBlurhash,
                  posterBlurhashSource: serverConfig.id,
                }

                const filteredUpdateData = filterLockedFields(season, updateData)

                if (Object.keys(filteredUpdateData).length > 0) {
                  await client.db('Media').collection('FlatSeasons').updateOne(
                    {
                      showTitle: showTitle,
                      seasonNumber: seasonNumber,
                    },
                    { $set: filteredUpdateData }
                  )
                  results.tvShows.seasons++
                  log.info({ 
                    showTitle, 
                    seasonNumber, 
                    blurhash: posterBlurhash 
                  }, 'Updated season poster blurhash')
                }
              }
            }
          } catch (error) {
            log.error({ 
              showTitle, 
              seasonNumber: season.seasonNumber, 
              error: error.message 
            }, 'Error processing season blurhash');
          }
        }
      } catch (error) {
        log.error({ 
          showTitle: show.title, 
          error: error.message 
        }, 'Error processing TV show blurhash');
        results.tvShows.errors.push({ title: show.title, error: error.message })
      }
    }

    log.info({
      serverId: serverConfig.id,
      moviePosters: results.movies.poster,
      movieBackdrops: results.movies.backdrop,
      tvShowPosters: results.tvShows.show,
      tvShowSeasons: results.tvShows.seasons,
      movieErrors: results.movies.errors.length,
      tvShowErrors: results.tvShows.errors.length
    }, 'Traditional blurhash sync completed');

    return {
      status: 'success',
      method: 'traditional',
      results,
    }
  } catch (error) {
    log.error({ 
      error: error.message, 
      context: 'traditional_blurhash_sync' 
    }, 'Error in traditional blurhash sync');
    
    return {
      status: 'error',
      method: 'traditional',
      error: error.message,
    }
  }
}

/**
 * Syncs blurhash data using the most efficient available method
 * @param {Object} client - MongoDB client
 * @param {Object} flatDB - Flat database structure
 * @param {Object} fileServer - File server data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object>} Sync results
 */
export async function syncBlurhashData(
  client,
  flatDB,
  fileServer,
  serverConfig,
  fieldAvailability
) {
  const log = createLogger('FlatSync.BlurhashSync');
  log.info({ serverId: serverConfig.id }, 'Starting blurhash sync')

  // Detect capabilities fresh for each sync operation
  // This defaults to unavailable until endpoint detection is fully implemented
  const capability = 'unavailable' // TODO: Enable when ready: await detectBlurhashEndpointCapabilities(serverConfig) ?? "unavailable"

  log.info({ 
    serverId: serverConfig.id, 
    capability 
  }, 'Using blurhash sync method')

  // Choose sync method based on capability
  switch (capability) {
    case BLURHASH_ENDPOINT_CAPABILITIES.OPTIMIZED:
      return syncBlurhashOptimized(client, flatDB, serverConfig, fieldAvailability)

    case BLURHASH_ENDPOINT_CAPABILITIES.BASIC:
      return syncBlurhashBasic(client, flatDB, serverConfig, fieldAvailability)

    case BLURHASH_ENDPOINT_CAPABILITIES.UNAVAILABLE:
    default:
      return syncBlurhashTraditional(client, flatDB, fileServer, serverConfig, fieldAvailability)
  }
}

// Export the main functions
export {
  BLURHASH_ENDPOINT_CAPABILITIES,
  detectBlurhashEndpointCapabilities,
  syncBlurhashOptimized,
  syncBlurhashBasic,
  syncBlurhashTraditional,
}
