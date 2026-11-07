/**
 * @jest-environment node
 *
 * A playback save lands on the account its page was rendered for, or
 * nowhere. Every browser playback write names that user (X-Playback-User),
 * and the routes refuse a cookie write whose session is someone else's:
 * after a "View as" Stop (the admin's cookie is back as the player's final
 * save leaves) or a sign-in in another tab. Bearer clients, the TV and
 * desktop apps, are exempt: their token is the identity.
 *
 * The guards at the end find every browser playback write in src and fail
 * when one doesn't name its page's user.
 */
const fs = require('fs')
const path = require('path')

const mockGate = jest.fn()
jest.mock('@src/lib/roles/gates', () => ({
  approvedGate: { route: (...args) => mockGate(...args) },
  signedInGate: { route: (...args) => mockGate(...args) },
}))
const mockUpsert = jest.fn(async () => ({ acknowledged: true, outcome: 'updated' }))
const mockUpsertCast = jest.fn(async () => true)
const mockValidation = jest.fn(async () => ({}))
jest.mock('@src/utils/watchHistory/database', () => ({
  upsertPlayback: (...args) => mockUpsert(...args),
  upsertPlaybackFromCast: (...args) => mockUpsertCast(...args),
  updateValidationStatus: (...args) => mockValidation(...args),
}))
const mockEndPresence = jest.fn(async () => {})
jest.mock('@src/utils/playbackPresence/database', () => ({
  upsertPresenceHeartbeat: jest.fn(async () => true),
  isRepeatPausedPing: jest.fn(async () => false),
  endPresenceSession: (...args) => mockEndPresence(...args),
}))
jest.mock('@src/utils/watchHistory/metadata', () => ({ extractPlaybackMetadata: () => ({}) }))
jest.mock('@src/utils/videoIdentity', () => ({ generateNormalizedVideoId: () => 'nid' }))
jest.mock('@src/utils/flatDatabaseUtils', () => ({ generateNormalizedVideoId: () => 'nid' }))
jest.mock('@src/utils/deviceDetection', () => ({ createPlaybackDeviceInfo: () => ({}) }))
jest.mock('@src/utils/rateLimiter', () => ({ getClientIP: () => 'unknown' }))
jest.mock('@src/utils/cache/invalidation', () => ({ invalidateUserWatchHistoryCache: jest.fn(async () => {}) }))
jest.mock('@src/utils/changes/revisions', () => ({ bumpRevisionAfterResponse: jest.fn(), watchHistoryRevision: jest.fn() }))
const mockWarn = jest.fn()
jest.mock('@src/lib/logger', () => ({
  createLogger: () => ({ warn: (...args) => mockWarn(...args), info: jest.fn(), debug: jest.fn(), error: jest.fn() }),
}))
const mockGetSession = jest.fn()
jest.mock('@src/lib/auth', () => ({ auth: { api: { getSession: (...args) => mockGetSession(...args) } } }))
jest.mock('@src/utils/config', () => ({ getAllServers: () => [] }))

const {
  PLAYBACK_USER_HEADER,
  PLAYBACK_USER_MISMATCH,
  PLAYBACK_USER_REQUIRED,
  playbackWriteHeaders,
  refusePlaybackUserMismatch,
} = require('@src/lib/playbackUser')
const updatePlayback = require('@src/app/api/authenticated/sync/updatePlayback/route')
const presenceEnd = require('@src/app/api/authenticated/sync/presence/end/route')
const validation = require('@src/app/api/authenticated/sync/updateValidationStatus/route')
const { NextRequest } = require('next/server')
const { proxy } = require('@src/proxy')

const ROOT = path.join(__dirname, '..', '..')
const read = (...segments) => fs.readFileSync(path.join(ROOT, ...segments), 'utf8')

const USER = '507f1f77bcf86cd799439011'
const ADMIN = '507f1f77bcf86cd7994390aa'
const COOKIE = 'nextjs-stream.session_token=tok.sig'

