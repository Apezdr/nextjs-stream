/**
 * @typedef {Object} SyncPaths
 * @property {string} tv - Path for TV show synchronization
 * @property {string} movies - Path for movie synchronization
 */

/**
 * @typedef {Object} ServerPaths
 * @property {SyncPaths} sync - Synchronization paths
 */

/**
 * @typedef {Object} FileServerConfig
 * @property {string} id - Unique identifier for the file server
 * @property {string} baseURL - Base URL for the file server
 * @property {string} prefixPath - Prefix path for media files
 * @property {string} syncEndpoint - Base endpoint for sync operations
 * @property {ServerPaths} paths - Server-specific paths
 * @property {boolean} isDefault - Whether this is the default server
 */

/**
 * Standard path configuration for all servers
 */
const SYNC_PATHS = {
  TV: '/media/tv',
  MOVIES: '/media/movies'
}

/**
 * Creates standardized sync URLs for a server
 * @param {string} serverBaseUrl - Base URL of the server
 * @returns {SyncPaths} Standardized sync paths
 */
const createSyncUrls = cache((serverBaseUrl) => {
  return {
    tv: `${serverBaseUrl}${SYNC_PATHS.TV}`,
    movies: `${serverBaseUrl}${SYNC_PATHS.MOVIES}`
  }
})

/**
 * Creates a server configuration object
 * @param {Object} params - Server configuration parameters
 * @returns {FileServerConfig} Complete server configuration
 */
const createServerConfig = cache(({ 
  id, 
  baseURL, 
  prefixPath = '', 
  syncEndpoint, 
  isDefault = false,
  priority = 1
}) => {
  return {
    id,
    baseURL,
    prefixPath,
    syncEndpoint,
    paths: {
      sync: createSyncUrls(syncEndpoint)
    },
    isDefault,
    priority
  }
})

/**
 * Loads server configurations from environment variables
 * @returns {FileServerConfig[]} Array of server configurations
 */
const loadServerConfigurations = cache(() => {
  const servers = []
  
  // Always add the default server first
  servers.push(createServerConfig({
    id: 'default',
    baseURL: process.env.NEXT_PUBLIC_FILE_SERVER_URL || 'http://localhost:3000',
    prefixPath: process.env.NEXT_PUBLIC_FILE_SERVER_PREFIX_PATH || '',
    syncEndpoint: process.env.NEXT_PUBLIC_NODE_SERVER_URL || 'http://localhost:3000',
    isDefault: true,
    priority: 1
  }))

  // Load additional servers
  let serverIndex = 2
  while (process.env[`NEXT_PUBLIC_NODE_SERVER_URL_${serverIndex}`]) {
    servers.push(createServerConfig({
      id: `server${serverIndex}`,
      baseURL: process.env[`NEXT_PUBLIC_FILE_SERVER_URL_${serverIndex}`],
      prefixPath: process.env[`NEXT_PUBLIC_FILE_SERVER_PREFIX_PATH_${serverIndex}`] || '',
      syncEndpoint: process.env[`NEXT_PUBLIC_NODE_SERVER_URL_${serverIndex}`],
      isDefault: false,
      priority: serverIndex
    }))
    serverIndex++
  }

  return servers
})

/**
 * Server manager class to handle multiple servers
 */
class ServerManager {
  constructor(servers) {
    this.servers = new Map(servers.map(server => [server.id, server]))
    this.defaultServerId = servers.find(s => s.isDefault)?.id
    
    if (!this.defaultServerId) {
      throw new Error('No default server configured')
    }
  }

  /**
   * Get a server configuration by ID
   * @param {string} [serverId] - Server ID (uses default if not specified)
   * @returns {FileServerConfig} Server configuration
   */
  getServer(serverId) {
    const server = this.servers.get(serverId || this.defaultServerId)
    if (!server) {
      throw new Error(`No server found with ID: ${serverId}`)
    }
    return server
  }
  
