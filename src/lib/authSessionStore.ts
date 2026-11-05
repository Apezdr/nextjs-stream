// src/lib/authSessionStore.ts
// better-auth's secondaryStorage, on Redis. Mongo stays the record: auth.ts
// stores sessions and verification values in the database as well
// (storeSessionInDatabase, verification.storeInDatabase), so whenever Redis is
// off, slow or missing a key, better-auth reads Mongo. What Redis saves is the
// session + user lookup that nearly every request makes.
//
// What better-auth leaves to us, handled here:
// - It never copies a session it read from Mongo into Redis. rememberSession()
//   does, after a request's lookup (cachedAuth.js).
// - It refreshes its cached copy of a user only through its own updateUser.
//   Our own writes to users and their sessions (userQueries, account
//   deletion) call forgetUserSessions(), so those users' next requests read
//   Mongo again.
// - A request can read Mongo just before a sign-out or one of our user writes
//   and copy its now-stale session in just after. Both leave a short-lived
//   tombstone (revoked:<token>, forgotten:<userId>) that refuses such a late
//   copy; the checks and writes run in Redis as one script each.
// - No entry outlives SESSION_CACHE_TTL_SECONDS from when it was first
//   written: better-auth's daily session refresh rewrites an entry with
//   KEEPTTL rather than a fresh lifetime. That bounds what a forget that never
//   reached Redis (it was down) can leave behind.
// The stored shapes are better-auth 1.7's own; the guard tests in
// __tests__/lib/authSessionStore.test.js read its dist to catch a change.
import 'server-only'
import { withRedis } from '@src/lib/redisClient'
import { createLogger } from '@src/lib/logger'

const log = createLogger('Auth.SessionStore')

/** The longest any cached session, session list or verification value lives in Redis. */
export const SESSION_CACHE_TTL_SECONDS = 15 * 60

// A Redis miss is remembered for this long: a session read from Mongo after
// it is copied in only within the window
const MISS_WINDOW_MS = 60_000
// Longer than the window, so a tombstone outlives every lookup it guards against
const TOMBSTONE_TTL_SECONDS = (2 * MISS_WINDOW_MS) / 1000

const cappedTtl = (ttl?: number) =>
  Math.max(1, Math.min(ttl && ttl > 0 ? Math.floor(ttl) : SESSION_CACHE_TTL_SECONDS, SESSION_CACHE_TTL_SECONDS))

const activeSessionsKey = (userId: string) => `active-sessions-${userId}`
const revokedKey = (token: string) => `revoked:${token}`
const forgottenKey = (userId: string) => `forgotten:${userId}`

/** better-auth's session entries are keyed by the bare token; its other keys carry a prefix. */
const isSessionTokenKey = (key: string) => !key.includes(':') && !key.startsWith('active-sessions-')

// Writes a session entry unless its token was revoked in the last two minutes.
// An entry already there keeps its expiry: the cap counts from the first write.
const SET_SESSION = `
if redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
if redis.call('EXISTS', KEYS[1]) == 1 then
  redis.call('SET', KEYS[1], ARGV[1], 'KEEPTTL')
else
  redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
end
return 1`

// Copies a session read from Mongo in, with the token in the user's list,
// unless the token was revoked or the user forgotten since the lookup missed
const REMEMBER_SESSION = `
if redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
local forgotten = redis.call('GET', KEYS[3])
if forgotten and tonumber(forgotten) >= tonumber(ARGV[3]) then return 0 end
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
local refs = {}
local raw = redis.call('GET', KEYS[4])
if raw then
  local ok, list = pcall(cjson.decode, raw)
  if ok and type(list) == 'table' then
    for _, ref in ipairs(list) do
      local expiresAt = type(ref) == 'table' and tonumber(ref.expiresAt)
      if expiresAt and type(ref.token) == 'string' and ref.token ~= ARGV[4] and expiresAt > tonumber(ARGV[7]) then
        table.insert(refs, { token = ref.token, expiresAt = expiresAt })
      end
    end
  end
end
table.insert(refs, { token = ARGV[4], expiresAt = tonumber(ARGV[5]) })
table.sort(refs, function(a, b) return a.expiresAt < b.expiresAt end)
redis.call('SET', KEYS[4], cjson.encode(refs), 'EX', ARGV[6])
return 1`

// Drops a user's cached sessions and their list, leaving the forgotten tombstone
const FORGET_USER = `
redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[2])
local raw = redis.call('GET', KEYS[1])
if raw then
  local ok, list = pcall(cjson.decode, raw)
  if ok and type(list) == 'table' then
    for _, ref in ipairs(list) do
      if type(ref) == 'table' and type(ref.token) == 'string' then redis.call('DEL', ref.token) end
    end
  end
  redis.call('DEL', KEYS[1])
end
return 1`

/** The scripts, by name: the unit tests stand in for Redis's Lua with the same rules. */
export const SESSION_STORE_SCRIPTS = { SET_SESSION, REMEMBER_SESSION, FORGET_USER }

// Keys whose Redis read missed, with when: a session among them came from
// Mongo, and rememberSession copies it in. Bounded, so a flood of unknown
// tokens can't grow it.
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

