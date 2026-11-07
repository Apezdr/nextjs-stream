/**
 * @jest-environment node
 *
 * "View as": an admin browses as a user with a session better-auth opened for
 * them (impersonatedBy: the admin's id). That session only reads. The proxy
 * refuses its writes (API routes, Server Actions, better-auth's endpoints)
 * before any of them runs, from the session itself, and only looks the
 * session up for a request that may write and carries one. The guards at the
 * end fail when a new write path could get around that one check.
 *
 * With writes on (the bar's switch, kept on the session as viewAsWrites), the
 * user's app-data writes pass, each one logged, and what could change the
 * account or hand the session on is still refused.
 */
const fs = require('fs')
const path = require('path')

jest.mock('@src/utils/config', () => ({
  getAllServers: () => [
    { id: 'default', baseURL: 'https://files.example.com', syncEndpoint: 'https://files.example.com/node' },
  ],
}))
const mockGetSession = jest.fn()
jest.mock('@src/lib/auth', () => ({ auth: { api: { getSession: (...args) => mockGetSession(...args) } } }))
const mockLogError = jest.fn()
const mockLogInfo = jest.fn()
jest.mock('@src/lib/logger', () => ({
  createLogger: () => ({
    error: (...args) => mockLogError(...args),
    warn: jest.fn(),
    info: (...args) => mockLogInfo(...args),
    debug: jest.fn(),
  }),
}))

const { NextRequest } = require('next/server')
const { proxy, config } = require('@src/proxy')
const { isImpersonating, isViewAsWritesOn, canViewAs } = require('@src/lib/roles/rules')
const {
  VIEW_AS_REFUSAL,
  VIEW_AS_EXITS,
  READ_ONLY_POSTS,
  WRITING_GETS,
  VIEW_AS_WRITES_SWITCH,
  ALWAYS_REFUSED_PREFIXES,
  mayWrite,
  isAlwaysRefused,
  carriesSession,
} = require('@src/lib/viewAsGuard')

const ROOT = path.join(__dirname, '..', '..')
const read = (...segments) => fs.readFileSync(path.join(ROOT, ...segments), 'utf8')

const COOKIE = 'nextjs-stream.session_token=tok.sig; theme=dark'
const VIEW_AS = { session: { token: 'tok', userId: 'u1', impersonatedBy: 'a1' }, user: { id: 'u1', role: 'user' } }
const WRITING = {
  session: { ...VIEW_AS.session, viewAsWrites: true },
  user: { id: 'u1', role: 'user', email: 'u1@example.com' },
}
const OWN = { session: { token: 'tok', userId: 'u1' }, user: { id: 'u1', role: 'user' } }

// better-auth's endpoints that change the user, their sign-ins or sessions,
// approve a device, or open a session: refused while viewing as, writes on or off
const AUTH_WRITES = [
  '/api/auth/update-user',
  '/api/auth/update-session',
  '/api/auth/change-email',
  '/api/auth/change-password',
  '/api/auth/link-social',
  '/api/auth/unlink-account',
  '/api/auth/delete-user',
  '/api/auth/revoke-session',
  '/api/auth/revoke-sessions',
  '/api/auth/revoke-other-sessions',
  '/api/auth/device/approve',
  '/api/auth/device/deny',
  '/api/auth/device/token',
  '/api/auth/sign-in/social',
  '/api/auth/admin/impersonate-user',
]

const request = (pathname, { method = 'POST', headers = { cookie: COOKIE } } = {}) =>
  new NextRequest(`https://app.example${pathname}`, { method, headers })
const passes = (response) => response.headers.get('x-middleware-next') === '1'

beforeEach(() => {
  mockGetSession.mockReset()
  mockLogError.mockReset()
  mockLogInfo.mockReset()
})

describe('isViewAsWritesOn', () => {
  it('is a view-as session whose switch is on, and only that', () => {
    expect(isViewAsWritesOn(WRITING)).toBe(true)
    expect(isViewAsWritesOn(VIEW_AS)).toBe(false)
    expect(isViewAsWritesOn({ session: { ...VIEW_AS.session, viewAsWrites: false } })).toBe(false)
    // Only true itself, and only on a view-as session
    expect(isViewAsWritesOn({ session: { ...VIEW_AS.session, viewAsWrites: 'true' } })).toBe(false)
    expect(isViewAsWritesOn({ session: { token: 'tok', viewAsWrites: true } })).toBe(false)
    expect(isViewAsWritesOn({ session: { impersonatedBy: 'a1' }, user: { viewAsWrites: true } })).toBe(false)
    expect(isViewAsWritesOn(null)).toBe(false)
  })
})

