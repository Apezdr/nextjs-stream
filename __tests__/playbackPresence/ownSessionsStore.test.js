/**
 * The web's one store of the viewer's own live sessions
 * (components/WatchingNow/ownSessions.js): one poll per page however many
 * surfaces read it, none while nothing reads it or the tab is hidden, and a
 * failed poll reads as nothing live.
 */
import { createOwnSessionsStore, NOTHING } from '@components/WatchingNow/ownSessions'

const POLL_MS = 15_000
const SESSION = { id: 'row-1', state: 'playing', mediaId: 'mid:film', position: 600 }

function answer(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

function fakeDocument() {
  const listeners = new Set()
  return {
    visibilityState: 'visible',
    addEventListener: (type, fn) => type === 'visibilitychange' && listeners.add(fn),
    removeEventListener: (type, fn) => listeners.delete(fn),
    listenerCount: () => listeners.size,
    setVisible(visible) {
      this.visibilityState = visible ? 'visible' : 'hidden'
      for (const fn of listeners) fn()
    },
  }
}

let clock
let doc
let fetchImpl
let store

function setup() {
  clock = Date.parse('2026-11-09T20:00:00.000Z')
  doc = fakeDocument()
  fetchImpl = jest.fn(async () => answer({ sessions: [SESSION], asOf: new Date(clock + 300_000).toISOString() }))
  store = createOwnSessionsStore({ fetchImpl, getDocument: () => doc, now: () => clock, pollMs: POLL_MS })
}

async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

async function tick(ms) {
  clock += ms
  jest.advanceTimersByTime(ms)
  await settle()
}

beforeEach(() => {
  jest.useFakeTimers()
  setup()
})

afterEach(() => {
  jest.useRealTimers()
})

it('asks once for every surface on the page, and again every 15 s', async () => {
  const unsubscribers = Array.from({ length: 40 }, () => store.subscribe(() => {}))
  await settle()
  expect(fetchImpl).toHaveBeenCalledTimes(1)
  expect(fetchImpl.mock.calls[0][0]).toBe('/api/authenticated/presence')
  expect(store.getSnapshot()).toEqual({ sessions: [SESSION], offsetMs: 300_000 })

  await tick(POLL_MS)
  expect(fetchImpl).toHaveBeenCalledTimes(2)
  unsubscribers.forEach((off) => off())
})

it('keeps the same answer object while nothing changes, so nothing re-renders', async () => {
  const listener = jest.fn()
  const off = store.subscribe(listener)
  await settle()
  const first = store.getSnapshot()
  await tick(POLL_MS)
  expect(store.getSnapshot()).toBe(first)
  expect(listener).toHaveBeenCalledTimes(1)
  off()
})

it('asks nothing once the last surface is gone', async () => {
  const off = store.subscribe(() => {})
  await settle()
  off()
  await tick(POLL_MS * 3)
  expect(fetchImpl).toHaveBeenCalledTimes(1)
  expect(doc.listenerCount()).toBe(0)
})

it('asks nothing while the tab is hidden, and again on coming back', async () => {
  const off = store.subscribe(() => {})
  await settle()
  doc.setVisible(false)
  await tick(POLL_MS * 4)
  expect(fetchImpl).toHaveBeenCalledTimes(1)

  doc.setVisible(true)
  await settle()
  expect(fetchImpl).toHaveBeenCalledTimes(2)
  await tick(POLL_MS)
  expect(fetchImpl).toHaveBeenCalledTimes(3)
  off()
})

it('a failed poll reads as nothing live, never as the last answer', async () => {
  const off = store.subscribe(() => {})
  await settle()
  expect(store.getSnapshot().sessions).toHaveLength(1)

  fetchImpl.mockImplementation(async () => answer({ error: 'Failed to read live sessions' }, 500))
  await tick(POLL_MS)
  expect(store.getSnapshot()).toBe(NOTHING)

  // and it keeps asking
  fetchImpl.mockImplementation(async () => answer({ sessions: [SESSION], asOf: new Date(clock).toISOString() }))
  await tick(POLL_MS)
  expect(store.getSnapshot().sessions).toHaveLength(1)
  off()
})

it('a refusal stops the polling', async () => {
  fetchImpl.mockImplementation(async () => answer({ error: 'Unauthorized' }, 401))
  const off = store.subscribe(() => {})
  await settle()
  await tick(POLL_MS * 4)
  expect(fetchImpl).toHaveBeenCalledTimes(1)
  expect(store.getSnapshot()).toBe(NOTHING)
  off()
})

it('drops an answer older than one poll when a surface mounts after a gap', async () => {
  const off = store.subscribe(() => {})
  await settle()
  off()

  // A client navigation to another page a minute later
  clock += 60_000
  fetchImpl.mockImplementation(() => new Promise(() => {}))
  store.subscribe(() => {})
  expect(store.getSnapshot()).toBe(NOTHING)
})

it('keeps a fresh answer across a quick navigation, and does not ask again for it', async () => {
  const off = store.subscribe(() => {})
  await settle()
  off()
  clock += 2_000
  store.subscribe(() => {})
  expect(store.getSnapshot().sessions).toHaveLength(1)
  expect(fetchImpl).toHaveBeenCalledTimes(1)
})