const ROUTES = [
  ['updatePlayback', updatePlayback, { videoId: 'https://files.example.com/x.mp4', playbackTime: 120, kind: 'final', isPaused: true }],
  ['presence/end', presenceEnd, { sessionId: 's1' }],
  ['updateValidationStatus', validation, { videoId: 'https://files.example.com/x.mp4', isValid: false }],
]
const anyWrite = () => mockUpsert.mock.calls.length + mockEndPresence.mock.calls.length + mockValidation.mock.calls.length

const post = (route, body, headers) =>
  route.POST(
    new Request('https://app.example/api/authenticated/sync/x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  )

beforeEach(() => {
  jest.clearAllMocks()
  mockGate.mockResolvedValue({ id: USER })
  // updateValidationStatus logs each write to the console
  jest.spyOn(console, 'log').mockImplementation(() => {})
})

describe('the check (refusePlaybackUserMismatch)', () => {
  const check = (headers, sessionUserId = USER) => refusePlaybackUserMismatch({ headers: new Headers(headers) }, sessionUserId)

  it('passes a cookie write that names the session’s user', () => {
    expect(check({ cookie: COOKIE, [PLAYBACK_USER_HEADER]: USER })).toBeNull()
    expect(check({ cookie: COOKIE, 'x-playback-user': ` ${USER} ` })).toBeNull()
  })

  it('refuses one that names another user, 409 USER_MISMATCH', async () => {
    const refusal = check({ cookie: COOKIE, [PLAYBACK_USER_HEADER]: USER }, ADMIN)
    expect(refusal.status).toBe(409)
    expect(await refusal.json()).toEqual(PLAYBACK_USER_MISMATCH)
    expect(PLAYBACK_USER_MISMATCH.error).toBe('USER_MISMATCH')
  })

  it('refuses one that names no one, 400: the contract is enforced, never assumed', async () => {
    for (const headers of [{ cookie: COOKIE }, { cookie: COOKIE, [PLAYBACK_USER_HEADER]: '' }, { cookie: COOKIE, [PLAYBACK_USER_HEADER]: '  ' }]) {
      const refusal = check(headers)
      expect(refusal.status).toBe(400)
      expect(await refusal.json()).toEqual(PLAYBACK_USER_REQUIRED)
    }
  })

  it('leaves a Bearer client alone: its token is its identity', () => {
    expect(check({ authorization: `Bearer tok` })).toBeNull()
    expect(check({ authorization: `bearer tok`, [PLAYBACK_USER_HEADER]: ADMIN })).toBeNull()
    // Basic is no Bearer
    expect(check({ authorization: 'Basic abc' }).status).toBe(400)
  })

  it('logs a refusal with both ids', () => {
    const log = { warn: jest.fn() }
    refusePlaybackUserMismatch(
      { headers: new Headers({ cookie: COOKIE, [PLAYBACK_USER_HEADER]: USER }), url: 'https://app.example/api/authenticated/sync/updatePlayback' },
      ADMIN,
      log
    )
    expect(log.warn).toHaveBeenCalledWith(
      { userId: ADMIN, expectedUserId: USER, path: '/api/authenticated/sync/updatePlayback' },
      expect.any(String)
    )
  })

  it('the browser builds the header from the same module', () => {
    expect(playbackWriteHeaders(USER)).toEqual({ 'Content-Type': 'application/json', 'X-Playback-User': USER })
    expect(playbackWriteHeaders(null)).toEqual({ 'Content-Type': 'application/json' })
    expect(playbackWriteHeaders('')).toEqual({ 'Content-Type': 'application/json' })
  })
})

describe.each(ROUTES)('POST %s', (_name, route, body) => {
  it('writes for a cookie request from the user’s own page', async () => {
    const response = await post(route, body, { cookie: COOKIE, [PLAYBACK_USER_HEADER]: USER })
    expect(response.status).toBe(200)
    expect(anyWrite()).toBe(1)
  })

  it('refuses one from another account’s page (409), writing nothing', async () => {
    mockGate.mockResolvedValue({ id: ADMIN })
    const response = await post(route, body, { cookie: COOKIE, [PLAYBACK_USER_HEADER]: USER })
    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe('USER_MISMATCH')
    expect(anyWrite()).toBe(0)
    expect(mockWarn).toHaveBeenCalledWith(expect.objectContaining({ userId: ADMIN, expectedUserId: USER }), expect.any(String))
  })

  it('refuses a cookie write that names no one (400), writing nothing', async () => {
    const response = await post(route, body, { cookie: COOKIE })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('PLAYBACK_USER_REQUIRED')
    expect(anyWrite()).toBe(0)
  })

  it('takes a Bearer client’s write as it always has, with no header', async () => {
    const response = await post(route, body, { authorization: 'Bearer tok' })
    expect(response.status).toBe(200)
    expect(anyWrite()).toBe(1)
  })

  it('answers a signed-out caller as the gate does, before the check', async () => {
    mockGate.mockResolvedValue(new Response('{}', { status: 401 }))
    expect((await post(route, body, { cookie: COOKIE })).status).toBe(401)
  })
})

describe('with the "View as" guard in front', () => {
  // The proxy looks the session up from the cookie; the route's gate reads the same one
  const VIEWED = { session: { token: 'tok', userId: USER, impersonatedBy: ADMIN }, user: { id: USER } }
  const proxied = async (session) => {
    mockGetSession.mockResolvedValue(session)
    mockGate.mockResolvedValue(session.user)
    const headers = { cookie: COOKIE, 'content-type': 'application/json', [PLAYBACK_USER_HEADER]: USER }
    const body = { videoId: 'https://files.example.com/x.mp4', playbackTime: 120, kind: 'final', isPaused: true }
    const passed = await proxy(new NextRequest('https://app.example/api/authenticated/sync/updatePlayback', { method: 'POST', headers }))
    if (passed.headers.get('x-middleware-next') !== '1') return passed
    return updatePlayback.POST(new Request('https://app.example/api/authenticated/sync/updatePlayback', { method: 'POST', headers, body: JSON.stringify(body) }))
  }

  it('read-only: the guard refuses the save before the route sees it', async () => {
    const response = await proxied(VIEWED)
    expect(response.status).toBe(403)
    expect((await response.json()).error).toBe('IMPERSONATING')
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('writes on: the page was rendered for the viewed user, whose session it is, so it lands', async () => {
    const response = await proxied({ ...VIEWED, session: { ...VIEWED.session, viewAsWrites: true } })
    expect(response.status).toBe(200)
    expect(mockUpsert).toHaveBeenCalledTimes(1)
    expect(String(mockUpsert.mock.calls[0][0].userId)).toBe(USER)
  })

  it('after Stop: the admin’s cookie is back, the save names the viewed user, and it is refused', async () => {
    const response = await proxied({ session: { token: 'admin-tok', userId: ADMIN }, user: { id: ADMIN, role: 'admin' } })
    expect(response.status).toBe(409)
    expect(mockUpsert).not.toHaveBeenCalled()
  })
})

describe('the browser’s writers', () => {
  it('the worker sends the headers the tracker hands it', async () => {
    const listeners = []
    global.self = { location: { origin: 'https://app.example' }, addEventListener: (_type, fn) => listeners.push(fn), postMessage: jest.fn() }
    global.fetch = jest.fn().mockResolvedValue({ ok: true })
    jest.isolateModules(() => require('@src/components/built-in/updatePlaybackWorker'))
    listeners[0]({ data: { videoURL: 'v', currentTime: 30, headers: playbackWriteHeaders(USER), sessionId: 's1' } })
    const [url, init] = global.fetch.mock.calls[0]
    expect(url).toBe('https://app.example/api/authenticated/sync/updatePlayback')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'X-Playback-User': USER })
    delete global.self
  })
})

// ---------------------------------------------------------------------------
// Guards: every browser playback write names its page's user.

const PLAYBACK_WRITE = /sync\/updatePlayback|sync\/presence\/end|PRESENCE_END_URL|UPDATE_ENDPOINT|sync\/updateValidationStatus/

function clientFiles(dir = path.join(ROOT, 'src')) {
  const found = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (full === path.join(ROOT, 'src', 'app', 'api')) continue
      found.push(...clientFiles(full))
    } else if (/\.(js|jsx|ts|tsx)$/.test(entry.name)) found.push(full)
  }
  return found
}