describe('isImpersonating', () => {
  it('is the session better-auth opened for "View as": impersonatedBy is set', () => {
    expect(isImpersonating(VIEW_AS)).toBe(true)
    expect(isImpersonating(OWN)).toBe(false)
    expect(isImpersonating({ session: { impersonatedBy: null } })).toBe(false)
    expect(isImpersonating({ session: { impersonatedBy: '' } })).toBe(false)
    // Only the session says so, never the user
    expect(isImpersonating({ session: {}, user: { impersonatedBy: 'a1' } })).toBe(false)
    expect(isImpersonating(null)).toBe(false)
    expect(isImpersonating(undefined)).toBe(false)
  })
})

describe('canViewAs (the Users page button)', () => {
  const VIEWER = 'a1'

  it('is offered for members and pending users', () => {
    expect(canViewAs(VIEWER, { id: 'u1', role: 'user', approved: 'true' })).toBe(true)
    expect(canViewAs(VIEWER, { id: 'p1', role: 'user', approved: 'false' })).toBe(true)
    expect(canViewAs(VIEWER, { id: 'old1' })).toBe(true)
  })

  it('is hidden on admin rows, which better-auth refuses, and on the viewer’s own row', () => {
    expect(canViewAs(VIEWER, { id: 'a2', role: 'admin' })).toBe(false)
    expect(canViewAs(VIEWER, { id: 'a1', role: 'user' })).toBe(false)
    expect(canViewAs(VIEWER, { id: 'a1', role: 'admin' })).toBe(false)
    expect(canViewAs(VIEWER, { role: 'user' })).toBe(false)
    expect(canViewAs(VIEWER, null)).toBe(false)
  })
})

describe('which requests are checked', () => {
  it('checks every method but GET and HEAD, except the way out and the read-only POSTs', () => {
    const headers = new Headers()
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      expect(mayWrite({ method, pathname: '/api/authenticated/watchlist', headers })).toBe(true)
    }
    expect(mayWrite({ method: 'GET', pathname: '/api/authenticated/watchlist', headers })).toBe(false)
    expect(mayWrite({ method: 'HEAD', pathname: '/api/authenticated/watchlist', headers })).toBe(false)
    expect(mayWrite({ method: 'POST', pathname: '/api/auth/sign-out', headers })).toBe(false)
    expect(mayWrite({ method: 'POST', pathname: '/api/authenticated/search', headers })).toBe(false)
    // Read-only means a plain POST: DELETE there, or an action posted to it, is checked
    expect(mayWrite({ method: 'DELETE', pathname: '/api/authenticated/search', headers })).toBe(true)
    expect(
      mayWrite({ method: 'POST', pathname: '/api/authenticated/search', headers: new Headers({ 'next-action': 'x' }) })
    ).toBe(true)
  })

  it('matches the lists however the path is spelled', () => {
    const headers = new Headers()
    expect(mayWrite({ method: 'POST', pathname: '/api/auth/sign-out/', headers })).toBe(false)
    expect(mayWrite({ method: 'POST', pathname: '//api/auth//sign-out', headers })).toBe(false)
    expect(mayWrite({ method: 'GET', pathname: '/api/auth/Device', headers })).toBe(true)
    expect(mayWrite({ method: 'GET', pathname: '/api/auth/devic%65', headers })).toBe(true)
    expect(mayWrite({ method: 'GET', pathname: '/api/auth/%E0%A4%A', headers })).toBe(false)
  })

  it('a session is a better-auth session cookie, any prefix, or a Bearer token', () => {
    expect(carriesSession(new Headers({ cookie: 'nextjs-stream.session_token=x' }))).toBe(true)
    expect(carriesSession(new Headers({ cookie: 'a=1; __Secure-nextjs-stream.session_token=x' }))).toBe(true)
    expect(carriesSession(new Headers({ cookie: 'better-auth.session_token=x' }))).toBe(true)
    expect(carriesSession(new Headers({ authorization: 'Bearer abc' }))).toBe(true)
    expect(carriesSession(new Headers({ authorization: 'bearer abc' }))).toBe(true)
    // Only the admin's parked session, or nothing to do with auth
    expect(carriesSession(new Headers({ cookie: 'nextjs-stream.admin_session=x; theme=dark' }))).toBe(false)
    expect(carriesSession(new Headers({ cookie: 'session_token_hint=1' }))).toBe(false)
    expect(carriesSession(new Headers({ authorization: 'Basic abc' }))).toBe(false)
    expect(carriesSession(new Headers())).toBe(false)
  })
})

