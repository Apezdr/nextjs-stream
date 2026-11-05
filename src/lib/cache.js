import { withRedis } from './redisClient'

// The sync's file cache (fetchFile): a fetched file with its ETag and
// Last-Modified, so the next fetch can be conditional and a failed fetch can
// fall back to it. Redis is optional; without it these read nothing and
// store nothing, and neither ever waits longer than withRedis's budget.

/**
 * @param {string} key
 * @returns {Promise<{ data: any, etag: string|null, lastModified: string|null, timestamp: string } | null>}
 */
export async function getCache(key) {
  return withRedis(async (redis) => {
    const raw = await redis.get(key)
    return raw ? JSON.parse(raw) : null
  })
}

/**
 * @param {string} key
 * @param {any} data - JSON-serializable
 * @param {string|null} [etag]
 * @param {string|null} [lastModified]
 * @param {number} ttl - Seconds; every entry expires
 */
export async function setCache(key, data, etag = null, lastModified = null, ttl) {
  if (!(ttl > 0)) throw new Error('setCache needs a positive ttl: every entry expires')
  const payload = JSON.stringify({ data, etag, lastModified, timestamp: new Date() })
  await withRedis((redis) => redis.setEx(key, ttl, payload))
}
