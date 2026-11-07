/**
 * @jest-environment node
 *
 * Starting and stopping "View as" in the browser: better-auth's admin client
 * swaps the session, then a full-page navigation (never a router push) loads
 * a new document for it, the last user's mirrored positions are dropped, and
 * this browser's other tabs are told so they reload.
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
const stored = new Map()
global.localStorage = {
  get length() {
    return stored.size
  },
  key: (i) => [...stored.keys()][i] ?? null,
  getItem: (key) => stored.get(key) ?? null,
  setItem: (key, value) => stored.set(key, String(value)),
  removeItem: (key) => stored.delete(key),
}

const { startViewAs, stopViewAs, signOutOfViewAs, reloadOnViewAsSwitch } = require('@src/components/ViewAs/viewAsClient')

beforeEach(() => {
  jest.clearAllMocks()
  posted.length = 0
  stored.clear()
  stored.set('mid:movie:1', '{"playbackTime":12}')
  stored.set('https://files.example.com/movies/x/x.mp4', '{"playbackTime":34}')
  stored.set('theme', 'dark')
})

it('start: swaps the session, drops the mirrored positions, tells the other tabs, loads the library', async () => {
  mockImpersonate.mockResolvedValue({ data: { session: {} }, error: null })
  expect(await startViewAs('u1')).toEqual({ ok: true })
  expect(mockImpersonate).toHaveBeenCalledWith({ userId: 'u1' })
  expect([...stored.keys()]).toEqual(['theme'])
  expect(posted).toEqual([['nextjs-stream.view-as', 'switched']])
  expect(assign).toHaveBeenCalledWith('/list')
})

it('stop: back to the Users page as the admin, the same way', async () => {
  mockStop.mockResolvedValue({ data: {}, error: null })
  expect(await stopViewAs()).toEqual({ ok: true })
  expect([...stored.keys()]).toEqual(['theme'])
  expect(posted).toHaveLength(1)
  expect(assign).toHaveBeenCalledWith('/admin/users')
})

it('a refused or failed call changes nothing and says why', async () => {
  mockImpersonate.mockResolvedValue({ data: null, error: { message: 'You cannot impersonate admins', status: 403 } })
  expect(await startViewAs('a2')).toEqual({ ok: false, error: 'You cannot impersonate admins', status: 403 })
  mockStop.mockRejectedValue(new TypeError('Failed to fetch'))
  expect(await stopViewAs()).toEqual({ ok: false, error: 'Failed to fetch', status: null })
  expect(assign).not.toHaveBeenCalled()
  expect(posted).toHaveLength(0)
  expect(stored.size).toBe(3)
})

it('another tab’s start or stop reloads this one, until it unsubscribes', () => {
  const unsubscribe = reloadOnViewAsSwitch()
  anotherTabSwitches()
  expect(reload).toHaveBeenCalledTimes(1)
  unsubscribe()
  anotherTabSwitches()
  expect(reload).toHaveBeenCalledTimes(1)
})

it('signing out ends the view-as session and goes to sign-in', async () => {
  mockSignOut.mockResolvedValue({ data: { success: true }, error: null })
  expect(await signOutOfViewAs()).toEqual({ ok: true })
  expect(assign).toHaveBeenCalledWith('/auth/signin')
})
