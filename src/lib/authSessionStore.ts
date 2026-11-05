// src/lib/authSessionStore.ts
// better-auth's secondaryStorage, on Redis. Mongo stays the record: auth.ts
// stores sessions and verification values in the database as well
// (storeSessionInDatabase, verification.storeInDatabase), so whenever Redis is
// off, slow or missing a key, better-auth reads Mongo. What Redis saves is the
// session + user lookup that nearly every request makes.
//
// Three things better-auth leaves to us:
// - It never copies a session it read from Mongo into Redis. rememberSession()
//   does, after a request's lookup (cachedAuth.js).
// - It refreshes its cached copy of a user only through its own updateUser.
//   Our own writes to users and their sessions (userQueries, account
//   deletion) call forgetUserSessions(), so those users' next requests read
//   Mongo again.
// - No entry outlives SESSION_CACHE_TTL_SECONDS. That bounds what a forget
//   that never reached Redis (it was down at the time) can leave behind.
// The stored shapes are better-auth 1.7's own; the guard test in
// __tests__/lib/authSessionStore.test.js reads its dist to catch a change.
import 'server-only'
import { withRedis } from '@src/lib/redisClient'

/** The longest any cached session, session list or verification value lives in Redis. */
export const SESSION_CACHE_TTL_SECONDS = 15 * 60

const cappedTtl = (ttl?: number) =>
  Math.max(1, Math.min(ttl && ttl > 0 ? Math.floor(ttl) : SESSION_CACHE_TTL_SECONDS, SESSION_CACHE_TTL_SECONDS))

const activeSessionsKey = (userId: string) => `active-sessions-${userId}`

type SessionReference = { token: string; expiresAt: number }

function parseReferences(raw: unknown): SessionReference[] {
  if (typeof raw !== 'string') return []
  try {
    const list = JSON.parse(raw)
    return Array.isArray(list) ? list.filter((s) => s && typeof s.token === 'string' && typeof s.expiresAt === 'number') : []
  } catch {
    return []
  }
}

// Keys whose Redis read missed in the last minute: a session among them came
// from Mongo, and rememberSession copies it in. Bounded, so a flood of
// unknown tokens can't grow it.
const MISS_WINDOW_MS = 60_000
const MISSES_MAX = 10_000
const recentMisses = new Map<string, number>()

function noteMiss(key: string) {
  if (recentMisses.size >= MISSES_MAX) {
    const cutoff = Date.now() - MISS_WINDOW_MS
    for (const [missed, at] of recentMisses) if (at < cutoff) recentMisses.delete(missed)
    if (recentMisses.size >= MISSES_MAX) recentMisses.clear()
  }
  recentMisses.set(key, Date.now())
}

function takeMiss(key: string) {
  const at = recentMisses.get(key)
  recentMisses.delete(key)
  return at !== undefined && Date.now() - at < MISS_WINDOW_MS
}

// Rate-limit counters while Redis is off, so sign-in throttling keeps working
// (per process) instead of switching off
const localCounters = new Map<string, { count: number; expiresAt: number }>()

function localIncrement(key: string, ttlSeconds: number) {
  const now = Date.now()
  if (localCounters.size > 10_000) {
    for (const [counted, entry] of localCounters) if (entry.expiresAt <= now) localCounters.delete(counted)
  }
  const entry = localCounters.get(key)
  if (!entry || entry.expiresAt <= now) {
    localCounters.set(key, { count: 1, expiresAt: now + ttlSeconds * 1000 })
    return 1
  }
  entry.count += 1
  return entry.count
}

/** better-auth's SecondaryStorage. Reads answer null and writes give up quietly when Redis is unavailable. */
export const authSecondaryStorage = {
  async get(key: string) {
    const value = await withRedis((redis) => redis.get(key))
    if (value === null) noteMiss(key)
    return value
  },
  getAndDelete: (key: string) => withRedis((redis) => redis.getDel(key)),
  async set(key: string, value: string, ttl?: number) {
    await withRedis((redis) => redis.setEx(key, cappedTtl(ttl), value))
  },
  async delete(key: string) {
    await withRedis((redis) => redis.del(key))
  },
  async increment(key: string, ttl: number) {
    const counted = await withRedis(async (redis) => {
      // The TTL is set when the counter is created, never extended (better-auth's contract)
      const [count] = await redis.multi().incr(key).expire(key, ttl, 'NX').exec()
      return Number(count)
    })
    return typeof counted === 'number' && Number.isFinite(counted) ? counted : localIncrement(key, ttl)
  },
}

interface SessionLookup {
  session?: { token?: string; userId?: string; expiresAt?: string | Date } | null
  user?: unknown
}

/**
 * Copies a session better-auth just read from Mongo into Redis, with its user,
 * in better-auth's shape: the token's entry `{ session, user }`, and the token
 * in the user's active-sessions list (which updateUser and the revokes walk).
 * A lookup Redis already answered is left alone. Never throws.
 */
export async function rememberSession(lookup: SessionLookup | null | undefined) {
  const session = lookup?.session
  const token = session?.token
  const userId = session?.userId
  if (!session || !token || !userId || !takeMiss(token)) return
  const expiresAt = new Date(session.expiresAt ?? 0).getTime()
  const now = Date.now()
  if (!(expiresAt > now)) return
  const ttl = Math.min(SESSION_CACHE_TTL_SECONDS, Math.floor((expiresAt - now) / 1000))
  if (ttl < 1) return
  const entry = JSON.stringify({ session, user: lookup?.user })
  const listKey = activeSessionsKey(String(userId))
  await withRedis(async (redis) => {
    const references = parseReferences(await redis.get(listKey))
      .filter((s) => s.token !== token && s.expiresAt > now)
      .concat([{ token, expiresAt }])
      .sort((a, b) => a.expiresAt - b.expiresAt)
    await redis
      .multi()
      .setEx(token, ttl, entry)
      .setEx(listKey, SESSION_CACHE_TTL_SECONDS, JSON.stringify(references))
      .exec()
  })
}

/**
 * Drops a user's cached sessions after our own write to the user or their
 * sessions, so their next request reads Mongo (and rememberSession caches the
 * fresh copy). Never throws; Redis being down leaves the entries to expire
 * within SESSION_CACHE_TTL_SECONDS.
 */
export async function forgetUserSessions(userIds: unknown | unknown[]) {
  const ids = (Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean).map(String)
  if (ids.length === 0) return
  await withRedis(
    async (redis) => {
      for (const id of ids) {
        const listKey = activeSessionsKey(id)
        const tokens = parseReferences(await redis.get(listKey)).map((s) => s.token)
        await redis.del([...tokens, listKey])
      }
    },
    { budgetMs: 1000 }
  )
}
