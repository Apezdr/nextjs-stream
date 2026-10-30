/**
 * Reading a file the processor publishes (a metadata.json, a .blurhash) from
 * a file server, for the sync.
 *
 * One HTTP limiter: the request goes through the ResourceManager's
 * (SYNC_HTTP_CONCURRENCY), the one the movie assets' blurhash fetch uses too.
 * Callers must not wrap fetchMetadataMultiServer in
 * `resourceManager.throttleHttp` themselves: a caller holding a slot while this
 * waits for another deadlocks the pass once every slot is held that way.
 */

import { httpGet } from '@src/lib/httpHelper'
import { getCache, setCache } from '@src/lib/cache'
import { getServer } from '@src/utils/config'
import { ResourceManager } from '../../core/ResourceManager'
import { fileServerUrl } from './urls'

// Cache TTLs for different types of data (in seconds)
const CACHE_TTL = {
  blurhash: 86400 * 7, // 7 days for blurhash data (rarely changes)
  file: 3600, // 1 hour for regular files
  bytes: 3600, // 1 hour, as a file
  default: 3600, // Default 1 hour
}

/**
 * A `bytes` file is cached as base64 (the cache stores JSON) and handed back
 * as a Buffer, whichever way it came: fresh, Not Modified, or the cached copy
 * after a failed request. The bytes are the ones the server sent, never
 * decoded and encoded again, so a hash of them is a hash of the file.
 */
function bytesOut(stored: unknown): Buffer | null {
  return typeof stored === 'string' && stored !== '' ? Buffer.from(stored, 'base64') : null
}

/**
 * Fetch a file from a file server, with a Redis cache, conditional requests
 * and retries.
 *
 * What comes back:
 * - no URL: `{}`
 * - the file: the parsed JSON, the blurhash text trimmed, or the raw bytes as a
 *   Buffer (`bytes`: a credits sidecar, whose bytes are hashed before they
 *   are decoded)
 * - a blurhash cached less than a day ago: the cached one, without a request
 * - Not Modified, or a request that fails (an error, an empty body, a cache
 *   write that throws) while a copy is cached: the cached copy
 * - anything else that fails: `''` for a blurhash, null for a file or bytes
 *
 * @param serverId - The file server's id
 * @param metadataUrl - The file's path as the payload gives it, or the full URL
 *   built from it
 * @param type - 'file' (JSON), 'blurhash' (text, trimmed) or 'bytes' (a Buffer)
 * @param mediaType - For the debug log only
 * @param title - For the debug log only
 * @param headers - Request headers; the conditional ones are added from the cache
 * @param cacheKey - The Redis key
 */
export async function fetchMetadataMultiServer(
  serverId: string,
  metadataUrl: string | null | undefined,
  type: 'file' | 'blurhash' | 'bytes' = 'file',
  mediaType?: string,
  title?: string,
  headers: Record<string, string> = {},
  cacheKey = `${serverId}:${type}:${metadataUrl}`
): Promise<any> {
  // Early return if no metadata URL is provided
  if (!metadataUrl) {
    return {}
  }

  try {
    // First, try to get from cache to avoid unnecessary processing
    const cachedEntry = await getCache(cacheKey)
    if (cachedEntry && cachedEntry.data) {
      // For blurhash data, we can use the cached version but still allow for periodic refresh
      if (type === 'blurhash') {
        const cacheAge = cachedEntry.timestamp
          ? (Date.now() - new Date(cachedEntry.timestamp).getTime()) / 1000
          : Infinity

        // If the cache is less than 1 day old for blurhash, use it directly
        if (cacheAge < 86400) {
          return cachedEntry.data
        }
        // Otherwise, continue with the fetch but use cached data as fallback
      }

      // Set conditional headers if available
      if (cachedEntry?.etag) {
        headers['If-None-Match'] = cachedEntry.etag
      }
      if (cachedEntry.lastModified) {
        headers['If-Modified-Since'] = cachedEntry.lastModified
      }
    }

    const server = getServer(serverId)
    if (!server || server.id !== serverId) {
      throw new Error(`No file server with id ${serverId}`)
    }
    const normalizedUrl = fileServerUrl(metadataUrl, { baseUrl: server.baseURL })

    // Only this server's files: an absolute URL on another host is not fetched.
    const serverRoot = server.baseURL.endsWith('/') ? server.baseURL : `${server.baseURL}/`
    if (!normalizedUrl.startsWith(serverRoot)) {
      throw new Error(`URL is not on file server ${serverId}: ${normalizedUrl}`)
    }
    // Validate URL format
    const matches = normalizedUrl.match(/https?:\/\//g)
    if (matches && matches.length > 1) {
      throw new Error(`URL is incorrectly normalized: ${normalizedUrl}`)
    }

    const fetchFunction = async () => {
      try {
        const timeoutMs = type === 'blurhash' ? 3000 : 5000
        // A variable, not a literal: httpGet reads http2, which its JSDoc type leaves out.
        const requestOptions = {
          headers,
          timeout: timeoutMs,
          responseType: type === 'file' ? 'json' : type === 'bytes' ? 'buffer' : 'text',
          http2: true,
          retry: { limit: 2, baseDelay: 300 },
        }
        const { data, headers: responseHeaders } = await httpGet(normalizedUrl, requestOptions)

        // Handle 304 Not Modified
        if (data === null && cachedEntry) {
          return cachedEntry.data
        }

        // Process the data based on type
        // A cached text body comes back wrapped ({ _dataType: 'text', data })
        const body = type === 'blurhash' && data && typeof data === 'object' && data._dataType === 'text' ? data.data : data
        const processedData =
          type === 'blurhash'
            ? body ? body.trim() : null
            : type === 'bytes'
              ? Buffer.isBuffer(body) && body.length > 0 ? body.toString('base64') : null
              : body

        if (!processedData) {
          throw new Error('Empty or null response data')
        }

        // Use different TTLs based on the type of data
        const ttl = CACHE_TTL[type] || CACHE_TTL.default

        // Update the cache with the new data
        await setCache(
          cacheKey,
          processedData,
          responseHeaders?.etag ?? cachedEntry?.etag ?? null,
          responseHeaders['last-modified'] || cachedEntry?.lastModified,
          ttl
        )

        return processedData
      } catch (fetchError) {
        // If we have cached data, return it as a fallback
        if (cachedEntry && cachedEntry.data) {
          if (Boolean(process.env.DEBUG) == true) {
            console.warn(`Fetch failed, using cached data for ${metadataUrl}: ${fetchError.message}`)
          }
          return cachedEntry.data
        }
        throw fetchError // Re-throw if no cached data
      }
    }

    // The request takes a slot of the sync's one HTTP limiter (retry is handled by httpGet)
    const data = await ResourceManager.getInstance().throttleHttp(fetchFunction)

    return type === 'bytes' ? bytesOut(data) : data
  } catch (error) {
    if (Boolean(process.env.DEBUG) == true) {
      console.error('Error fetching metadata:', {
        serverId,
        url: metadataUrl,
        error: error.message,
        mediaType,
        title,
      })
    }

    // For blurhash, return an empty string as fallback
    if (type === 'blurhash') {
      return ''
    }

    return null
  }
}