describe('the proxy, for a view-as session', () => {
  beforeEach(() => mockGetSession.mockResolvedValue(VIEW_AS))

  it('refuses an API write with 403 and the IMPERSONATING body', async () => {
    const response = await proxy(request('/api/authenticated/sync/updatePlayback'))
    expect(response.status).toBe(403)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({
      error: 'IMPERSONATING',
      message: 'Read-only while viewing as another user.',
    })
    // The lookup every route makes, for the request's own headers, without the refresh
    const [{ headers, query }] = mockGetSession.mock.calls[0]
    expect(headers.get('cookie')).toBe(COOKIE)
    expect(query).toEqual({ disableRefresh: true })
  })

  it('refuses every write method', async () => {
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      expect((await proxy(request('/api/authenticated/watchlist', { method }))).status).toBe(403)
    }
  })

  it('refuses a Server Action as text/plain, which the action’s client throws as the message', async () => {
    const response = await proxy(
      request('/admin/users', { headers: { cookie: COOKIE, 'next-action': '7f00ab', accept: 'text/x-component' } })
    )
    expect(response.status).toBe(403)
    // Exactly text/plain: with a charset the client would show "An unexpected response"
    expect(response.headers.get('content-type')).toBe('text/plain')
    expect(await response.text()).toBe(VIEW_AS_REFUSAL.message)
  })

  it('refuses better-auth’s endpoints that change the user or their sessions', async () => {
    for (const endpoint of AUTH_WRITES) {
      const response = await proxy(request(endpoint))
      expect([endpoint, response.status]).toEqual([endpoint, 403])
    }
  })

  it('lets the writes switch through while read-only, without a lookup (the endpoint checks for itself)', async () => {
    expect(passes(await proxy(request(VIEW_AS_WRITES_SWITCH)))).toBe(true)
    expect(passes(await proxy(request(`${VIEW_AS_WRITES_SWITCH}/`)))).toBe(true)
    expect(mockGetSession).not.toHaveBeenCalled()
    // Only as a plain POST: an action posted to it, or another method, is checked
    expect((await proxy(request(VIEW_AS_WRITES_SWITCH, { headers: { cookie: COOKIE, 'next-action': 'x' } }))).status).toBe(403)
    expect((await proxy(request(VIEW_AS_WRITES_SWITCH, { method: 'PUT' }))).status).toBe(403)
  })

  it('refuses the GETs that write or hand the session on', async () => {
    for (const endpoint of ['/api/auth/device?user_code=ABCDEFGH', '/api/auth/account-info', '/api/auth/mobile-redirect']) {
      const response = await proxy(request(endpoint, { method: 'GET' }))
      expect([endpoint, response.status]).toEqual([endpoint, 403])
    }
  })

  it('lets the way out through, without a lookup', async () => {
    for (const exit of ['/api/auth/admin/stop-impersonating', '/api/auth/sign-out']) {
      expect(passes(await proxy(request(exit)))).toBe(true)
    }
    expect(mockGetSession).not.toHaveBeenCalled()
  })

  it('lets reads through, without a lookup: GETs, HEADs and the read-only POSTs', async () => {
    expect(passes(await proxy(request('/api/authenticated/watchlist?action=list', { method: 'GET' })))).toBe(true)
    expect(passes(await proxy(request('/list/movie', { method: 'GET' })))).toBe(true)
    expect(passes(await proxy(request('/api/authenticated/media', { method: 'HEAD' })))).toBe(true)
    for (const readOnly of READ_ONLY_POSTS) expect(passes(await proxy(request(readOnly)))).toBe(true)
    expect(mockGetSession).not.toHaveBeenCalled()
  })

  it('refuses a Bearer write, looked up from the headers the route sees (no stale cookie)', async () => {
    const response = await proxy(
      request('/api/authenticated/sync/updatePlayback', {
        headers: { authorization: 'Bearer tok', cookie: 'nextjs-stream.session_token=stale.sig; theme=dark' },
      })
    )
    expect(response.status).toBe(403)
    const [{ headers }] = mockGetSession.mock.calls[0]
    expect(headers.get('authorization')).toBe('Bearer tok')
    expect(headers.get('cookie')).toBe('theme=dark')
  })
})