  /**
   * Get the priority of a server by ID
   * @param {string} serverId - Server ID
   * @returns {number} Priority of the server
   */
  getServerPriority(serverId) {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error(`No server found with ID: ${serverId}`);
    }
    return server.priority;
  }

  /**
   * Get sync URLs for a specific server
   * @param {string} [serverId] - Server ID (uses default if not specified)
   * @returns {SyncPaths} Sync URLs for the server
   */
  getSyncUrls(serverId) {
    return this.getServer(serverId).paths.sync
  }

  /**
   * Get all configured servers
   * @returns {FileServerConfig[]} Array of all server configurations
   */
  getAllServers() {
    return Array.from(this.servers.values())
  }

  /**
   * Get the number of configured servers
   * @returns {number} Number of servers
   */
  getServerCount() {
    return this.servers.size
  }

  /**
   * Get the default server
   * @returns {FileServerConfig} Default server configuration
   */
  getDefaultServer() {
    return this.getServer(this.defaultServerId)
  }
}

// Initialize server configurations
const serverManager = new ServerManager(loadServerConfigurations())

import { cache } from 'react'
// Create URL handlers for all servers
import { createURLHandler, createMultiServerURLHandler } from './url_utils'

/**
 * Determines whether the current server has higher priority than the existing source.
 * @param {string} existingSourceId - The server ID of the existing source.
 * @param {Object} serverConfig - The current server configuration.
 * @returns {boolean} - True if current server has higher priority, or if existing source is undefined.
 */
export function isCurrentServerHigherPriority(existingSourceId, serverConfig) {
  if (!existingSourceId) {
    return true;
  }

  const existingPriority = serverManager.getServerPriority(existingSourceId);
  const currentPriority = serverManager.getServerPriority(serverConfig.id);

  return currentPriority < existingPriority || currentPriority === existingPriority;
}

// Create handlers for all servers
const urlHandlers = new Map(
  serverManager.getAllServers().map(server => [
    server.id,
    createURLHandler(server)
  ])
)

// Export the multi-server handler
export const multiServerHandler = createMultiServerURLHandler(serverManager.getAllServers())

// Basic configuration exports
export const organizrURL = process.env.NEXT_PUBLIC_ORGANIZR_URL || 'http://localhost:3000'
export const siteTitle = process.env.NEXT_PUBLIC_SITE_TITLE || 'Cinema Sanctuary'
export const siteDescription = process.env.NEXT_PUBLIC_SITE_DESCRIPTION || 'Sharing media content with friends and family.'
export const adminUserEmails = process.env.NEXT_PUBLIC_ADMIN_USER_EMAILS
  ? process.env.NEXT_PUBLIC_ADMIN_USER_EMAILS.split(',').map((email) => email.trim())
  : []

// Export server management functions
export const getServer = serverManager.getServer.bind(serverManager)
export const getSyncUrls = serverManager.getSyncUrls.bind(serverManager)
export const getAllServers = serverManager.getAllServers.bind(serverManager)
export const getServerCount = serverManager.getServerCount.bind(serverManager)
export const getDefaultServer = serverManager.getDefaultServer.bind(serverManager)

// Backwards compatibility exports (all using default server)
const defaultServer = serverManager.getDefaultServer()
export const nodeJSURL = defaultServer.syncEndpoint
export const syncTVURL = defaultServer.paths.sync.tv
export const syncMoviesURL = defaultServer.paths.sync.movies
export const fileServerURL = defaultServer.baseURL
export const fileServerPrefixPath = defaultServer.prefixPath
export const fileServerURLWithoutPrefixPath = defaultServer.baseURL
export const fileServerURLWithPrefixPath = (path) => urlHandlers.get(defaultServer.id).createFullURL(path ?? '')

// Version Support
// Update to identify the front end support for
// File Server code changes
// Version Format: 1.0000 (Major.Minor)
export const fileServerVersionTV = 1.0001
export const fileServerVersionMOVIES = 1.0000
