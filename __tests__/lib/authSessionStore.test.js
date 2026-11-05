/**
 * @jest-environment node
 *
 * src/lib/authSessionStore.ts: better-auth's secondaryStorage on Redis, with
 * Mongo kept as the record. Sessions read from Mongo are copied in; our own
 * user writes drop the user's cached sessions; a request that read Mongo just
 * before a sign-out or a user write can't copy its stale session in after;
 * no entry outlives the cap from its first write; with Redis down every read
 * misses (better-auth then reads Mongo) and rate limits keep counting in
 * memory. The guards read better-auth's dist and fail on an upgrade that
 * changes what this leans on. The Lua scripts themselves run against a real
 * Redis outside jest; here the in-memory Redis applies the same rules.
 */
const fs = require('fs')
const path = require('path')

const mockStore = new Map()
const mockTtls = new Map()
let mockRedisUp = true

function mockSetWithTtl(key, value, ttl) {
  mockStore.set(key, value)
  mockTtls.set(key, Number(ttl))
}
function mockDelete(key) {
  mockStore.delete(key)
  mockTtls.delete(key)
}
const mockRefs = (raw) => {
  try {
    const list = JSON.parse(raw)
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

// An in-memory Redis standing in for the one withRedis hands out
const mockRedis = {
  get: async (key) => (mockStore.has(key) ? mockStore.get(key) : null),
  setEx: async (key, ttl, value) => mockSetWithTtl(key, value, ttl),
  del: async (keys) => [].concat(keys).forEach(mockDelete),
  getDel: async (key) => {
    const value = mockStore.get(key) ?? null
    mockDelete(key)
    return value
  },
  // The scripts' rules, as authSessionStore's Lua applies them
  eval: async (script, { keys, arguments: args }) => {
    const { SESSION_STORE_SCRIPTS: S } = require('@src/lib/authSessionStore')
    if (script === S.SET_SESSION) {
      const [key, revoked] = keys
      const [value, ttl] = args
      if (mockStore.has(revoked)) return 0
      if (mockStore.has(key)) mockStore.set(key, value) // KEEPTTL
      else mockSetWithTtl(key, value, ttl)
      return 1
    }
    if (script === S.REMEMBER_SESSION) {
      const [token, revoked, forgotten, listKey] = keys
      const [entry, ttl, missedAt, , expiresAt, listTtl, now] = args
      if (mockStore.has(revoked)) return 0
      if (mockStore.has(forgotten) && Number(mockStore.get(forgotten)) >= Number(missedAt)) return 0
      if (mockStore.has(token)) return 0
      mockSetWithTtl(token, entry, ttl)
      const refs = mockRefs(mockStore.get(listKey))
        .filter((ref) => ref.token !== token && ref.expiresAt > Number(now))
        .concat([{ token, expiresAt: Number(expiresAt) }])
        .sort((a, b) => a.expiresAt - b.expiresAt)
      mockSetWithTtl(listKey, JSON.stringify(refs), listTtl)
      return 1
    }
    if (script === S.FORGET_USER) {
      const [listKey, forgotten] = keys
      const [now, ttl] = args
      mockSetWithTtl(forgotten, now, ttl)
      for (const ref of mockRefs(mockStore.get(listKey))) mockDelete(ref.token)
      mockDelete(listKey)
      return 1
    }
    throw new Error('unknown script')
  },
  multi() {
    const steps = []
    const chain = {
      incr(key) {
        steps.push(async () => {
          const next = Number(mockStore.get(key) ?? 0) + 1
          mockStore.set(key, String(next))
          return next
        })
        return chain
      },
      expire(key, ttl, mode) {
        steps.push(async () => {
          if (mode === 'NX' && mockTtls.has(key)) return 0
          mockTtls.set(key, ttl)
          return 1
        })
        return chain
      },
      del(key) {
        steps.push(async () => mockDelete(key))
        return chain
      },
      setEx(key, ttl, value) {
        steps.push(async () => mockSetWithTtl(key, value, ttl))
        return chain
      },
      async exec() {
        const replies = []
        for (const step of steps) replies.push(await step())
        return replies
      },
    }
    return chain
  },
}
jest.mock('@src/lib/redisClient', () => ({
  withRedis: async (run, { fallback = null } = {}) => (mockRedisUp ? run(mockRedis) : fallback),
  isRedisConfigured: () => true,
}))
const mockWarn = jest.fn()
jest.mock('@src/lib/logger', () => ({ createLogger: () => ({ warn: (...args) => mockWarn(...args), info: jest.fn() }) }))

const {
  authSecondaryStorage,
  rememberSession,
  forgetUserSessions,
  SESSION_CACHE_TTL_SECONDS,
} = require('@src/lib/authSessionStore')

const root = path.join(__dirname, '../..')
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), 'utf8')

