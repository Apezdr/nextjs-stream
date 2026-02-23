/**
 * Hash storage utilities for metadata synchronization
 *
 * This module provides functions to store and retrieve metadata hashes
 * for efficient change detection during synchronization.
 */

import { createLogger, logError } from '@src/lib/logger'
import fetch from 'node-fetch'
import { getServer, multiServerHandler } from '../config'
import { httpGet } from '@src/lib/httpHelper'

/**
 * Store a hash in the database
 * @param {Object} client - MongoDB client
 * @param {string} mediaType - Media type ('tv' or 'movie')
 * @param {string|null} title - Media title (null for media type level)
 * @param {number|null} seasonNumber - Season number (null for show/movie level)
 * @param {number|null} episodeNumber - Episode number (null for season level)
 * @param {string} hash - Hash value to store
 * @param {string} serverId - Server ID that generated this hash
 * @returns {Promise<boolean>} Success indicator
 */
export async function storeHash(
  client,
  mediaType,
  title,
  seasonNumber,
  episodeNumber,
  hash,
  serverId
) {
  const log = createLogger('FlatSync.HashStorage');
  try {
    await client
      .db('Media')
      .collection('MetadataHashes')
      .updateOne(
        {
          mediaType,
          title,
          seasonNumber: seasonNumber || null,
          episodeNumber: episodeNumber || null,
          serverId,
        },
        {
          $set: {
            hash,
            updatedAt: new Date(),
          },
        },
        { upsert: true }
      )
    return true
  } catch (error) {
    logError(log, error, {
      mediaType,
      title,
      seasonNumber,
      episodeNumber,
      serverId,
      context: 'store_hash'
    })
    return false
  }
}

/**
 * Retrieve a stored hash from the database for a specific server
 * @param {Object} client - MongoDB client
 * @param {string} mediaType - Media type ('tv' or 'movie')
 * @param {string|null} title - Media title (null for media type level)
 * @param {number|null} seasonNumber - Season number (null for show/movie level)
 * @param {number|null} episodeNumber - Episode number (null for season level)
 * @param {string} serverId - Server ID to retrieve hash for
 * @returns {Promise<string|null>} Stored hash or null if not found
 */
export async function getStoredHash(
  client,
  mediaType,
  title,
  seasonNumber,
  episodeNumber,
  serverId
) {
  const log = createLogger('FlatSync.HashStorage');
  try {
    const query = {}
    if (mediaType) query.mediaType = mediaType
    if (title) query.title = title
    if (seasonNumber) query.seasonNumber = seasonNumber
    if (episodeNumber) query.episodeNumber = episodeNumber
    if (serverId) query.serverId = serverId

    const record = await client.db('Media').collection('MetadataHashes').findOne(query)

    if (!record) {
      log.warn({
        mediaType,
        title,
        seasonNumber,
        episodeNumber,
        serverId,
        context: 'hash_not_found'
      }, 'No stored hash found for entity/server')
      return null
    }

    return record.hash
  } catch (error) {
    logError(log, error, {
      mediaType,
      title,
      seasonNumber,
      episodeNumber,
      serverId,
      context: 'get_stored_hash'
    })
    return null
  }
}

/**
 * Retrieve all stored hashes from the database for a given media entity
 * @param {Object} client - MongoDB client
 * @param {string} mediaType - Media type ('tv' or 'movie')
 * @param {string|null} title - Media title (null for media type level)
 * @param {number|null} seasonNumber - Season number (null for show/movie level)
 * @param {number|null} episodeNumber - Episode number (null for season level)
 * @returns {Promise<Object>} Object mapping server IDs to their respective hashes
 */
export async function getAllStoredHashes(client, mediaType, title, seasonNumber, episodeNumber) {
  const log = createLogger('FlatSync.HashStorage');
  try {
    const records = await client
      .db('Media')
      .collection('MetadataHashes')
      .find({
        mediaType,
        title,
        seasonNumber: seasonNumber || null,
        episodeNumber: episodeNumber || null,
      })
      .toArray()

    // Create map of server ID to hash
    return records.reduce((map, record) => {
      if (record.serverId && record.hash) {
        map[record.serverId] = record.hash
      }
      return map
    }, {})
  } catch (error) {
    logError(log, error, {
      mediaType,
      title,
      seasonNumber,
      episodeNumber,
      context: 'get_all_hashes'
    })
    return {}
  }
}