/** When the key's read missed, if within the window (and forgets it). */
function takeMiss(key: string) {
  const at = recentMisses.get(key)
  recentMisses.delete(key)
  return at !== undefined && Date.now() - at < MISS_WINDOW_MS ? at : null
}

// Sign-outs and user writes whose drop Redis didn't take (it was unavailable),
// until their entries could have expired anyway. This process treats those
// entries as missing, so better-auth reads Mongo, and drops them once Redis
// answers again. (Another process sharing the Redis would still see them, for
// at most SESSION_CACHE_TTL_SECONDS.)
const PENDING_MAX = 10_000
const unappliedRevokes = new Map<string, number>() // token -> until (ms)
const unappliedForgets = new Map<string, number>() // userId -> until (ms)

function remember(pending: Map<string, number>, key: string) {
  if (pending.size >= PENDING_MAX) {
    const now = Date.now()
    for (const [entry, until] of pending) if (until <= now) pending.delete(entry)
  }
  pending.set(key, Date.now() + SESSION_CACHE_TTL_SECONDS * 1000)
}

function isPending(pending: Map<string, number>, key: string) {
  const until = pending.get(key)
  if (until === undefined) return false
  if (until > Date.now()) return true
  pending.delete(key)
  return false
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
    if (value === null) {
      noteMiss(key)
      return null
    }
    if (isSessionTokenKey(key) && (unappliedRevokes.size > 0 || unappliedForgets.size > 0)) {
      if (isPending(unappliedRevokes, key)) {
        // Signed out while Redis was away: drop it now that Redis answers
        void authSecondaryStorage.delete(key)
        return null
      }
      const userId = parseEntryUserId(value)
      if (userId && isPending(unappliedForgets, userId)) {
        void forgetUserSessions(userId)
        noteMiss(key)
        return null
      }
    }
    return value
  },
  getAndDelete: (key: string) => withRedis((redis) => redis.getDel(key)),
  async set(key: string, value: string, ttl?: number) {
    if (isSessionTokenKey(key)) {
      await withRedis((redis) =>
        redis.eval(SET_SESSION, { keys: [key, revokedKey(key)], arguments: [value, String(cappedTtl(ttl))] })
      )
      return
    }
    await withRedis((redis) => redis.setEx(key, cappedTtl(ttl), value))
  },
  async delete(key: string) {
    if (isSessionTokenKey(key)) {
      // A sign-out or revoke: the tombstone refuses a racing request's late copy
      const dropped = await withRedis(
        async (redis) => {
          await redis.multi().del(key).setEx(revokedKey(key), TOMBSTONE_TTL_SECONDS, '1').exec()
          return true
        },
        { fallback: false }
      )
      if (dropped) unappliedRevokes.delete(key)
      else remember(unappliedRevokes, key)
      return
    }
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
 * A lookup Redis answered, a token revoked since, or a user forgotten since
 * the lookup missed is left alone. Never throws.
 */
export async function rememberSession(lookup: SessionLookup | null | undefined) {
  const session = lookup?.session
  const token = session?.token
  const userId = session?.userId
  if (!session || !token || !userId) return
  const missedAt = takeMiss(token)
  if (missedAt === null) return
  const expiresAt = new Date(session.expiresAt ?? 0).getTime()
  const now = Date.now()
  const ttl = Math.min(SESSION_CACHE_TTL_SECONDS, Math.floor((expiresAt - now) / 1000))
  if (!(ttl >= 1)) return
  const id = String(userId)
  await withRedis((redis) =>
    redis.eval(REMEMBER_SESSION, {
      keys: [token, revokedKey(token), forgottenKey(id), activeSessionsKey(id)],
      arguments: [
        JSON.stringify({ session, user: lookup?.user }),
        String(ttl),
        String(missedAt),
        token,
        String(expiresAt),
        String(SESSION_CACHE_TTL_SECONDS),
        String(now),
      ],
    })
  )
}

/**
 * Drops a user's cached sessions after our own write to the user or their
 * sessions, so their next request reads Mongo (and rememberSession caches the
 * fresh copy). Never throws; when Redis is unavailable the entries are left to
 * expire within SESSION_CACHE_TTL_SECONDS, and that is logged.
 */
export async function forgetUserSessions(userIds: unknown | unknown[]) {
  const ids = [...new Set((Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean).map(String))]
  if (ids.length === 0) return
  const forgotten = await withRedis(
    async (redis) => {
      const now = String(Date.now())
      for (const id of ids) {
        await redis.eval(FORGET_USER, {
          keys: [activeSessionsKey(id), forgottenKey(id)],
          arguments: [now, String(TOMBSTONE_TTL_SECONDS)],
        })
      }
      return true
    },
    { budgetMs: 1000, fallback: false }
  )
  if (forgotten) {
    for (const id of ids) unappliedForgets.delete(id)
    return
  }
  for (const id of ids) remember(unappliedForgets, id)
  log.warn(
    { users: ids.length },
    `Could not drop cached sessions; this process ignores them, and they expire within ${SESSION_CACHE_TTL_SECONDS / 60} min`
  )
}

/** The user a cached session entry belongs to, or null. */
function parseEntryUserId(value: unknown) {
  if (typeof value !== 'string') return null
  try {
    const userId = JSON.parse(value)?.session?.userId
    return userId ? String(userId) : null
  } catch {
    return null
  }
}