const inDays = (days) => new Date(Date.now() + days * 86_400_000)
const lookup = (token, userId = 'u1', user = {}) => ({
  session: { id: `s-${token}`, token, userId, expiresAt: inDays(30), createdAt: new Date(), updatedAt: new Date() },
  user: { id: userId, email: 'viewer@example.test', role: 'user', approved: true, ...user },
})
/** better-auth's read of a session Redis lacks, then the Mongo read our lookup returns */
const missThenRead = async (token, userId, user) => {
  await authSecondaryStorage.get(token)
  return lookup(token, userId, user)
}

beforeEach(() => {
  mockStore.clear()
  mockTtls.clear()
  mockRedisUp = true
  mockWarn.mockClear()
})

describe('the session cache', () => {
  it('copies a session better-auth read from Mongo into Redis, in better-auth’s shape, capped', async () => {
    await rememberSession(await missThenRead('tok1'))

    const cached = JSON.parse(mockStore.get('tok1'))
    expect(cached.session.token).toBe('tok1')
    expect(cached.user).toMatchObject({ id: 'u1', role: 'user', approved: true })
    expect(mockTtls.get('tok1')).toBe(SESSION_CACHE_TTL_SECONDS)
    expect(JSON.parse(mockStore.get('active-sessions-u1'))).toEqual([
      { token: 'tok1', expiresAt: new Date(cached.session.expiresAt).getTime() },
    ])
  })

  it('leaves a session Redis already answered alone', async () => {
    mockStore.set('tok2', JSON.stringify(lookup('tok2')))
    await authSecondaryStorage.get('tok2') // a hit
    mockStore.clear()
    await rememberSession(lookup('tok2'))
    expect(mockStore.size).toBe(0)
  })

  it('caps a new entry, whatever TTL better-auth asks for', async () => {
    await authSecondaryStorage.set('tok3', '{}', 60 * 60 * 24 * 30)
    expect(mockTtls.get('tok3')).toBe(SESSION_CACHE_TTL_SECONDS)
    await authSecondaryStorage.set('verification:abc', '{}', 120)
    expect(mockTtls.get('verification:abc')).toBe(120)
  })

  it('a refresh rewrites an entry but keeps its expiry: the cap counts from the first write', async () => {
    await authSecondaryStorage.set('tok4', '{"v":1}', 60 * 60 * 24 * 30)
    mockTtls.set('tok4', 120) // 13 minutes later
    await authSecondaryStorage.set('tok4', '{"v":2}', 60 * 60 * 24 * 30) // the daily refresh
    expect(mockStore.get('tok4')).toBe('{"v":2}')
    expect(mockTtls.get('tok4')).toBe(120)
  })

  it('drops a user’s cached sessions and their list after our own write to the user', async () => {
    for (const token of ['a', 'b']) await rememberSession(await missThenRead(token, 'u9'))
    mockStore.set('someone-else', 'x')
    await forgetUserSessions('u9')
    expect(mockStore.has('a') || mockStore.has('b') || mockStore.has('active-sessions-u9')).toBe(false)
    expect(mockStore.get('someone-else')).toBe('x')
  })
})

