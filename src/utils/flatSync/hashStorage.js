/**
 * Hash storage utilities for metadata synchronization
 * 
 * This module provides functions to store and retrieve metadata hashes
 * for efficient change detection during synchronization.
 */

import fetch from "node-fetch";
import { getServer, multiServerHandler } from "../config";

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
export async function storeHash(client, mediaType, title, seasonNumber, episodeNumber, hash, serverId) {
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
          serverId
        },
        { 
          $set: { 
            hash,
            updatedAt: new Date()
          }
        },
        { upsert: true }
      );
    return true;
  } catch (error) {
    console.error('Error storing hash:', error);
    return false;
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
export async function getStoredHash(client, mediaType, title, seasonNumber, episodeNumber, serverId) {
  try {
    const query = {}
    if (mediaType) query.mediaType = mediaType;
    if (title) query.title = title;
    if (seasonNumber) query.seasonNumber = seasonNumber;
    if (episodeNumber) query.episodeNumber = episodeNumber;
    if (serverId) query.serverId = serverId;

    const record = await client
      .db('Media')
      .collection('MetadataHashes')
      .findOne(query);
    
    if (!record) {
      console.warn(`No hash found for ${mediaType} ${title} (${seasonNumber ? `S${seasonNumber}` : ""}${episodeNumber ? `E${episodeNumber}` : ""}) on server ${serverId}`);
      return null;
    }
    
    return record.hash;
  } catch (error) {
    console.error('Error retrieving hash:', error);
    return null;
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
  try {
    const records = await client
      .db('Media')
      .collection('MetadataHashes')
      .find({
        mediaType,
        title,
        seasonNumber: seasonNumber || null,
        episodeNumber: episodeNumber || null
      })
      .toArray();
    
    // Create map of server ID to hash
    return records.reduce((map, record) => {
      if (record.serverId && record.hash) {
        map[record.serverId] = record.hash;
      }
      return map;
    }, {});
  } catch (error) {
    console.error('Error retrieving all hashes:', error);
    return {};
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
  try {
    // Make sure we have a valid server config
    if (!serverConfig || !serverConfig.id) {
      console.warn('Invalid server config for hash data fetch');
      return null;
    }
    
    // Construct the path for the hash data
    let path = `/api/metadata-hashes/${mediaType}`;
    
    if (title) {
      path += `/${encodeURIComponent(title)}`;
      
      if (seasonNumber !== null) {
        path += `/${seasonNumber}`;
      }
    }
    
    // Use the multiServerHandler to create the full URL
    const server = getServer(serverConfig.id);
    const fullUrl = `${server.syncEndpoint}${path}`;
    
    console.log(`Fetching hash data from: ${fullUrl}`);
    
    const response = await fetch(fullUrl, { 
      headers: { 'Cache-Control': 'no-cache' },
      next: { revalidate: 0 }
    });
    
    if (!response.ok) {
      console.warn(`Failed to fetch hash data: ${response.status} ${response.statusText}`);
      return null;
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error fetching hash data:', error);
    return null;
  }
}