describe('the proxy, for a view-as session with writes on', () => {
  beforeEach(() => mockGetSession.mockResolvedValue(WRITING))

  // The user's app data: playback and watched marks, watchlists and playlists,
  // notifications, Radarr/Sonarr requests, and Server Actions (posted to a page)
  const APP_WRITES = [
    ['POST', '/api/authenticated/sync/updatePlayback', {}],
    ['POST', '/api/authenticated/sync/presence/end', {}],
    ['POST', '/api/authenticated/watchlist', {}],
    ['PUT', '/api/authenticated/watchlist', {}],
    ['DELETE', '/api/authenticated/watchlist', {}],
    ['POST', '/api/authenticated/notifications', {}],
    ['POST', '/api/authenticated/arr/titles/movie/603/search', {}],
    ['POST', '/api/authenticated/user/preferences', {}],
    ['POST', '/list/movie', { 'next-action': '7f00ab' }],
  ]

  it('lets the user’s app-data writes through, Server Actions too, with one lookup each', async () => {
    for (const [method, pathname, extra] of APP_WRITES) {
      mockGetSession.mockClear()
      const response = await proxy(request(pathname, { method, headers: { cookie: COOKIE, ...extra } }))
      expect([method, pathname, passes(response)]).toEqual([method, pathname, true])
      // The setting comes with the lookup the guard already makes: nothing more is read
      expect(mockGetSession).toHaveBeenCalledTimes(1)
    }
  })

  it('logs every write it lets through: method, path, both users’ ids, never an email', async () => {
    await proxy(request('/api/authenticated/watchlist', { method: 'DELETE' }))
    await proxy(request('/list/movie', { headers: { cookie: COOKIE, 'next-action': '7f00ab' } }))
    expect(mockLogInfo).toHaveBeenCalledTimes(2)
    expect(mockLogInfo).toHaveBeenNthCalledWith(
      1,
      { method: 'DELETE', path: '/api/authenticated/watchlist', serverAction: false, adminId: 'a1', targetUserId: 'u1' },
      'View as: write let through'
    )
    expect(mockLogInfo.mock.calls[1][0]).toMatchObject({ method: 'POST', path: '/list/movie', serverAction: true })
    expect(JSON.stringify(mockLogInfo.mock.calls)).not.toMatch(/@example\.com/)
  })

  it('still refuses every better-auth endpoint but the way out: device approvals, account and session changes', async () => {
    // A TV approved while viewing as would get an ordinary 30-day session as
    // the user, not a view-as one: the device endpoints stay refused
    for (const endpoint of [...AUTH_WRITES, '/api/auth/some-future-endpoint', '/api/auth/']) {
      const response = await proxy(request(endpoint))
      expect([endpoint, response.status]).toEqual([endpoint, 403])
    }
    expect(mockLogInfo).not.toHaveBeenCalled()
  })

  it('still refuses the GETs that write or hand the session to another client (the TV app’s token)', async () => {
    for (const endpoint of ['/api/auth/device?user_code=ABCDEFGH', '/api/auth/account-info', '/api/auth/mobile-redirect']) {
      const response = await proxy(request(endpoint, { method: 'GET' }))
      expect([endpoint, response.status]).toEqual([endpoint, 403])
      expect(await response.json()).toEqual(VIEW_AS_REFUSAL)
    }
  })

  it('still refuses this app’s own account endpoints: a deletion request, or cancelling one', async () => {
    for (const method of ['POST', 'DELETE']) {
      expect((await proxy(request('/api/authenticated/account/delete-request', { method }))).status).toBe(403)
    }
  })

  it('however the path is spelled', async () => {
    for (const endpoint of ['/api/auth/Device/Approve', '//api/auth//delete-user/', '/api/auth/revoke%2Dsessions', '/API/AUTHENTICATED/account/delete-request']) {
      const response = await proxy(request(endpoint))
      expect([endpoint, response.status]).toEqual([endpoint, 403])
    }
  })

  it('lets the way out and the switch through, without a lookup', async () => {
    for (const path of [...VIEW_AS_EXITS, VIEW_AS_WRITES_SWITCH]) expect(passes(await proxy(request(path)))).toBe(true)
    expect(mockGetSession).not.toHaveBeenCalled()
  })

  it('a session with writes on that is not a view-as one is just the user’s own', async () => {
    mockGetSession.mockResolvedValue({ session: { token: 'tok', viewAsWrites: true }, user: { id: 'u1' } })
    expect(passes(await proxy(request('/api/auth/update-user')))).toBe(true)
    expect(mockLogInfo).not.toHaveBeenCalled()
  })
})

