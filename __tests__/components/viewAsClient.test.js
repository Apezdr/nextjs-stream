/**
 * @jest-environment node
 *
 * Starting and stopping "View as" in the browser: better-auth's admin client
 * swaps the session, then a full-page navigation (never a router push) loads
 * a new document for it, and this browser's other tabs are told so they
 * reload. A cast in progress ends at every switch, before the session
 * changes.
 *
 * The last user's positions need no clearing: the page holds them in memory
 * only (WatchProgress/playbackStore.js), and they go with the document. The
 * browser's storage is not touched.
 */
const mockImpersonate = jest.fn()
const mockStop = jest.fn()
const mockSignOut = jest.fn()
jest.mock('@src/lib/auth-client', () => ({
  authClient: {
    admin: { impersonateUser: (...args) => mockImpersonate(...args), stopImpersonating: (...args) => mockStop(...args) },
    signOut: (...args) => mockSignOut(...args),
  },
}))
// The Cast SDK: a current session means this tab is casting
let mockCurrentSession = null
const mockEndCastSession = jest.fn()
jest.mock('@components/Cast/castSdk', () => ({
  getContext: () => ({ getCurrentSession: () => mockCurrentSession }),
  endCastSession: (...args) => mockEndCastSession(...args),
}))

const posted = []
const listeners = new Set()
global.BroadcastChannel = class {
  constructor(name) {
    this.name = name
  }
  postMessage(message) {
    posted.push([this.name, message])
  }
  addEventListener(type, listener) {
    if (type === 'message') listeners.add(listener)
  }
  removeEventListener(type, listener) {
    listeners.delete(listener)
  }
}
/** What another tab's post looks like here */
const anotherTabSwitches = () => listeners.forEach((listener) => listener({ data: 'switched' }))
const assign = jest.fn()
const reload = jest.fn()
global.window = { location: { assign, reload } }
// Any use of the browser's storage is counted: there is to be none
const storage = { key: jest.fn(() => null), getItem: jest.fn(() => null), setItem: jest.fn(), removeItem: jest.fn(), clear: jest.fn() }
global.localStorage = { length: 3, ...storage }
const storageCalls = () => Object.values(storage).reduce((calls, fn) => calls + fn.mock.calls.length, 0)

const {
  startViewAs,
  stopViewAs,
  signOutOfViewAs,
  setViewAsWrites,
  reloadOnViewAsSwitch,
  CAST_STOP_GRACE_MS,
} = require('@src/components/ViewAs/viewAsClient')

beforeEach(() => {
  jest.clearAllMocks()
  mockCurrentSession = null
  posted.length = 0
})

it('start: swaps the session, tells the other tabs, loads the library as a new document', async () => {
  mockImpersonate.mockResolvedValue({ data: { session: {} }, error: null })
  expect(await startViewAs('u1')).toEqual({ ok: true })
  expect(mockImpersonate).toHaveBeenCalledWith({ userId: 'u1' })
  expect(posted).toEqual([['nextjs-stream.view-as', 'switched']])
  expect(assign).toHaveBeenCalledWith('/list')
})

it('stop: back to the Users page as the admin, the same way', async () => {
  mockStop.mockResolvedValue({ data: {}, error: null })
  expect(await stopViewAs()).toEqual({ ok: true })
  expect(posted).toHaveLength(1)
  expect(assign).toHaveBeenCalledWith('/admin/users')
})

it('no switch touches the browser’s storage: the positions were in the page’s memory, and go with the document', async () => {
  mockImpersonate.mockResolvedValue({ data: { session: {} }, error: null })
  mockStop.mockResolvedValue({ data: {}, error: null })
  mockSignOut.mockResolvedValue({ data: { success: true }, error: null })
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ viewAsWrites: true }) })

  await startViewAs('u1')
  await stopViewAs()
  await setViewAsWrites(true)
  await signOutOfViewAs()

  expect(storageCalls()).toBe(0)
  // Each one left by a full load, which is what empties the page's memory
  expect(assign.mock.calls.length + reload.mock.calls.length).toBe(4)
})