describe('guards: the browser’s playback writes', () => {
  it('are these, and each names the user its page was rendered for', () => {
    const writers = clientFiles()
      .filter((file) => /fetch\(/.test(fs.readFileSync(file, 'utf8')) && PLAYBACK_WRITE.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(ROOT, file).split(path.sep).join('/'))
      .sort()
    expect(writers).toEqual([
      'src/components/Cast/CastPositionMirror.jsx', // the receiver's position, while casting
      'src/components/MediaPlayer/MediaPlayer.js', // server-side only (no cookie): a dead URL's validation flag
      'src/components/WatchProgress/markWatched.js', // the season page's Mark watched
      'src/components/built-in/WithPlaybackTracker.js', // the final save and presence end, on unload
      'src/components/built-in/updatePlaybackWorker.js', // progress, pause flips and keep-alives
    ])
    for (const file of writers.filter((file) => !file.endsWith('MediaPlayer.js') && !file.endsWith('updatePlaybackWorker.js'))) {
      const source = read(file)
      const calls = source.split('fetch(').slice(1)
      expect([file, calls.length > 0]).toEqual([file, true])
      for (const call of calls) {
        // Each fetch's own options name the page's user
        expect([file, /^[^)]*?\{\s+method: 'POST',(\s+credentials: 'include',)?\s+headers: playbackWriteHeaders\(/.test(call)]).toEqual([file, true])
      }
    }
    // The worker's headers come from the tracker, on every message it posts
    const tracker = read('src', 'components', 'built-in', 'WithPlaybackTracker.js')
    expect(tracker.split('.postMessage({').length - 1).toBe(3)
    expect(tracker.split('headers: playbackWriteHeaders(userId),').length - 1).toBe(3)
    expect(read('src', 'components', 'built-in', 'updatePlaybackWorker.js')).toMatch(/headers: \{ 'Content-Type': 'application\/json', \.\.\.\(headers \|\| \{\}\) \}/)
  })

  it('the MediaPlayer’s validation call runs on the server, so it carries no cookie', () => {
    const source = read('src', 'components', 'MediaPlayer', 'MediaPlayer.js')
    expect(source).not.toMatch(/^['"]use client['"]/m)
    expect(source).toMatch(/async function VideoPlayer\(/)
  })

  it('the user comes from the render: the player’s session, the season page’s viewer, the layout’s session', () => {
    expect(read('src', 'components', 'MediaPlayer', 'MediaPlayer.js')).toMatch(/playbackUserId=\{session\?\.user\?\.id \?\? null\}/)
    expect(read('src', 'components', 'MediaPlayer', 'MainVideoPlayer.jsx')).toMatch(/userId=\{playbackUserId\}/)
    expect(read('src', 'components', 'MediaPages', 'TVEpisodesListComponent.js')).toMatch(/<SeasonEpisodeList [^>]*userId=\{userId\}/)
    expect(read('src', 'components', 'MediaPages', 'SeasonEpisodeList.js')).toMatch(/userId=\{userId\}/)
    expect(read('src', 'components', 'MediaPages', 'details', 'EpisodeActionDialog.js')).toMatch(/markWatched\(episode, \{ userId \}\)/)
    const layout = read('src', 'app', '(styled)', 'layout.js')
    expect(layout).toMatch(/<CastPositionMirror userId=\{session\?\.user\?\.id \?\? null\} \/>/)
    expect(read('src', 'components', 'providers', 'ClientProviders.js')).not.toMatch(/<CastPositionMirror/)
  })

  it('every route a browser playback write goes to checks the user', () => {
    for (const route of ['updatePlayback', path.join('presence', 'end'), 'updateValidationStatus']) {
      const source = read('src', 'app', 'api', 'authenticated', 'sync', route, 'route.js')
      expect([route, /const mismatch = refusePlaybackUserMismatch\(req, authResult\.id, log\)\n\s+if \(mismatch\) return mismatch/.test(source)]).toEqual([route, true])
    }
  })
})
