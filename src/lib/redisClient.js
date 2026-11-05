import { createClient } from 'redis'
import { createLogger } from './logger'

// Redis is optional, and nothing may wait on it. A connect gives up after
// CONNECT_TIMEOUT_MS and never retries by itself; after any failure Redis is
// treated as off for COOL_DOWN_MS, and the next call after that tries a fresh
// client. Every call goes through withRedis, which answers its fallback when
// Redis is off, failing, or slower than the call's budget.
const CONNECT_TIMEOUT_MS = 1000
const COOL_DOWN_MS = 30_000
const DEFAULT_BUDGET_MS = 250

const log = createLogger('Redis')

let client = null // the connected client, or null
let connecting = null // the connect in flight, shared by concurrent callers
let offUntil = 0 // no Redis call before this time (ms)
let warnedUnconfigured = false

function redisConfig() {
  const { REDIS_HOST, REDIS_PORT, REDIS_PASSWORD } = process.env
  if (!REDIS_HOST || !REDIS_PORT) return null
  return { host: REDIS_HOST, port: Number(REDIS_PORT), password: REDIS_PASSWORD || undefined }
}

/** Whether REDIS_HOST and REDIS_PORT are set (it says nothing about reachability). */
export function isRedisConfigured() {
  return redisConfig() !== null
}

/** Redis is unreachable or misbehaving: drop the client and stay off for the cool-down. */
function goOff(reason, failed) {
  if (Date.now() >= offUntil) log.warn({ reason }, `Redis unavailable; going without it for ${COOL_DOWN_MS / 1000} s`)
  offUntil = Date.now() + COOL_DOWN_MS
  if (failed && client === failed) client = null
  try {
    failed?.destroy()
  } catch {
    // already closed
  }
}

async function connect(config) {
  const candidate = createClient({
    socket: { host: config.host, port: config.port, connectTimeout: CONNECT_TIMEOUT_MS, reconnectStrategy: false },
    password: config.password,
    // A command sent while disconnected fails at once instead of waiting in a queue
    disableOfflineQueue: true,
  })
  // Connection-level errors only (a failed command rejects its own promise)
  candidate.on('error', (error) => goOff(error?.message || 'connection error', candidate))
  candidate.on('end', () => {
    if (client === candidate) client = null
  })
  try {
    await candidate.connect()
    client = candidate
    log.info('Connected to Redis')
    return candidate
  } catch (error) {
    goOff(error?.message || 'connect failed', candidate)
    return null
  }
}

/**
 * The connected client, or null when Redis isn't configured, is cooling down
 * after a failure, or can't be reached. Concurrent callers share one connect.
 */
export async function getRedisClient() {
  const config = redisConfig()
  if (!config) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true
      log.info('Redis is not configured; running without it')
    }
    return null
  }
  if (Date.now() < offUntil) return null
  if (client?.isReady) return client
  connecting ??= connect(config).finally(() => {
    connecting = null
  })
  return connecting
}

/**
 * Runs one Redis call. Answers `fallback` instead of throwing or waiting when
 * Redis is off, the call fails, or connect plus call take longer than
 * `budgetMs`; a slow call also starts the cool-down, so the next requests don't
 * each wait out the budget too.
 *
 * @template T
 * @param {(redis: import('redis').RedisClientType) => Promise<T>} run
 * @param {{ budgetMs?: number, fallback?: T }} [options]
 * @returns {Promise<T>}
 */
export async function withRedis(run, { budgetMs = DEFAULT_BUDGET_MS, fallback = null } = {}) {
  let timer
  const timedOut = Symbol('timed out')
  const work = (async () => {
    const redis = await getRedisClient()
    return redis ? run(redis) : fallback
  })()
  // A call that fails after the budget ran out has no one awaiting it: Node
  // would treat that rejection as unhandled and end the process
  work.catch(() => {})
  try {
    const outcome = await Promise.race([
      work,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(timedOut), budgetMs)
      }),
    ])
    if (outcome === timedOut) {
      goOff(`no answer within ${budgetMs} ms`, null)
      return fallback
    }
    return outcome
  } catch (error) {
    log.warn({ err: error?.message }, 'Redis call failed')
    return fallback
  } finally {
    clearTimeout(timer)
  }
}