describe('the proxy, for everyone else', () => {
  it('lets a write with the user’s own session through', async () => {
    mockGetSession.mockResolvedValue(OWN)
    const response = await proxy(request('/api/authenticated/sync/updatePlayback'))
    expect(passes(response)).toBe(true)
    // ...with the no-store default still applied
    expect(response.headers.get('cache-control')).toBe('no-store, private')
    expect(mockGetSession).toHaveBeenCalledTimes(1)
  })

  it('lets a write through when the session has ended (the route answers it)', async () => {
    mockGetSession.mockResolvedValue(null)
    expect(passes(await proxy(request('/api/authenticated/watchlist')))).toBe(true)
  })

  it('never looks a session up for a request that carries none (webhooks, sign-in)', async () => {
    const webhook = request('/api/authenticated/admin/sync', { headers: { 'x-webhook-id': 'w' } })
    expect(passes(await proxy(webhook))).toBe(true)
    expect(passes(await proxy(request('/api/auth/sign-in/social', { headers: { cookie: 'theme=dark' } })))).toBe(true)
    expect(mockGetSession).not.toHaveBeenCalled()
  })

  it('refuses a write whose session can’t be looked up, rather than guess', async () => {
    mockGetSession.mockRejectedValue(new Error('Mongo is away'))
    const response = await proxy(request('/api/authenticated/watchlist'))
    expect(response.status).toBe(503)
    expect((await response.json()).error).toBe('SESSION_CHECK_FAILED')
    expect(mockLogError).toHaveBeenCalledWith({ error: 'Mongo is away' }, expect.any(String))

    const action = await proxy(request('/list', { headers: { cookie: COOKIE, 'next-action': '7f00ab' } }))
    expect(action.status).toBe(503)
    expect(action.headers.get('content-type')).toBe('text/plain')
  })
})

// ---------------------------------------------------------------------------
// Guards: a new write path that could get around the one check fails here.

function routeFiles(dir = path.join(ROOT, 'src', 'app')) {
  const found = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) found.push(...routeFiles(full))
    else if (/^(route|page)\.(js|jsx|ts|tsx)$/.test(entry.name)) found.push(full)
  }
  return found
}

/** The URL path a route or page file serves: route groups dropped, dynamic segments filled. */
const urlOf = (file) =>
  '/' +
  path
    .relative(path.join(ROOT, 'src', 'app'), path.dirname(file))
    .split(path.sep)
    .filter((segment) => segment && !/^\(.*\)$/.test(segment))
    .map((segment) => segment.replace(/^\[\[?\.{0,3}(.+?)\]?\]$/, 'x'))
    .join('/')

const WRITE_EXPORT = /export\s+(?:async\s+)?(?:function|const)\s+(POST|PUT|PATCH|DELETE)\b|export\s*(?:const\s*)?\{[^}]*\b(POST|PUT|PATCH|DELETE)\b/
// How a route reads the session the proxy checks
const READS_SESSION = /@src\/lib\/roles\/gates|@src\/lib\/cachedAuth|@src\/lib\/roles\/session|@src\/lib\/arr\/access|toNextJsHandler/

