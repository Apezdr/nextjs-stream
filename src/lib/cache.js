import { getRedisClient } from './redisClient';

/**
 * Retrieves cached data for a single URL from Redis.
 * Falls back to no cache if Redis isn't available.
 * @param {string} url - The URL key.
 * @returns {Object|null} - The cached entry or null if not found or caching is disabled.
 */
export async function getCache(url) {
  const client = await getRedisClient();
  if (!client) return null;

  try {
    const data = await client.get(url);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error('Error retrieving cache from Redis:', error);
    return null;
  }
}

/**
 * Sets cached data for a single URL in Redis.
 * Falls back to no cache if Redis isn't available.
 * @param {string} url - The URL key.
 * @param {Object} data - The data to cache.
 * @param {string|null} etag - The ETag value.
 * @param {string|null} lastModified - The Last-Modified value.
 * @param {number} ttl - Time-to-live in seconds (default: 3600).
 */
export async function setCache(url, data, etag = null, lastModified = null, ttl = 3600) {
  const client = await getRedisClient();
  if (!client) return;

  try {
    const timestamp = new Date();
    const payload = JSON.stringify({ data, etag, lastModified, timestamp });

    if (ttl && ttl > 0) {
      await client.setEx(url, ttl, payload);
    } else {
      await client.set(url, payload);
    }
  } catch (error) {
    console.error('Error setting cache in Redis:', error);
  }
}

/**
 * Clears cached data for a single URL in Redis.
 * Falls back to no action if Redis isn't available.
 * @param {string} url - The URL key.
 */
export async function clearCache(url) {
  const client = await getRedisClient();
  if (!client) return;

  try {
    await client.del(url);
  } catch (error) {
    console.error('Error clearing cache in Redis:', error);
  }
}

/**
 * Retrieves cached data for multiple URLs from Redis using pipelining.
 * Falls back to no cache if Redis isn't available.
 * @param {string[]} urls - An array of URL keys.
 * @returns {Object} - An object mapping URLs to their cached entries or null.
 */
export async function getCacheBatch(urls) {
    const client = await getRedisClient();
    if (!client) {
      // Return an object with all keys set to null
      const result = {};
      urls.forEach((url) => {
        result[url] = null;
      });
      return result;
    }
  
    try {
      // Redis multi command: https://redis.io/commands/multi
      // Initialize a multi instance for pipelining
      const multi = client.multi();
  
      // Queue GET commands for all URLs
      urls.forEach((url) => {
        multi.get(url);
      });
  
      // Execute the multi instance
      const responses = await multi.exec();
  
      // Map responses to their corresponding URLs
      const cacheResults = {};
      responses.forEach((record, index) => {
        const url = urls[index];
        cacheResults[url] = record ? JSON.parse(record) : null;
      });
  
      return cacheResults;
    } catch (error) {
      console.error('Error executing cache batch retrieval:', error);
      // Return all nulls in case of failure
      const result = {};
      urls.forEach((url) => {
        result[url] = null;
      });
      return result;
    }
}

/**
 * Sets cached data for multiple URLs in Redis using pipelining.
 * Falls back to no cache if Redis isn't available.
 * @param {Array} cacheEntries - An array of objects containing url, data, etag, lastModified, and ttl.
 * Example:
 * [
 *   { url: 'key1', data: {...}, etag: '...', lastModified: '...', ttl: 3600 },
 *   { url: 'key2', data: {...}, etag: '...', lastModified: '...', ttl: 3600 },
 * ]
 */
export async function setCacheBatch(cacheEntries) {
    const client = await getRedisClient();
    if (!client) return;
  
    try {
      // Initialize a multi instance for pipelining
      const multi = client.multi();
  
      cacheEntries.forEach(({ url, data, etag = null, lastModified = null, ttl = 3600 }) => {
        const timestamp = new Date();
        const payload = JSON.stringify({ data, etag, lastModified, timestamp });
  
        if (ttl && ttl > 0) {
          multi.setEx(url, ttl, payload);
        } else {
          multi.set(url, payload);
        }
      });
  
      // Execute the multi instance
      await multi.exec();
    } catch (error) {
      console.error('Error executing cache batch set:', error);
    }
}

/**
 * Clears cached data for multiple URLs in Redis using pipelining.
 * Falls back to no action if Redis isn't available.
 * @param {string[]} urls - An array of URL keys.
 */
export async function clearCacheBatch(urls) {
  const client = await getRedisClient();
  if (!client) return;

  try {
    // Initialize a pipeline
    const pipeline = client.pipeline();

    urls.forEach((url) => {
      pipeline.del(url);
    });

    // Execute the pipeline
    await pipeline.exec();
  } catch (error) {
    console.error('Error executing cache batch clear:', error);
  }
}
