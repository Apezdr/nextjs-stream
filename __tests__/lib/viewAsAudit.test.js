/**
 * @jest-environment node
 *
 * Every "View as" start and stop is logged from auth.ts's after hook, with the
 * admin's and the viewed user's ids, never an email. The hook reads what
 * better-auth's admin endpoints leave on their context; the guards read its
 * dist (ESM-only, which this Jest setup doesn't load) to fail an upgrade that
 * moves any of it.
 */
const fs = require('fs')
const path = require('path')

const { auditViewAs, VIEW_AS_START_PATH, VIEW_AS_STOP_PATH } = require('@src/lib/viewAsAudit')
const { holdViewAsExpiry } = require('@src/lib/viewAsSession')

const read = (...segments) => fs.readFileSync(path.join(__dirname, '..', '..', ...segments), 'utf8')

const ADMIN = { session: { token: 'admin-tok', userId: 'a1' }, user: { id: 'a1', email: 'admin@example.com' } }
const VIEW_AS = {
  session: { token: 'view-tok', userId: 'u1', impersonatedBy: 'a1' },
  user: { id: 'u1', email: 'user@example.com', name: 'User One' },
}

const fakeLog = () => ({ info: jest.fn(), warn: jest.fn() })
/** better-call's APIError, as far as the audit reads it */
const apiError = (statusCode, message, code) =>
  Object.assign(new Error(message), { status: 'FORBIDDEN', statusCode, body: { message, code } })

