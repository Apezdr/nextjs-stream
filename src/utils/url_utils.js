/**
 * Represents a file server configuration
 * @typedef {Object} FileServer
 * @property {string} baseURL - The base URL of the file server
 * @property {string} prefixPath - The prefix path for the file server
 * @property {string} id - Unique identifier for the file server
 */

/**
 * Creates a URL handler for a specific file server configuration
 * @param {FileServer} fileServer - The file server configuration
 * @returns {Object} URL handling utilities for the file server
 */
export function createURLHandler(fileServer) {
    const { baseURL, prefixPath = '' } = fileServer

    /**
     * Strips the prefix path from a URL if present
     * @param {string} url - The URL to process
     * @returns {string} URL without the prefix path
     */
    function stripPrefixPath(url) {
        if (!url) return ''
        return url.replace(new RegExp(`^${baseURL}${prefixPath}/?`), '')
    }

    /**
     * Creates a full URL by combining the base URL, prefix path, and relative path
     * @param {string} path - The relative path to be appended
     * @param {boolean} addPrefix - Whether to add the prefix path
     * @returns {string} The full URL
     */
    function createFullURL(path, addPrefix = true) {
        //if (!path) return ''
        // Remove any leading slashes from the path
        const cleanPath = path.replace(/^\/+/, '')
        if (addPrefix) {
            // Ensure prefix path has no trailing slash
            const cleanPrefix = prefixPath.replace(/\/+$/, '')
            return `${baseURL}${cleanPrefix}/${cleanPath}`
        }
        // Ensure prefix path has no trailing slash
        return `${baseURL}/${cleanPath}`
    }

    /**
     * Determines if a URL needs to be updated based on a new path
     * @param {string} currentUrl - The current URL
     * @param {string} newPath - The new path
     * @returns {boolean} Whether the URL needs updating
     */
    function needsUpdate(currentUrl, newPath) {
        if (!newPath) return false
        if (!currentUrl) return true
        return newPath !== stripPrefixPath(currentUrl)
    }

    /**
     * Updates URLs in an object based on provided field configurations
     * @param {Object} current - Current object with URLs
     * @param {Object} fileServerData - New file server data
     * @param {Array<{name: string, path: string|Function}>} fields - Field configurations
     * @returns {Object} Updated URL fields
     */
    function processURLUpdates(current, fileServerData, fields) {
        const updates = {}

        for (const field of fields) {
            const path = typeof field.path === 'function'
                ? field.path(fileServerData)
                : fileServerData[field.name] || fileServerData.urls?.[field.name]

            if (needsUpdate(current[field.name], path)) {
                updates[field.name] = createFullURL(path)
            }
        }

        return updates
    }

    return {
        stripPrefixPath,
        createFullURL,
        needsUpdate,
        processURLUpdates,
        getBaseURL: () => baseURL,
        getPrefixPath: () => prefixPath,
    }
}

/**
 * Creates a multi-server URL handler
 * @param {FileServer[]} fileServers - Array of file server configurations
 * @returns {Object} Multi-server URL handling utilities
 */
export function createMultiServerURLHandler(fileServers) {
    const handlers = new Map(
        fileServers.map(server => [server.id, createURLHandler(server)])
    )

    return {
        /**
         * Gets the URL handler for a specific server
         * @param {string} serverId - The server identifier
         * @returns {Object} The URL handler for the specified server
         */
        getHandler(serverId) {
            const handler = handlers.get(serverId)
            if (!handler) {
                throw new Error(`No handler found for server ID: ${serverId}`)
            }
            return handler
        },

        /**
         * Creates a full URL for a specific server
         * @param {string} serverId - The server identifier
         * @param {string} path - The path to append
         * @returns {string} The full URL
         */
        createFullURL(serverId, path, addPrefix = true) {
            return this.getHandler(serverId).createFullURL(path, addPrefix)
        },

        /**
         * Determines which server a URL belongs to
         * @param {string} url - The URL to check
         * @returns {string|null} The server ID or null if no match
         */
        identifyServer(url) {
            for (const [id, handler] of handlers) {
                if (url.startsWith(handler.getBaseURL())) {
                    return id
                }
            }
            return null
        }
    }
}

