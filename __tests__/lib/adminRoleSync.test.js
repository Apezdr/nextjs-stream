/**
 * @jest-environment node
 *
 * src/lib/adminRoleSync.ts and adminRoleReconcile.ts: ADMIN_USER_EMAILS
 * decides who is an admin, both ways, at account creation, at every social
 * sign-in and at each server start. The sign-in sync used to match
 * '/callback/social', a path better-auth never reports, so it never ran.
 */

const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const mockUpdateMany = jest.fn(async () => ({ modifiedCount: 0 }))
jest.mock('@src/lib/userQueries', () => ({
  userQueries: { collection: () => ({ updateMany: (...args) => mockUpdateMany(...args) }) },
}))
const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
jest.mock('@src/lib/logger', () => ({ createLogger: () => mockLog }))

const {
  adminEmailsFromEnv,
  adminRoleUpdate,
  isAdminEmail,
  refusesNewUser,
  roleForNewUser,
  SOCIAL_SIGN_IN_PATHS,
} = require('@src/lib/adminRoleSync')
const { reconcileAdminRoles, reconcileAdminRolesOnce } = require('@src/lib/adminRoleReconcile')

const admins = adminEmailsFromEnv(' owner@example.com, second@example.com ,, ')
const read = (...path) => readFileSync(join(__dirname, '..', '..', ...path), 'utf8')
const STARTED = Symbol.for('nextjs_stream.adminRoleReconcileStarted')

beforeEach(() => {
  mockUpdateMany.mockReset()
  mockUpdateMany.mockResolvedValue({ modifiedCount: 0 })
  Object.values(mockLog).forEach((fn) => fn.mockClear())
  delete globalThis[STARTED]
})

describe('adminEmailsFromEnv', () => {
  it('reads a comma-separated list, trimmed, empties dropped', () => {
    expect([...admins]).toEqual(['owner@example.com', 'second@example.com'])
    expect(adminEmailsFromEnv(undefined).size).toBe(0)
  })

  it('compares exactly, as config.js adminUserEmails and the admin pages do', () => {
    expect(isAdminEmail('owner@example.com', admins)).toBe(true)
    expect(isAdminEmail('Owner@example.com', admins)).toBe(false)
    expect(isAdminEmail(undefined, admins)).toBe(false)
  })
})

describe('adminRoleUpdate', () => {
  const verified = { emailVerified: true }

  it('promotes a listed, verified address and approves it', () => {
    expect(adminRoleUpdate({ ...verified, email: 'owner@example.com', role: 'user', approved: false }, admins)).toEqual({
      role: 'admin',
      approved: true,
    })
  })

  it("takes a migrated account's verification Date as verified", () => {
    expect(adminRoleUpdate({ emailVerified: new Date(), email: 'owner@example.com', role: 'user' }, admins)).toEqual({
      role: 'admin',
      approved: true,
    })
  })

  it('approves a listed admin that is not approved yet', () => {
    expect(adminRoleUpdate({ ...verified, email: 'owner@example.com', role: 'admin', approved: false }, admins)).toEqual({
      approved: true,
    })
  })

  it('leaves a listed address the provider never verified as it is, admin or not', () => {
    expect(adminRoleUpdate({ emailVerified: false, email: 'owner@example.com', role: 'user' }, admins)).toBeNull()
    expect(adminRoleUpdate({ emailVerified: null, email: 'owner@example.com', role: 'admin' }, admins)).toBeNull()
  })

  it('demotes an admin whose address left the list, and leaves their approval alone', () => {
    expect(adminRoleUpdate({ ...verified, email: 'former@example.com', role: 'admin', approved: true }, admins)).toEqual({
      role: 'user',
    })
  })

  it('demotes nobody when the list is empty (a missing setting, not "no admins")', () => {
    expect(adminRoleUpdate({ ...verified, email: 'owner@example.com', role: 'admin' }, new Set())).toBeNull()
  })

  it('changes nothing when the role already matches', () => {
    expect(adminRoleUpdate({ ...verified, email: 'owner@example.com', role: 'admin', approved: true }, admins)).toBeNull()
    expect(adminRoleUpdate({ ...verified, email: 'viewer@example.com', role: 'user' }, admins)).toBeNull()
  })
})

