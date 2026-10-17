import { multiServerHandler } from '@src/utils/config'

/**
 * Creates a full URL by combining a file path with a server configuration.
 * @param {string} path - File path
 * @param {Object} serverConfig - Server configuration
 * @returns {string} Full URL
 */
export function createFullUrl(path, serverConfig) {
  const handler = multiServerHandler.getHandler(serverConfig.id)
  return handler.createFullURL(path, false)
}
