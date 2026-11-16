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

describe('a session a tab of this browser ended', () => {
  // The player's tab: its end and the next page's poll leave together
  const WEB = { id: 'row-web', sessionId: 'web-session', state: 'playing', mediaId: 'mid:film', position: 1200 }
  const TV = { id: 'row-tv', sessionId: 'tv-session', state: 'playing', mediaId: 'mid:film', position: 600 }
  const listing = (...sessions) => async () => answer({ sessions, asOf: new Date(clock).toISOString() })

  it('is left out of an answer that got in before its end did, and the other sessions stay', async () => {
    fetchImpl.mockImplementation(listing(WEB, TV))
    store.ended('web-session')

    const listener = jest.fn()
    store.subscribe(listener)
    await settle()

    expect(store.getSnapshot().sessions).toEqual([TV])
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('is nothing live when it was the only session listed, and no surface is told anything', async () => {
    fetchImpl.mockImplementation(listing(WEB))
    store.ended('web-session')

    const listener = jest.fn()
    store.subscribe(listener)
    await settle()

    expect(store.getSnapshot()).toBe(NOTHING)
    expect(listener).not.toHaveBeenCalled()
  })

  it('leaves the answer held at once, and the observer hears it', async () => {
    fetchImpl.mockImplementation(listing(WEB, TV))
    const listener = jest.fn()
    const observer = jest.fn()
    store.observe(observer)
    store.subscribe(listener)
    await settle()
    expect(store.getSnapshot().sessions).toEqual([WEB, TV])
    listener.mockClear()

    store.ended('web-session')

    expect(store.getSnapshot().sessions).toEqual([TV])
    expect(listener).toHaveBeenCalledTimes(1)
    expect(observer).toHaveBeenLastCalledWith({ sessions: [TV], offsetMs: 0 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('is not brought back by an answer that was already on its way', async () => {
    let respond
    fetchImpl.mockImplementation(() => new Promise((resolve) => (respond = resolve)))
    store.subscribe(() => {})
    clock += 200
    store.ended('web-session')

    respond(answer({ sessions: [WEB], asOf: new Date(clock).toISOString() }))
    await settle()

    expect(store.getSnapshot()).toBe(NOTHING)
  })

  it('is listed again by an answer asked for a poll later: the end never reached the server', async () => {
    fetchImpl.mockImplementation(listing(WEB))
    store.subscribe(() => {})
    await settle()
    await tick(2_000)
    store.ended('web-session')
    expect(store.getSnapshot()).toBe(NOTHING)

    // 13 s after the end: still the end's word against the answer's
    await tick(POLL_MS - 2_000)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(store.getSnapshot()).toBe(NOTHING)

    // 28 s after: the row is still there, so its own expiry decides
    await tick(POLL_MS)
    expect(store.getSnapshot().sessions).toEqual([WEB])
  })

  it('says nothing about a session with no id', async () => {
    fetchImpl.mockImplementation(listing(WEB))
    store.subscribe(() => {})
    await settle()

    store.ended(null)
    store.ended('')
    store.ended(undefined)

    expect(store.getSnapshot().sessions).toEqual([WEB])
  })
})

describe('an observer (a reader that must not cause a poll)', () => {
  it('starts no poll and keeps none going', async () => {
    const observer = jest.fn()
    store.observe(observer)
    await tick(POLL_MS * 3)

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(doc.listenerCount()).toBe(0)
    expect(observer).not.toHaveBeenCalled()
  })

  it('hears each answer while a surface is polling, and nothing live once the last surface is gone', async () => {
    const observer = jest.fn()
    store.observe(observer)
    const off = store.subscribe(() => {})
    await settle()
    expect(observer).toHaveBeenLastCalledWith({ sessions: [SESSION], offsetMs: 300_000 })

    off()
    // The store keeps its answer for a quick return; the observer is told what is known now: nothing
    expect(observer).toHaveBeenLastCalledWith(NOTHING)
    expect(store.getSnapshot().sessions).toHaveLength(1)
  })

  it('one that starts observing while a surface is polling is told the answer held, and causes no request', async () => {
    store.subscribe(() => {})
    await settle()
    const observer = jest.fn()

    store.observe(observer)

    expect(observer).toHaveBeenCalledTimes(1)
    expect(observer).toHaveBeenLastCalledWith({ sessions: [SESSION], offsetMs: 300_000 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('hears the kept answer again when a surface returns inside a poll, with no request made', async () => {
    const observer = jest.fn()
    store.observe(observer)
    store.subscribe(() => {})()
    await settle()
    observer.mockClear()

    clock += 2_000
    store.subscribe(() => {})
    expect(observer).toHaveBeenCalledTimes(1)
    expect(observer).toHaveBeenLastCalledWith({ sessions: [SESSION], offsetMs: 300_000 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('hears nothing live after a failed poll, and stops hearing once it unsubscribes', async () => {
    const observer = jest.fn()
    const stop = store.observe(observer)
    store.subscribe(() => {})
    await settle()

    fetchImpl.mockImplementation(async () => answer({ error: 'Failed to read live sessions' }, 500))
    await tick(POLL_MS)
    expect(observer).toHaveBeenLastCalledWith(NOTHING)

    stop()
    observer.mockClear()
    fetchImpl.mockImplementation(async () => answer({ sessions: [SESSION], asOf: new Date(clock).toISOString() }))
    await tick(POLL_MS)
    expect(observer).not.toHaveBeenCalled()
  })
})