describe('a new account', () => {
  it('is an admin only for a listed address its provider verified', () => {
    expect(roleForNewUser({ email: 'owner@example.com', emailVerified: true }, admins)).toBe('admin')
    expect(roleForNewUser({ email: 'viewer@example.com', emailVerified: true }, admins)).toBe('user')
  })

  it('is refused for a listed address its provider did not verify, so it can never be linked into an admin', () => {
    expect(refusesNewUser({ email: 'owner@example.com', emailVerified: false }, admins)).toBe(true)
    expect(refusesNewUser({ email: 'owner@example.com', emailVerified: true }, admins)).toBe(false)
    // Anyone else signs up as before, verified or not
    expect(refusesNewUser({ email: 'viewer@example.com', emailVerified: false }, admins)).toBe(false)
  })
})

describe('reconcileAdminRoles (each server start)', () => {
  it('promotes listed, verified users and demotes unlisted admins', async () => {
    mockUpdateMany.mockResolvedValueOnce({ modifiedCount: 1 }).mockResolvedValueOnce({ modifiedCount: 2 })

    await expect(reconcileAdminRoles(admins)).resolves.toEqual({ promoted: 1, demoted: 2 })

    const [[promoteFilter, promoteUpdate], [demoteFilter, demoteUpdate]] = mockUpdateMany.mock.calls
    expect(promoteFilter).toEqual({
      email: { $in: ['owner@example.com', 'second@example.com'] },
      emailVerified: { $nin: [null, false] },
      $or: [{ role: { $ne: 'admin' } }, { approved: { $ne: true } }],
    })
    expect(promoteUpdate).toEqual({ $set: { role: 'admin', approved: true } })
    expect(demoteFilter).toEqual({ role: 'admin', email: { $nin: ['owner@example.com', 'second@example.com'] } })
    expect(demoteUpdate).toEqual({ $set: { role: 'user' } })
  })

  it('writes nothing when the list is empty', async () => {
    await expect(reconcileAdminRoles(new Set())).resolves.toEqual({ promoted: 0, demoted: 0 })
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it('warns about entries with capitals, which match no account, by count only', async () => {
    await reconcileAdminRoles(adminEmailsFromEnv('Owner@example.com,second@example.com'))

    expect(mockLog.warn).toHaveBeenCalledWith({ entries: 1 }, expect.stringContaining('capitals'))
    expect(JSON.stringify(mockLog.warn.mock.calls)).not.toContain('Owner@example.com')
  })

  it('retries with backoff until a run succeeds, once per process, and never throws', async () => {
    const run = jest
      .fn()
      .mockRejectedValueOnce(new Error('database down'))
      .mockRejectedValueOnce(new Error('database down'))
      .mockResolvedValueOnce({ promoted: 0, demoted: 0 })
    const delays = []
    const schedule = (retry, ms) => {
      delays.push(ms)
      retry()
    }
    const settle = () => new Promise((resolve) => setImmediate(resolve))

    expect(() => reconcileAdminRolesOnce(run, schedule)).not.toThrow()
    for (let i = 0; i < 5; i += 1) await settle()
    expect(run).toHaveBeenCalledTimes(3)
    expect(delays).toEqual([5_000, 10_000])

    // A second call in the same process starts nothing
    reconcileAdminRolesOnce(run, schedule)
    await settle()
    expect(run).toHaveBeenCalledTimes(3)
  })
})

describe('the sign-in wiring', () => {
  it("matches better-auth's own endpoint paths, as its hook context reports them", () => {
    // better-auth is ESM-only, which this Jest setup doesn't load, so its
    // installed source is read instead: an upgrade that renames a route fails here
    const dist = (file) => read('node_modules', 'better-auth', 'dist', 'api', file)

    expect(dist('routes/callback.mjs')).toContain('createAuthEndpoint("/callback/:id"')
    expect(dist('routes/sign-in.mjs')).toContain('createAuthEndpoint("/sign-in/social"')
    // A hook's ctx.path is the endpoint's route pattern, not the request path,
    // and ctx.context.session starts null on every call
    expect(dist('dispatch.mjs')).toMatch(/session: input\.context\.session \?\? null\s+\},\s+path: endpoint\.path,/)
    expect([...SOCIAL_SIGN_IN_PATHS].sort()).toEqual(['/callback/:id', '/sign-in/social'])
  })

  it("auth.ts syncs the session the sign-in made, writes the user, and keeps no session cache", () => {
    const source = read('src', 'lib', 'auth.ts')

    expect(source).toMatch(/if \(!SOCIAL_SIGN_IN_PATHS\.has\(ctx\.path\)\) return/)
    // ctx.context.session is null on these routes: reading it would stop the sync again
    expect(source).toMatch(/\(ctx\.context as any\)\?\.newSession\?\.user/)
    // Read again: the session's copy predates the sign-in's own emailVerified write
    expect(source).toMatch(/await userQueries\.findById\(signedIn\.id, \{ email: 1, role: 1, approved: 1, emailVerified: 1 \}\)/)
    expect(source).toMatch(/adminRoleUpdate\(user, adminEmails\)/)
    expect(source).toMatch(/await userQueries\.updateById\(signedIn\.id, update\)/)
    expect(source).toMatch(/const role = roleForNewUser\(user, adminEmails\)/)
    expect(source).not.toMatch(/setRole\(/)
    expect(source).not.toMatch(/callback\/social/)
    // The role is read from the user document on every lookup only while there is no cache
    expect(source).not.toMatch(/cookieCache|secondaryStorage/)
  })

  it('auth.ts refuses a sign-up for a listed, unverified address, with a code /auth/error explains', () => {
    const source = read('src', 'lib', 'auth.ts')

    expect(source).toMatch(
      /if \(refusesNewUser\(user, adminEmails\)\) \{[\s\S]{0,120}throw new APIError\('FORBIDDEN', \{\s+code: UNVERIFIED_ADMIN_EMAIL,/
    )
    expect(source).toMatch(/onAPIError: \{\n\s+errorURL: '\/auth\/error',/)
    const callback = read('node_modules', 'better-auth', 'dist', 'api', 'routes', 'callback.mjs')
    // A thrown APIError with a code redirects to errorURL?error=<code>
    expect(callback).toMatch(/if \(isAPIError\(e\) && e\.body\?\.code\) redirectOnError\(e\.body\.code, e\.body\.message\)/)
    // A returned error (account not linked) becomes its words joined with _
    expect(callback).toMatch(/redirectOnError\(result\.error\.split\(" "\)\.join\("_"\)\)/)
    expect(read('src', 'app', '(styled)', 'auth', 'error', 'page.js')).toMatch(/'unverified_admin_email',/)
    expect(read('src', 'app', '(styled)', 'auth', 'error', 'page.js')).toMatch(/'account_not_linked',/)
  })

  it('links a sign-in to an existing account only when its provider verified the email', () => {
    // better-auth skips the emailVerified check for a trusted provider; an
    // upgrade that changes that rule fails here
    const linkAccount = read('node_modules', 'better-auth', 'dist', 'oauth2', 'link-account.mjs')
    expect(linkAccount).toMatch(
      /const isTrustedProvider = opts\.isTrustedProvider \|\| opts\.trustProviderByName !== false && c\.context\.trustedProviders\.includes\(account\.providerId\);/
    )
    // ...and, since 1.6.11, only to a local user whose own email is verified
    expect(linkAccount).toMatch(
      /!isTrustedProvider && !userInfo\.emailVerified \|\| requireLocalEmailVerified && !dbUser\.user\.emailVerified/
    )

    expect(read('src', 'lib', 'auth.ts')).toMatch(/trustedProviders: \[\],/)
  })

  it('instrumentation.ts prepares the auth data and reconciles the roles at each server start, on Node only', () => {
    const source = read('src', 'instrumentation.ts')

    expect(source).toMatch(/if \(process\.env\.NEXT_RUNTIME === 'nodejs'\) \{\n\s+import\('@src\/lib\/authDataPrep'\)/)
    expect(source).toMatch(/import\('@src\/lib\/adminRoleReconcile'\)/)
    expect(source).toMatch(/export function register\(\) \{\n {2}authStartupTasks\(\)/)
  })

  it('auth.ts allows only known device clients, gives /device room to claim, and reads trusted proxies from the env', () => {
    const source = read('src', 'lib', 'auth.ts')

    expect(source).toMatch(/validateClient: \(clientId: string\) => isKnownDeviceClient\(clientId\)/)
    expect(source).toMatch(/'\/device': \{ window: 15 \* 60, max: 20 \}/)
    expect(source).toMatch(/trustedProxies: trustedProxiesFromEnv\(\)/)
  })
})