describe('a request racing a sign-out or a user write', () => {
  it('can’t copy in a session it read from Mongo before the user was written', async () => {
    const stale = await missThenRead('tok5', 'u5', { approved: true }) // read before the write
    await forgetUserSessions('u5') // userQueries: approved: false, then the forget
    await rememberSession(stale)
    expect(mockStore.has('tok5')).toBe(false)
  })

  it('can’t copy in a session that was signed out while it was being read', async () => {
    const stale = await missThenRead('tok6', 'u6')
    await authSecondaryStorage.delete('tok6') // better-auth's sign-out
    await rememberSession(stale)
    expect(mockStore.has('tok6')).toBe(false)
    // ... nor can better-auth write the signed-out token back
    await authSecondaryStorage.set('tok6', '{}', 900)
    expect(mockStore.has('tok6')).toBe(false)
  })

  it('a lookup that missed after the write caches normally', async () => {
    await forgetUserSessions('u7')
    await new Promise((resolve) => setTimeout(resolve, 5))
    await rememberSession(await missThenRead('tok7', 'u7'))
    expect(mockStore.has('tok7')).toBe(true)
  })
})

describe('with Redis down', () => {
  it('every read misses, writes give up quietly, a skipped forget is logged, and rate limits still count', async () => {
    mockRedisUp = false
    await expect(authSecondaryStorage.get('tok')).resolves.toBeNull()
    await expect(authSecondaryStorage.set('tok', '{}', 60)).resolves.toBeUndefined()
    await expect(authSecondaryStorage.delete('tok')).resolves.toBeUndefined()
    await expect(forgetUserSessions(['u1', 'u2'])).resolves.toBeUndefined()
    expect(mockWarn).toHaveBeenCalledWith({ users: 2 }, expect.stringContaining('expire within 15 min'))
    const counts = []
    for (let i = 0; i < 3; i++) counts.push(await authSecondaryStorage.increment('rl:/device:1.2.3.4', 900))
    expect(counts).toEqual([1, 2, 3])
  })

  it('a sign-out Redis missed still ends the session here, and is applied once Redis answers', async () => {
    await rememberSession(await missThenRead('tok8', 'u8'))
    mockRedisUp = false
    await authSecondaryStorage.delete('tok8') // the sign-out, while Redis was away
    mockRedisUp = true
    await expect(authSecondaryStorage.get('tok8')).resolves.toBeNull() // better-auth reads Mongo: gone
    await new Promise((resolve) => setImmediate(resolve))
    expect(mockStore.has('tok8')).toBe(false)
    expect(mockStore.has('revoked:tok8')).toBe(true)
  })

  it('a user write whose forget Redis missed still shows here, and the stale entry goes once Redis answers', async () => {
    await rememberSession(await missThenRead('tok9', 'u10', { approved: true }))
    mockRedisUp = false
    await forgetUserSessions('u10') // after approved: false, while Redis was away
    mockRedisUp = true
    await expect(authSecondaryStorage.get('tok9')).resolves.toBeNull() // read Mongo, with the write
    await new Promise((resolve) => setImmediate(resolve))
    expect(mockStore.has('tok9')).toBe(false)
  })

  it('counts rate limits in Redis when it is up, setting the window only when the counter is created', async () => {
    expect(await authSecondaryStorage.increment('rl:/sign-in:1.2.3.4', 60)).toBe(1)
    expect(await authSecondaryStorage.increment('rl:/sign-in:1.2.3.4', 999)).toBe(2)
    expect(mockTtls.get('rl:/sign-in:1.2.3.4')).toBe(60)
  })
})