/**
 * Retrieve all stored hashes for a TV show, including show, season, and episode level hashes
 * @param {Object} client - MongoDB client
 * @param {string} showTitle - TV show title
 * @param {string} serverId - Server ID to retrieve hashes for
 * @returns {Promise<Object>} Hierarchical object containing all hashes for the show
 */
export async function getStoredHashesForShow(client, showTitle, serverId) {
  const log = createLogger('FlatSync.HashStorage');
  try {
    // Query all hashes related to this show from a specific server in a single database call
    const records = await client
      .db('Media')
      .collection('MetadataHashes')
      .find({
        mediaType: 'tv',
        title: showTitle,
        serverId,
      })
      .toArray()

    // Initialize the result structure
    const result = {
      show: null, // Show-level hash
      seasons: {}, // Season-level hashes indexed by seasonNumber
      episodes: {}, // Episode-level hashes indexed by seasonNumber and episodeNumber
    }

    // Populate the result structure from the records
    for (const record of records) {
      // Show-level hash (no seasonNumber and no episodeNumber)
      if (record.seasonNumber === null && record.episodeNumber === null) {
        result.show = record.hash
      }
      // Season-level hash (has seasonNumber but no episodeNumber)
      else if (record.seasonNumber !== null && record.episodeNumber === null) {
        result.seasons[record.seasonNumber] = record.hash
      }
      // Episode-level hash (has both seasonNumber and episodeNumber)
      else if (record.seasonNumber !== null && record.episodeNumber !== null) {
        // Initialize the season object if it doesn't exist
        if (!result.episodes[record.seasonNumber]) {
          result.episodes[record.seasonNumber] = {}
        }
        // Store the episode hash
        result.episodes[record.seasonNumber][record.episodeNumber] = record.hash
      }
    }

    return result
  } catch (error) {
    logError(log, error, {
      showTitle,
      serverId,
      context: 'get_show_hashes'
    })
    return { show: null, seasons: {}, episodes: {} }
  }
}

/**
 * Fetch hash data from the server
 * @param {Object} serverConfig - Server configuration
 * @param {string} mediaType - Media type ('tv' or 'movie')
 * @param {string|null} title - Media title (optional)
 * @param {number|null} seasonNumber - Season number (optional)
 * @returns {Promise<Object|null>} Hash data or null if fetch failed
 */
export async function fetchHashData(serverConfig, mediaType, title = null, seasonNumber = null) {
  const log = createLogger('FlatSync.HashStorage.Fetch');
  try {
    // Make sure we have a valid server config
    if (!serverConfig || !serverConfig.id) {
      log.warn({ serverConfig, context: 'invalid_server_config' }, 'Invalid server config for hash data fetch')
      return null
    }

    // Construct the path for the hash data
    let path = `/api/metadata-hashes/${mediaType}`

    if (title) {
      path += `/${encodeURIComponent(title)}`

      if (seasonNumber !== null) {
        path += `/${seasonNumber}`
      }
    }

    // Use the multiServerHandler to create the full URL
    const server = getServer(serverConfig.id)
    // Using internalEndpoint for server-to-server requests; falls back to syncEndpoint if unset.
    const fullUrl = `${server.internalEndpoint || server.syncEndpoint}${path}`

    log.debug({ fullUrl, serverId: serverConfig.id }, 'Fetching hash data');

    const response = await httpGet(
      fullUrl,
      {
        timeout: 3000,
        responseType: 'json',
        retry: {
          limit: 4,
          baseDelay: 1000,
          maxDelay: 5000,
        },
      },
      true
    )

    // Normalize the response data structure to handle both cached and fresh responses
    // Cached responses wrap data in response.data.data, fresh responses use response.data
    const responseData = response.data?.data || response.data

    if (!responseData) {
      log.warn({
        status: response.headers[':status'],
        fullUrl,
        context: 'fetch_hash_data_empty'
      }, 'Failed to fetch hash data');
      return null
    }

    return responseData
  } catch (error) {
    logError(log, error, {
      serverId: serverConfig?.id,
      mediaType,
      title,
      seasonNumber,
      context: 'fetch_hash_data'
    })
    return null
  }
}