describe('auditViewAs', () => {
  it('logs a start with the admin’s and the user’s ids', () => {
    const log = fakeLog()
    auditViewAs(
      {
        path: VIEW_AS_START_PATH,
        body: { userId: 'u1' },
        context: { session: ADMIN, newSession: VIEW_AS, returned: { session: VIEW_AS.session } },
      },
      log
    )
    expect(log.info).toHaveBeenCalledWith({ adminId: 'a1', targetUserId: 'u1' }, 'View as: started')
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('logs a stop with the ids of the session it ended', () => {
    const log = fakeLog()
    auditViewAs({ path: VIEW_AS_STOP_PATH, context: { session: VIEW_AS, newSession: ADMIN, returned: {} } }, log)
    expect(log.info).toHaveBeenCalledWith({ adminId: 'a1', targetUserId: 'u1' }, 'View as: stopped')
  })

  it('logs a refused start or stop with better-auth’s reason', () => {
    const log = fakeLog()
    auditViewAs(
      {
        path: VIEW_AS_START_PATH,
        body: { userId: 'a2' },
        context: { session: ADMIN, returned: apiError(403, 'You cannot impersonate admins', 'YOU_CANNOT_IMPERSONATE_ADMINS') },
      },
      log
    )
    expect(log.warn).toHaveBeenCalledWith(
      {
        adminId: 'a1',
        targetUserId: 'a2',
        status: 403,
        code: 'YOU_CANNOT_IMPERSONATE_ADMINS',
        reason: 'You cannot impersonate admins',
      },
      'View as: start refused'
    )

    auditViewAs(
      {
        path: VIEW_AS_STOP_PATH,
        context: { session: ADMIN, returned: apiError(400, 'You are not impersonating anyone') },
      },
      log
    )
    expect(log.warn).toHaveBeenLastCalledWith(
      { adminId: null, userId: 'a1', status: 400, code: null, reason: 'You are not impersonating anyone' },
      'View as: stop refused'
    )
    expect(log.info).not.toHaveBeenCalled()
  })

  it('never logs an email or a name', () => {
    const log = fakeLog()
    auditViewAs({ path: VIEW_AS_START_PATH, context: { session: ADMIN, newSession: VIEW_AS, returned: {} } }, log)
    auditViewAs({ path: VIEW_AS_STOP_PATH, context: { session: VIEW_AS, newSession: ADMIN, returned: {} } }, log)
    const logged = JSON.stringify([...log.info.mock.calls, ...log.warn.mock.calls])
    expect(logged).not.toMatch(/@example\.com|User One/)
  })

  it('ignores every other path, and never throws', () => {
    const log = fakeLog()
    for (const other of ['/get-session', '/sign-in/social', '/admin/set-role', undefined]) {
      auditViewAs({ path: other, context: { session: ADMIN, newSession: VIEW_AS } }, log)
    }
    expect(log.info).not.toHaveBeenCalled()
    const throwing = { info: () => { throw new Error('pino broke') }, warn: jest.fn() }
    expect(() => auditViewAs({ path: VIEW_AS_STOP_PATH, context: { session: VIEW_AS } }, throwing)).not.toThrow()
    expect(() => auditViewAs({ path: VIEW_AS_START_PATH, context: null }, log)).not.toThrow()
  })
})

describe('the hour (holdViewAsExpiry)', () => {
  const inMinutes = (minutes) => new Date(Date.now() + minutes * 60_000)
  const found = (session) => ({ context: { session: { session, user: { id: 'u1' } } } })

  it('holds a view-as session’s expiry when a refresh would move it out', () => {
    const expiresAt = inMinutes(40)
    const update = { expiresAt: inMinutes(30 * 24 * 60), updatedAt: new Date() }
    const held = holdViewAsExpiry(update, found({ impersonatedBy: 'a1', expiresAt }))
    expect(held.data.expiresAt).toEqual(expiresAt)
    expect(held.data.updatedAt).toBe(update.updatedAt)
    // As better-auth hands it over from Redis: an ISO string
    expect(holdViewAsExpiry(update, found({ impersonatedBy: 'a1', expiresAt: expiresAt.toISOString() })).data.expiresAt).toEqual(
      expiresAt
    )
  })

  it('leaves every other update alone', () => {
    const update = { expiresAt: inMinutes(30 * 24 * 60) }
    expect(holdViewAsExpiry(update, found({ expiresAt: inMinutes(40) }))).toBeUndefined()
    expect(holdViewAsExpiry(update, found({ impersonatedBy: null, expiresAt: inMinutes(40) }))).toBeUndefined()
    expect(holdViewAsExpiry({ expiresAt: inMinutes(10) }, found({ impersonatedBy: 'a1', expiresAt: inMinutes(40) }))).toBeUndefined()
    expect(holdViewAsExpiry({ updatedAt: new Date() }, found({ impersonatedBy: 'a1', expiresAt: inMinutes(40) }))).toBeUndefined()
    expect(holdViewAsExpiry(update, null)).toBeUndefined()
    expect(holdViewAsExpiry(update, { context: { session: null } })).toBeUndefined()
  })

  it('auth.ts runs it on every session update, and better-auth refreshes the session it left on the context', () => {
    expect(read('src', 'lib', 'auth.ts')).toMatch(
      /session: \{\n\s+update: \{\n(\s+\/\/[^\n]*\n)+\s+before: async \(session, ctx\) => holdViewAsExpiry\(session, ctx as Parameters<typeof holdViewAsExpiry>\[1\]\),/
    )
    const session = read('node_modules', 'better-auth', 'dist', 'api', 'routes', 'session.mjs')
    // get-session puts the session it found on ctx.context, then refreshes that token
    expect(session).toMatch(
      /const session = await ctx\.context\.internalAdapter\.findSession\(sessionCookieToken\);\s+ctx\.context\.session = session;/
    )
    expect(session).toMatch(/await ctx\.context\.internalAdapter\.updateSession\(session\.session\.token, \{\s+expiresAt: getDate\(/)
    // The update hook gets the endpoint's context, and its { data } replaces the update
    const hooks = read('node_modules', 'better-auth', 'dist', 'db', 'with-hooks.mjs')
    expect(hooks).toMatch(/async function updateWithHooks\(data, where, model, customUpdateFn\) \{\s+const context = tryGetCurrentAuthEndpointContext\(\);/)
    expect(hooks).toMatch(/if \(typeof result === "object" && "data" in result\) actualData = \{\s+\.\.\.actualData,\s+\.\.\.result\.data\s+\};/)
  })
})

describe('the wiring', () => {
  it('auth.ts audits both paths in its after hook, and states the hour', () => {
    const source = read('src', 'lib', 'auth.ts')
    expect(source).toMatch(
      /recordAuthHandlerCaller\([^\n]+\)\n\n[^\n]*\n\s+if \(ctx\.path === VIEW_AS_START_PATH \|\| ctx\.path === VIEW_AS_STOP_PATH\) \{\n\s+auditViewAs\(ctx as Parameters<typeof auditViewAs>\[0\], viewAsLog\)/
    )
    expect(source).toMatch(/const viewAsLog = createLogger\('Auth\.ViewAs'\)/)
    expect(source).toMatch(/admin\(\{[\s\S]{0,700}impersonationSessionDuration: 60 \* 60,/)
  })

  it("better-auth 1.7.15's admin endpoints leave what the audit reads", () => {
    const routes = read('node_modules', 'better-auth', 'dist', 'plugins', 'admin', 'routes.mjs')
    expect(routes).toContain('createAuthEndpoint("/admin/impersonate-user"')
    expect(routes).toContain('createAuthEndpoint("/admin/stop-impersonating"')
    // start: the session is opened for the target with the admin's id, for the configured time
    expect(routes).toMatch(
      /createSession\(targetUser\.id, true, \{\s+impersonatedBy: ctx\.context\.session\.user\.id,\s+expiresAt: opts\?\.impersonationSessionDuration \? getDate\(opts\.impersonationSessionDuration, "sec"\) : getDate\(3600, "sec"\)/
    )
    // ...and set with dont_remember (true), so the browser's requests never refresh it
    expect(routes).toMatch(/await setSessionCookie\(ctx, \{\s+session,\s+user: targetUser\s+\}, true\);/)
    // stop: the view-as session is read onto the context, then the admin's put back
    expect(routes).toMatch(/const session = await getSessionFromCtx\(ctx\);[\s\S]{0,200}session\.session\.impersonatedBy/)
    expect(routes).toMatch(/await ctx\.context\.internalAdapter\.deleteSession\(session\.session\.token\);\s+await setSessionCookie\(ctx, adminSession/)
    // Admins can't be viewed as unless allowed, which this app doesn't
    expect(routes).toMatch(/opts\.allowImpersonatingAdmins === true/)
    expect(read('src', 'lib', 'auth.ts')).not.toMatch(/allowImpersonatingAdmins/)

    const session = read('node_modules', 'better-auth', 'dist', 'api', 'routes', 'session.mjs')
    // getSessionFromCtx leaves the session on ctx.context, where the hook reads it
    expect(session).toMatch(/ctx\.context\.session = session\.response;\s+return session\.response;/)
    // A dont_remember session is never refreshed
    expect(session).toMatch(/if \(dontRememberMe \|\| ctx\.query\?\.disableRefresh\) \{/)
    const cookies = read('node_modules', 'better-auth', 'dist', 'cookies', 'index.mjs')
    expect(cookies).toMatch(/ctx\.context\.setNewSession\(session\);/)
    // Middleware results merge into the same context object the after hooks see
    expect(read('node_modules', 'better-call', 'dist', 'context.mjs')).toMatch(
      /if \(response\.response\) Object\.assign\(internalContext\.context, response\.response\);/
    )
    // An endpoint's thrown APIError is what the after hooks see as returned
    expect(read('node_modules', 'better-auth', 'dist', 'api', 'dispatch.mjs')).toMatch(
      /internalContext\.context\.returned = result\.response;\s+mergeResponseHeaders\(internalContext\.context, result\.headers\);\s+const after = await runAfterHooks/
    )
  })
})