describe('guards: every write goes through the proxy’s check', () => {
  it('the proxy runs on every route and page (the matcher is pinned)', () => {
    expect(config.matcher).toEqual(['/((?!_next/static|_next/image|favicon.ico).*)', '/_next/image'])
    // Next compiles the first entry as this pattern; Server Actions post to page paths
    const matcher = /^\/((?!_next\/static|_next\/image|favicon.ico).*)$/
    const files = routeFiles()
    expect(files.length).toBeGreaterThan(50)
    for (const file of files) expect([urlOf(file), matcher.test(urlOf(file))]).toEqual([urlOf(file), true])
  })

  it('the proxy checks before it lets anything through', () => {
    const source = read('src', 'proxy.ts')
    const body = source.slice(source.indexOf('export async function proxy'))
    const afterImages = body.slice(body.indexOf("if (request.nextUrl.pathname === '/_next/image')"))
    const imageBranchEnd = afterImages.indexOf('\n  }\n')
    const rest = afterImages.slice(imageBranchEnd)
    expect(rest.indexOf('await refuseViewAsWrite(')).toBeGreaterThan(-1)
    expect(rest.indexOf('await refuseViewAsWrite(')).toBeLessThan(rest.indexOf('NextResponse.next('))
  })

  it('the way out, the read-only POSTs and the writing GETs are exactly these', () => {
    expect([...VIEW_AS_EXITS].sort()).toEqual(['/api/auth/admin/stop-impersonating', '/api/auth/sign-out'])
    // A POST lands here only after reading it through to make sure it writes nothing
    expect([...READ_ONLY_POSTS].sort()).toEqual([
      '/api/authenticated/media',
      '/api/authenticated/media/in-library',
      '/api/authenticated/search',
    ])
    expect([...WRITING_GETS].sort()).toEqual(['/api/auth/account-info', '/api/auth/device', '/api/auth/mobile-redirect'])
    // The bar's switch, which passes while read-only, and what writes on never lets through
    expect(VIEW_AS_WRITES_SWITCH).toBe('/api/authenticated/view-as/writes')
    expect([...ALWAYS_REFUSED_PREFIXES].sort()).toEqual(['/api/auth/', '/api/authenticated/account/'])
    for (const getter of WRITING_GETS) expect(isAlwaysRefused({ method: 'GET', pathname: getter, headers: new Headers() })).toBe(true)
  })

  it('the switch’s route is where the guard expects it, and checks the session itself', () => {
    const files = Object.fromEntries(routeFiles().map((file) => [urlOf(file), file]))
    const source = fs.readFileSync(files[VIEW_AS_WRITES_SWITCH], 'utf8')
    expect(source).toMatch(/if \(!isImpersonating\(session\)\) \{/)
    expect(source).toMatch(/userQueries\.findById\(session\.session\.impersonatedBy/)
    expect(source).toMatch(/if \(!isAdminUser\(admin\)\) \{/)
  })

  it('a read-only POST’s route writes nothing itself', () => {
    const files = Object.fromEntries(routeFiles().map((file) => [urlOf(file), file]))
    for (const readOnly of READ_ONLY_POSTS) {
      const source = fs.readFileSync(files[readOnly], 'utf8')
      expect([readOnly, /\.(insert|update|delete|replace)(One|Many)\(|findOneAnd|bulkWrite\(|upsert/.test(source)]).toEqual([
        readOnly,
        false,
      ])
    }
  })

  it('only these routes write without the session, so the proxy has nothing to check', () => {
    // A route that writes on some other credential is out of the proxy's
    // sight. Before adding one, make sure a view-as session can't obtain that
    // credential: the Cast token is why the play page mints none for one.
    const sessionless = routeFiles()
      .filter((file) => /^route\./.test(path.basename(file)))
      .filter((file) => {
        const source = fs.readFileSync(file, 'utf8')
        return WRITE_EXPORT.test(source) && !READS_SESSION.test(source)
      })
      .map(urlOf)
      .sort()
    expect(sessionless).toEqual([
      '/api/cast/playback', // the Cast receiver's token (castPlaybackToken.ts)
      '/api/public/delete-request', // an account-deletion request by email address
      '/api/public/verify-deletion', // the link in that email
    ])
  })

  it('the play page mints no Cast token for a view-as session, unless writes were on when it rendered', () => {
    const source = read('src', 'components', 'MediaPlayer', 'MediaPlayer.js')
    expect(source).toMatch(
      /const castPlaybackToken =\s+session\?\.user\?\.id && !isAwaitingApproval\(session\.user\) && \(!isImpersonating\(session\) \|\| isViewAsWritesOn\(session\)\) && videoURL/
    )
    // ...from the full session the play page reads (getSession, never the
    // gate's trimmed copy, which has no session.impersonatedBy)
    for (const page of [['movie', '[title]'], ['tv', '[title]', '[season]', '[episode]']]) {
      const pageSource = read('src', 'app', '(styled)', 'list', ...page, 'play', 'page.js')
      expect(pageSource).toMatch(/const session = await getSession\(\)/)
    }
    // ...and nothing else mints one
    const all = []
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (/\.(js|jsx|ts|tsx)$/.test(entry.name) && fs.readFileSync(full, 'utf8').includes('mintCastPlaybackToken(')) {
          all.push(path.relative(ROOT, full).split(path.sep).join('/'))
        }
      }
    }
    walk(path.join(ROOT, 'src'))
    expect(all.sort()).toEqual(['src/components/MediaPlayer/MediaPlayer.js', 'src/lib/castPlaybackToken.ts'])
  })
})