describe('our own writes drop cached sessions', () => {
  it('every userQueries write helper does, after its write', () => {
    const source = read('src', 'lib', 'userQueries.js')
    for (const helper of ['updateById', 'updateByIdCustom', 'deleteById']) {
      expect(source).toMatch(new RegExp(`${helper}: async[\\s\\S]{0,400}await forgetUserSessions\\(userId\\)`))
    }
    expect(source).toMatch(/updateMany: async[\s\S]{0,400}await forgetUserSessions\(matched\.map/)
  })

  it('nothing else writes users or sessions straight to Mongo', () => {
    const allowed = new Set(['src/lib/userQueries.js', 'src/utils/accountDeletion.js'])
    const offenders = []
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (/\.(js|jsx|ts|tsx|mjs)$/.test(entry.name)) {
          const rel = path.relative(root, full).replace(/\\/g, '/')
          if (allowed.has(rel)) continue
          const source = fs.readFileSync(full, 'utf8')
          const raw =
            /collection\(\s*['"](user|session)['"]\s*\)\s*\.\s*(insert|update|replace|delete|findOneAndUpdate|findOneAndReplace|findOneAndDelete|bulkWrite)/.test(source) ||
            /userQueries\.collection\(\)\s*\.\s*(insert|update|replace|delete|findOneAnd|bulkWrite)/.test(source)
          if (raw) offenders.push(rel)
        }
      }
    }
    walk(path.join(root, 'src'))
    expect(offenders).toEqual([])
  })

  it('bulk role writes and the account deletion go through it, the deletion only after its commit', () => {
    expect(read('src', 'lib', 'adminRoleReconcile.ts')).not.toMatch(/\.collection\(\)/)
    expect(read('src', 'lib', 'roles', 'limitedAccessMigration.ts')).not.toMatch(/users\.updateMany/)
    expect(read('src', 'utils', 'accountDeletion.js')).toMatch(
      /await session\.withTransaction\([\s\S]*?\n {4}\}\)\n[\s\S]{0,400}if \(deletedUserId\) await forgetUserSessions\(deletedUserId\)/
    )
  })

  it('auth.ts keeps Mongo the record, and uses Redis only when it is configured', () => {
    const source = read('src', 'lib', 'auth.ts')
    expect(source).toMatch(/\.\.\.\(isRedisConfigured\(\) \? \{ secondaryStorage: authSecondaryStorage \} : \{\}\)/)
    expect(source).toMatch(/session: \{[\s\S]{0,200}storeSessionInDatabase: true/)
    expect(source).toMatch(/verification: \{\s+storeInDatabase: true/)
    expect(read('src', 'lib', 'cachedAuth.js')).toMatch(/void rememberSession\(session\)/)
  })
})

describe('better-auth 1.7.15 internals this leans on', () => {
  const adapter = read('node_modules', 'better-auth', 'dist', 'db', 'internal-adapter.mjs')

  it('a session Redis misses is read from Mongo when sessions are stored there too', () => {
    expect(adapter).toMatch(
      /if \(!sessionStringified && \(!options\.session\?\.storeSessionInDatabase \|\| ctx\.options\.session\?\.preserveSessionInDatabase\)\) return null;/
    )
    expect(adapter).toMatch(/model: "session",\s+where: \[\{\s+value: token,\s+field: "token"\s+\}\],\s+join: \{ user: true \}/)
  })

  it('caches a session as { session, user } under its bare token, listed in active-sessions-<userId>', () => {
    expect(adapter).toMatch(/await secondaryStorage\.set\(token, JSON\.stringify\(\{\s+session: parsed\.session,\s+user\s+\}\)/)
    expect(adapter).toMatch(/`active-sessions-\$\{user\.id\}`/)
    expect(adapter).toMatch(/for \(const \{ token \} of sessionReferences\) await secondaryStorage\.delete\(token\)/)
    // A sign-out deletes the bare token key (the revoked tombstone is keyed on it)
    expect(adapter).toMatch(/await secondaryStorage\.delete\(token\);/)
  })

  it('never writes a Mongo-read session back itself: updateSession skips a token Redis lacks', () => {
    expect(adapter).toMatch(/const currentSession = await secondaryStorage\.get\(sessionToken\);\s+if \(!currentSession\) return null;/)
  })

  it('reads a verification value from Mongo when Redis lacks it, only with storeInDatabase', () => {
    expect(adapter).toMatch(/if \(!options\.verification\?\.storeInDatabase\) return null;/)
    expect(adapter).toMatch(/`verification:\$\{storedIdentifier\}`/)
  })

  it('counts rate limits with increment(key, window) when secondaryStorage is set', () => {
    const limiter = read('node_modules', 'better-auth', 'dist', 'api', 'rate-limiter', 'index.mjs')
    expect(limiter).toMatch(/if \(await increment\(key, ttlFor\(rule\.window\)\) <= rule\.max\)/)
    expect(read('node_modules', 'better-auth', 'dist', 'context', 'create-context.mjs')).toMatch(
      /storage: options\.rateLimit\?\.storage \|\| \(options\.secondaryStorage \? "secondary-storage" : "memory"\)/
    )
  })
})
