/**
 * @jest-environment node
 *
 * The "View as" bar's switch: writes on or off for the view-as session.
 * The setting lives on the session itself (viewAsWrites, a better-auth
 * session field), so the guard reads it from the lookup it already makes and
 * it ends with the session. Only POST /api/authenticated/view-as/writes sets
 * it: for a view-as session, after reading the admin it names again from the
 * database, and every change is logged with both users' ids.
 *
 * The guards at the end read better-auth's dist (ESM-only, which this Jest
 * setup doesn't load) to fail an upgrade that changes how the write reaches
 * Mongo and Redis, or lets a client set the field.
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('node:child_process')

const mockGetSession = jest.fn()
jest.mock('@src/lib/cachedAuth', () => ({ getSession: (...args) => mockGetSession(...args) }))
const mockFindUser = jest.fn()
jest.mock('@src/lib/userQueries', () => ({ userQueries: { findById: (...args) => mockFindUser(...args) } }))
const mockUpdateSession = jest.fn()
jest.mock('@src/lib/auth', () => ({
  auth: { $context: Promise.resolve({ internalAdapter: { updateSession: (...args) => mockUpdateSession(...args) } }) },
}))
const mockForget = jest.fn(async () => {})
jest.mock('@src/lib/authSessionStore', () => ({ forgetUserSessions: (...args) => mockForget(...args) }))
const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
jest.mock('@src/lib/logger', () => ({ createLogger: () => mockLog }))

const { POST } = require('@src/app/api/authenticated/view-as/writes/route')
const { setViewAsWrites } = require('@src/lib/viewAsWrites')
const { SESSION_ADDITIONAL_FIELDS } = require('@src/lib/authUserFields')

const ROOT = path.join(__dirname, '..', '..')
const read = (...segments) => fs.readFileSync(path.join(ROOT, ...segments), 'utf8')

const VIEW_AS = {
  session: { token: 'view-tok', userId: 'u1', impersonatedBy: 'a1' },
  user: { id: 'u1', email: 'user@example.com', name: 'User One' },
}

const post = (body, contentType = 'application/json') =>
  POST(
    new Request('https://app.example/api/authenticated/view-as/writes', {
      method: 'POST',
      headers: contentType ? { 'content-type': contentType } : {},
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  )

beforeEach(() => {
  jest.clearAllMocks()
  mockGetSession.mockResolvedValue(VIEW_AS)
  mockFindUser.mockResolvedValue({ _id: 'a1', role: 'admin' })
  mockUpdateSession.mockResolvedValue({ ...VIEW_AS.session, viewAsWrites: true })
})

describe('POST /api/authenticated/view-as/writes', () => {
  it('turns writes on for the view-as session, on the session itself, and logs it with both ids', async () => {
    const response = await post({ enabled: true })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ viewAsWrites: true })
    expect(mockUpdateSession).toHaveBeenCalledWith('view-tok', { viewAsWrites: true })
    expect(mockForget).toHaveBeenCalledWith('u1')
    expect(mockLog.info).toHaveBeenCalledWith({ adminId: 'a1', targetUserId: 'u1', writes: true }, 'View as: writes on')
  })

  it('turns them off the same way', async () => {
    const response = await post({ enabled: false })
    expect(await response.json()).toEqual({ viewAsWrites: false })
    expect(mockUpdateSession).toHaveBeenCalledWith('view-tok', { viewAsWrites: false })
    expect(mockLog.info).toHaveBeenCalledWith({ adminId: 'a1', targetUserId: 'u1', writes: false }, 'View as: writes off')
  })

  it('reads the admin named in impersonatedBy again from the database', async () => {
    await post({ enabled: true })
    expect(mockFindUser).toHaveBeenCalledWith('a1', { role: 1 })
  })

  it('refuses when that admin is no longer an admin (or is gone), and logs why', async () => {
    for (const admin of [{ _id: 'a1', role: 'user' }, null]) {
      jest.clearAllMocks()
      mockFindUser.mockResolvedValue(admin)
      const response = await post({ enabled: true })
      expect(response.status).toBe(403)
      expect((await response.json()).error).toBe('ADMIN_REQUIRED')
      expect(mockUpdateSession).not.toHaveBeenCalled()
      expect(mockLog.warn).toHaveBeenCalledWith(
        { adminId: 'a1', userId: 'u1', reason: 'not an admin any more' },
        'View as: writes switch refused'
      )
    }
  })

  it('is only for a view-as session: an admin’s or a user’s own session gets 403, with nothing read', async () => {
    for (const session of [{ session: { token: 't' }, user: { id: 'a1', role: 'admin' } }, { session: { token: 't' }, user: { id: 'u1' } }, null]) {
      mockGetSession.mockResolvedValue(session)
      const response = await post({ enabled: true })
      expect(response.status).toBe(403)
      expect((await response.json()).error).toBe('NOT_VIEWING_AS')
    }
    expect(mockFindUser).not.toHaveBeenCalled()
    expect(mockUpdateSession).not.toHaveBeenCalled()
  })

  it('takes only a JSON { enabled: boolean }', async () => {
    expect((await post('{"enabled":true}', 'text/plain')).status).toBe(415)
    expect((await post('{"enabled":true}', null)).status).toBe(415)
    for (const body of [{ enabled: 'true' }, { enabled: 1 }, {}, 'not json']) {
      expect([body, (await post(body)).status]).toEqual([body, 400])
    }
    expect(mockUpdateSession).not.toHaveBeenCalled()
  })

  it('answers 409 when the session has ended in the meantime', async () => {
    mockUpdateSession.mockResolvedValue(null)
    const response = await post({ enabled: true })
    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe('SESSION_ENDED')
    expect(mockLog.info).not.toHaveBeenCalled()
  })

  it('answers 500 on a failure, and changes nothing it can help', async () => {
    mockUpdateSession.mockRejectedValue(new Error('Mongo is away'))
    const response = await post({ enabled: true })
    expect(response.status).toBe(500)
    expect(mockLog.info).not.toHaveBeenCalled()
    expect(mockLog.error).toHaveBeenCalled()
  })

  it('never logs an email or a name', async () => {
    await post({ enabled: true })
    mockFindUser.mockResolvedValue({ role: 'user' })
    await post({ enabled: true })
    const logged = JSON.stringify([...mockLog.info.mock.calls, ...mockLog.warn.mock.calls])
    expect(logged).not.toMatch(/@example\.com|User One/)
  })
})

describe('setViewAsWrites', () => {
  it('updates the session through better-auth, then drops the user’s cached sessions', async () => {
    const order = []
    mockUpdateSession.mockImplementation(async () => {
      order.push('update')
      return { token: 'view-tok' }
    })
    mockForget.mockImplementation(async () => {
      order.push('forget')
    })
    expect(await setViewAsWrites('view-tok', 'u1', true)).toBe(true)
    // After the update: the tombstone refuses a copy of the old setting read before it
    expect(order).toEqual(['update', 'forget'])
  })

  it('is false when there was no such session', async () => {
    mockUpdateSession.mockResolvedValue(null)
    expect(await setViewAsWrites('gone', 'u1', false)).toBe(false)
  })

  it('drops the cached sessions even when the update fails (Redis is rewritten before Mongo)', async () => {
    mockUpdateSession.mockRejectedValue(new Error('Mongo is away'))
    await expect(setViewAsWrites('view-tok', 'u1', false)).rejects.toThrow('Mongo is away')
    expect(mockForget).toHaveBeenCalledWith('u1')
  })
})

describe('guards: better-auth 1.7.15 keeps the setting where the guard reads it', () => {
  it('auth.ts declares the field on sessions, server-written only, with no default', () => {
    expect(read('src', 'lib', 'auth.ts')).toMatch(
      /session: \{\n\s+expiresIn:[\s\S]{0,300}additionalFields: SESSION_ADDITIONAL_FIELDS,\n\s+\},/
    )
    expect(SESSION_ADDITIONAL_FIELDS).toEqual({ viewAsWrites: { type: 'boolean', required: false, input: false } })
  })

  it('a session lookup returns only the schema’s fields, so the field must be declared to be read', () => {
    const factory = read('node_modules', '@better-auth', 'core', 'dist', 'db', 'adapter', 'factory.mjs')
    expect(factory).toMatch(/const tableSchema = schema\[modelKey\]\.fields;[\s\S]{0,400}for \(const key in tableSchema\) \{/)
  })

  it('the update writes Mongo and rewrites the Redis entry it finds, keeping the expiry', () => {
    const adapter = read('node_modules', 'better-auth', 'dist', 'db', 'internal-adapter.mjs')
    const update = adapter.slice(adapter.indexOf('updateSession: async (sessionToken, session) => {'))
    expect(update).toMatch(/const currentSession = await secondaryStorage\.get\(sessionToken\);\s+if \(!currentSession\) return null;/)
    expect(update).toMatch(/const mergedSession = \{\s+\.\.\.parsedSession\.session,\s+\.\.\.data,\s+expiresAt: new Date\(data\.expiresAt \?\? parsedSession\.session\.expiresAt\),/)
    expect(update).toMatch(/executeMainFn: options\.session\?\.storeSessionInDatabase\s+\} : void 0\);/)
    // ...the Redis rewrite first, then Mongo: why a failed update still drops the cache
    const hooks = read('node_modules', 'better-auth', 'dist', 'db', 'with-hooks.mjs')
    expect(hooks).toMatch(
      /const customUpdated = customUpdateFn \? await customUpdateFn\.fn\(actualData\) : null;\s+const updated = !customUpdateFn \|\| customUpdateFn\.executeMainFn \? await \(await getCurrentAdapter\(adapter\)\)\.update\(/
    )
    // A new session gets the configured defaults (none for this field) after what impersonate-user passes
    const create = adapter.slice(adapter.indexOf('createSession: async'), adapter.indexOf('findSession: async'))
    expect(create).toMatch(/\.\.\.rest,[\s\S]{0,600}\.\.\.defaultAdditionalFields,/)
  })

  it('a client can’t set it: update-session refuses it, as the user fields are refused', () => {
    const SCRIPT = `
import { parseSessionInput } from 'better-auth/db'
const [fields, body] = JSON.parse(process.argv[1])
try {
  console.log(JSON.stringify({ ok: parseSessionInput({ session: { additionalFields: fields } }, body, 'update') }))
} catch (error) {
  console.log(JSON.stringify({ error: error.message }))
}
`
    const parse = (body) =>
      JSON.parse(
        execFileSync(process.execPath, ['--input-type=module', '-e', SCRIPT, JSON.stringify([SESSION_ADDITIONAL_FIELDS, body])], {
          cwd: ROOT,
          encoding: 'utf8',
        })
          .trim()
          .split('\n')
          .pop()
      )
    expect(parse({ viewAsWrites: true }).error).toMatch(/is not allowed to be set/)
    // false sets nothing either
    expect(parse({ viewAsWrites: false })).toEqual({ ok: {} })
    // ...and the endpoint runs every body through it
    const endpoint = read('node_modules', 'better-auth', 'dist', 'api', 'routes', 'update-session.mjs')
    expect(endpoint).toMatch(/const additionalFields = parseSessionInput\(ctx\.context\.options, body, "update"\);/)
  })
})
