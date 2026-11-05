/**
 * @jest-environment node
 *
 * src/lib/authSessionStore.ts: better-auth's secondaryStorage on Redis, with
 * Mongo kept as the record. Sessions read from Mongo are copied in, our own
 * user writes drop the user's cached sessions, nothing lives longer than the
 * cap, and with Redis down every read misses (better-auth then reads Mongo)
 * and sign-in rate limits keep counting in memory. The guards read
 * better-auth's dist: they fail on an upgrade that changes what this leans on.
 */
const fs = require('fs')
const path = require('path')

// An in-memory Redis standing in for the one withRedis hands out
const mockStore = new Map()
const mockTtls = new Map()
let mockRedisUp = true
const mockRedis = {
  get: async (key) => (mockStore.has(key) ? mockStore.get(key) : null),
  setEx: async (key, ttl, value) => {
    mockStore.set(key, value)
    mockTtls.set(key, ttl)
    return 'OK'
  },
  del: async (keys) => {
    for (const key of [].concat(keys)) {
      mockStore.delete(key)
      mockTtls.delete(key)
    }
  },
  getDel: async (key) => {
    const value = mockStore.get(key) ?? null
    mockStore.delete(key)
    return value
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
      setEx(key, ttl, value) {
        steps.push(() => mockRedis.setEx(key, ttl, value))
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

const {
  authSecondaryStorage,
  rememberSession,
  forgetUserSessions,
  SESSION_CACHE_TTL_SECONDS,
} = require('@src/lib/authSessionStore')

const root = path.join(__dirname, '../..')
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), 'utf8')

const inDays = (days) => new Date(Date.now() + days * 86_400_000)
const lookup = (token, userId = 'u1') => ({
  session: { id: `s-${token}`, token, userId, expiresAt: inDays(30), createdAt: new Date(), updatedAt: new Date() },
  user: { id: userId, email: 'viewer@example.test', role: 'user', approved: true },
})

beforeEach(() => {
  mockStore.clear()
  mockTtls.clear()
  mockRedisUp = true
})

describe('the session cache', () => {
  it('copies a session better-auth read from Mongo into Redis, in better-auth’s shape, capped', async () => {
    await expect(authSecondaryStorage.get('tok1')).resolves.toBeNull() // better-auth's read: a miss
    await rememberSession(lookup('tok1'))

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

  it('caps every stored entry, whatever TTL better-auth asks for', async () => {
    await authSecondaryStorage.set('tok3', '{}', 60 * 60 * 24 * 30)
    expect(mockTtls.get('tok3')).toBe(SESSION_CACHE_TTL_SECONDS)
    await authSecondaryStorage.set('verification:abc', '{}', 120)
    expect(mockTtls.get('verification:abc')).toBe(120)
  })

  it('drops a user’s cached sessions and their list after our own write to the user', async () => {
    for (const token of ['a', 'b']) {
      await authSecondaryStorage.get(token)
      await rememberSession(lookup(token, 'u9'))
    }
    mockStore.set('someone-else', 'x')
    await forgetUserSessions('u9')
    expect([...mockStore.keys()]).toEqual(['someone-else'])
  })

  it('with Redis down: every read misses, writes give up quietly, and rate limits still count', async () => {
    mockRedisUp = false
    await expect(authSecondaryStorage.get('tok')).resolves.toBeNull()
    await expect(authSecondaryStorage.set('tok', '{}', 60)).resolves.toBeUndefined()
    await expect(authSecondaryStorage.delete('tok')).resolves.toBeUndefined()
    await expect(forgetUserSessions('u1')).resolves.toBeUndefined()
    const counts = []
    for (let i = 0; i < 3; i++) counts.push(await authSecondaryStorage.increment('rl:/device:1.2.3.4', 900))
    expect(counts).toEqual([1, 2, 3])
  })

  it('counts rate limits in Redis, setting the window only when the counter is created', async () => {
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

  it('caches a session as { session, user } under its token, listed in active-sessions-<userId>', () => {
    expect(adapter).toMatch(/await secondaryStorage\.set\(token, JSON\.stringify\(\{\s+session: parsed\.session,\s+user\s+\}\)/)
    expect(adapter).toMatch(/`active-sessions-\$\{user\.id\}`/)
    expect(adapter).toMatch(/for \(const \{ token \} of sessionReferences\) await secondaryStorage\.delete\(token\)/)
  })

  it('never writes a Mongo-read session back itself: updateSession skips a token Redis lacks', () => {
    expect(adapter).toMatch(/const currentSession = await secondaryStorage\.get\(sessionToken\);\s+if \(!currentSession\) return null;/)
  })

  it('reads a verification value from Mongo when Redis lacks it, only with storeInDatabase', () => {
    expect(adapter).toMatch(/if \(!options\.verification\?\.storeInDatabase\) return null;/)
  })

  it('counts rate limits with increment(key, window) when secondaryStorage is set', () => {
    const limiter = read('node_modules', 'better-auth', 'dist', 'api', 'rate-limiter', 'index.mjs')
    expect(limiter).toMatch(/if \(await increment\(key, ttlFor\(rule\.window\)\) <= rule\.max\)/)
    expect(read('node_modules', 'better-auth', 'dist', 'context', 'create-context.mjs')).toMatch(
      /storage: options\.rateLimit\?\.storage \|\| \(options\.secondaryStorage \? "secondary-storage" : "memory"\)/
    )
  })
})