it('a refused or failed call changes nothing and says why', async () => {
  mockImpersonate.mockResolvedValue({ data: null, error: { message: 'You cannot impersonate admins', status: 403 } })
  expect(await startViewAs('a2')).toEqual({ ok: false, error: 'You cannot impersonate admins', status: 403 })
  mockStop.mockRejectedValue(new TypeError('Failed to fetch'))
  expect(await stopViewAs()).toEqual({ ok: false, error: 'Failed to fetch', status: null })
  expect(assign).not.toHaveBeenCalled()
  expect(posted).toHaveLength(0)
})

it('another tab’s start or stop reloads this one, until it unsubscribes', () => {
  const unsubscribe = reloadOnViewAsSwitch()
  anotherTabSwitches()
  expect(reload).toHaveBeenCalledTimes(1)
  unsubscribe()
  anotherTabSwitches()
  expect(reload).toHaveBeenCalledTimes(1)
})

describe('the writes switch', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ viewAsWrites: true }) })
  })

  it('asks the server, then reloads this tab and tells the others', async () => {
    expect(await setViewAsWrites(true)).toEqual({ ok: true })
    const [url, init] = global.fetch.mock.calls[0]
    expect(url).toBe('/api/authenticated/view-as/writes')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(init.body)).toEqual({ enabled: true })
    expect(reload).toHaveBeenCalledTimes(1)
    expect(posted).toEqual([['nextjs-stream.view-as', 'switched']])
    expect(assign).not.toHaveBeenCalled()
  })

  it('sends only a boolean', async () => {
    await setViewAsWrites('yes')
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ enabled: false })
  })

  it('a refusal changes nothing and says the server’s reason', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'ADMIN_REQUIRED', message: 'The admin viewing as this user is no longer an admin.' }),
    })
    expect(await setViewAsWrites(true)).toEqual({
      ok: false,
      error: 'The admin viewing as this user is no longer an admin.',
      status: 403,
    })
    global.fetch.mockRejectedValue(new TypeError('Failed to fetch'))
    expect(await setViewAsWrites(false)).toEqual({ ok: false, error: 'Failed to fetch', status: null })
    expect(reload).not.toHaveBeenCalled()
    expect(posted).toHaveLength(0)
  })
})

it('signing out ends the view-as session and goes to sign-in', async () => {
  mockSignOut.mockResolvedValue({ data: { success: true }, error: null })
  expect(await signOutOfViewAs()).toEqual({ ok: true })
  expect(assign).toHaveBeenCalledWith('/auth/signin')
})

describe('a cast in progress', () => {
  beforeEach(() => {
    mockCurrentSession = { sessionId: 'cast-1' }
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    mockImpersonate.mockResolvedValue({ data: { session: {} }, error: null })
    mockStop.mockResolvedValue({ data: {}, error: null })
    mockSignOut.mockResolvedValue({ data: { success: true }, error: null })
  })

  it('ends before the session changes: start, stop, the writes switch and signing out', async () => {
    const calls = [
      [() => startViewAs('u1'), mockImpersonate],
      [() => stopViewAs(), mockStop],
      [() => setViewAsWrites(true), global.fetch],
      [() => signOutOfViewAs(), mockSignOut],
    ]
    for (const [run, server] of calls) {
      mockEndCastSession.mockClear()
      await run()
      expect(mockEndCastSession).toHaveBeenCalledTimes(1)
      // The cast ends first, while the session is still the one it was started under
      expect(mockEndCastSession.mock.invocationCallOrder[0]).toBeLessThan(server.mock.invocationCallOrder.at(-1))
    }
  })

  it('a tab that isn’t casting ends nothing', async () => {
    mockCurrentSession = null
    await startViewAs('u1')
    expect(mockEndCastSession).not.toHaveBeenCalled()
  })

  it('another tab’s switch ends this tab’s cast, then reloads once the stop has had time to reach the receiver', () => {
    jest.useFakeTimers()
    try {
      const unsubscribe = reloadOnViewAsSwitch()
      anotherTabSwitches()
      expect(mockEndCastSession).toHaveBeenCalledTimes(1)
      expect(reload).not.toHaveBeenCalled()
      jest.advanceTimersByTime(CAST_STOP_GRACE_MS)
      expect(reload).toHaveBeenCalledTimes(1)
      unsubscribe()
    } finally {
      jest.useRealTimers()
    }
  })
})
