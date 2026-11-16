/**
 * The page's one store of the viewer's positions
 * (components/WatchProgress/playbackStore.js): filled by one request, asked
 * again on events and never on a timer, told by the browser's other tabs what
 * they are playing, and emptied for good the moment the session is not its
 * user's. A read that failed or was refused is never "no progress".
 */
import {
  createPlaybackStore,
  PENDING,
  PLAYBACK_CHANNEL,
  POSITION_EVERY_MS,
  RETURN_STALE_MS,
  SUBSCRIBE_STALE_MS,
} from '@components/WatchProgress/playbackStore'

const USER = 'user-1'
const OTHER = 'user-2'
const FILM = { mediaId: 'mid:film', normalizedVideoId: 'nid-film' }
const SHORT = { mediaId: 'mid:short', normalizedVideoId: 'nid-short' }
// A row never stamped with a durable id is found by its file's hash
const UNSTAMPED = { mediaId: null, normalizedVideoId: 'nid-unstamped' }

const T0 = Date.parse('2026-11-16T20:00:00.000Z')
const iso = (ms) => new Date(ms).toISOString()

const filmRow = (overrides = {}) => ({ ...FILM, playbackTime: 600, lastUpdated: iso(T0), ...overrides })
const snapshot = (rows, userId = USER) => ({ userId, asOf: iso(T0 + 1000), rows })
const ok = (data) => ({ response: { status: 200, ok: true }, data })
const status = (code) => ({ response: { status: code, ok: false }, data: undefined })

function fakeDocument() {
  const listeners = new Set()
  return {
    visibilityState: 'visible',
    addEventListener: (type, fn) => type === 'visibilitychange' && listeners.add(fn),
    removeEventListener: (type, fn) => listeners.delete(fn),
    listenerCount: () => listeners.size,
    setVisible(visible) {
      this.visibilityState = visible ? 'visible' : 'hidden'
      for (const fn of [...listeners]) fn()
    },
  }
}

function fakeWindow() {
  const listeners = new Map()
  return {
    addEventListener: (type, fn) => listeners.set(type, new Set([...(listeners.get(type) ?? []), fn])),
    removeEventListener: (type, fn) => listeners.get(type)?.delete(fn),
    listenerCount: () => [...listeners.values()].reduce((count, set) => count + set.size, 0),
    fire(type, event = {}) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn(event)
    },
  }
}

/** What BroadcastChannel does: every other channel object of the name hears a post. */
function fakeBus() {
  const channels = new Set()
  const posted = []
  return {
    posted,
    channels,
    create(name) {
      const listeners = new Set()
      const channel = {
        name,
        closed: false,
        postMessage(message) {
          if (channel.closed) throw new Error('closed')
          posted.push(message)
          for (const other of channels) if (other !== channel && !other.closed) other.deliver(JSON.parse(JSON.stringify(message)))
        },
        addEventListener: (type, fn) => type === 'message' && listeners.add(fn),
        deliver: (data) => listeners.forEach((fn) => fn({ data })),
        close() {
          channel.closed = true
          channels.delete(channel)
        },
      }
      channels.add(channel)
      return channel
    },
  }
}

function fakePresence() {
  const observers = new Set()
  return {
    observe: jest.fn((observer) => observers.add(observer)),
    tell: (sessions, offsetMs = 0) => observers.forEach((observer) => observer({ sessions, offsetMs })),
  }
}

let clock
let bus

/** One tab of the browser: its own document, window, requests and store, on the shared bus. */
function tab(tabId = 'tab-a', { channel = true, presence = null } = {}) {
  const doc = fakeDocument()
  const win = fakeWindow()
  const conditionalFetch = jest.fn(async () => ok(snapshot([filmRow()])))
  const fetchImpl = jest.fn(async () => ({ status: 200, ok: true, json: async () => ({ found: false, asOf: iso(clock) }) }))
  const store = createPlaybackStore({
    conditionalFetch,
    fetchImpl,
    getDocument: () => doc,
    getWindow: () => win,
    createChannel: channel ? (name) => bus.create(name) : () => null,
    presence,
    now: () => clock,
    tabId,
  })
  return { store, doc, win, conditionalFetch, fetchImpl }
}

async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

/** A surface mounted over the store, as useSyncExternalStore mounts one. */
function surface(store) {
  const listener = jest.fn()
  const off = store.subscribe(listener)
  return { listener, off }
}

const read = (store, title = FILM) => store.getTitle(title.mediaId, title.normalizedVideoId)
const position = (store, title = FILM) => read(store, title).entry?.playbackTime ?? null

beforeEach(() => {
  clock = T0 + 60_000
  bus = fakeBus()
})

describe('the user', () => {
  it('a document rendered for nobody stays idle: no request, no channel, nothing known', async () => {
    const { store, conditionalFetch } = tab()
    surface(store)
    store.identify(null)
    store.identify('')
    await settle()

    expect(conditionalFetch).not.toHaveBeenCalled()
    expect(bus.channels.size).toBe(0)
    expect(store.getState()).toEqual({ userId: null, status: 'idle', asOf: null, refusal: null })
    expect(read(store)).toBe(PENDING)
  })

  it('is fixed by the first page part that names one, and every request names them', async () => {
    const { store, conditionalFetch } = tab()
    surface(store)
    expect(store.identify(USER)).toBe(true)
    await settle()

    expect(conditionalFetch).toHaveBeenCalledTimes(1)
    const [url, init] = conditionalFetch.mock.calls[0]
    expect(url).toBe('/api/authenticated/sync/positions')
    expect(init.headers).toEqual({ Accept: 'application/json', 'X-Playback-User': USER })
    expect(store.getState()).toEqual({ userId: USER, status: 'ready', asOf: iso(T0 + 1000), refusal: null })
    // Naming them again changes nothing
    expect(store.identify(USER)).toBe(true)
    expect(conditionalFetch).toHaveBeenCalledTimes(1)
  })

  it('a page part rendered for another user means the account changed: the store empties and asks nothing more', async () => {
    const { store, conditionalFetch } = tab()
    store.identify(USER)
    const { listener } = surface(store)
    await settle()
    expect(position(store)).toBe(600)

    expect(store.identify(OTHER)).toBe(false)

    expect(store.getState()).toMatchObject({ userId: USER, status: 'refused', refusal: 409 })
    expect(read(store)).toEqual({ answer: 'unknown', entry: null, refusal: 409 })
    expect(listener).toHaveBeenCalled()
    clock += SUBSCRIBE_STALE_MS * 2
    surface(store)
    await settle()
    expect(conditionalFetch).toHaveBeenCalledTimes(1)
  })
})

describe('trigger 1: a surface subscribes', () => {
  it('asks once however many surfaces mount, and files each row under its durable id and its hash', async () => {
    const { store, conditionalFetch } = tab()
    conditionalFetch.mockResolvedValue(ok(snapshot([filmRow(), { ...UNSTAMPED, playbackTime: 90, lastUpdated: iso(T0 - 5000) }])))
    store.identify(USER)
    Array.from({ length: 40 }, () => surface(store))
    await settle()

    expect(conditionalFetch).toHaveBeenCalledTimes(1)
    expect(read(store)).toEqual({
      answer: 'found',
      entry: { source: 'row', ...FILM, playbackTime: 600, lastUpdated: iso(T0), at: T0 },
      refusal: null,
    })
    // By either key alone
    expect(position(store, { mediaId: 'mid:film', normalizedVideoId: null })).toBe(600)
    expect(position(store, { mediaId: null, normalizedVideoId: 'nid-film' })).toBe(600)
    // A surface that knows the title's durable id finds a row that was never stamped with one
    expect(position(store, { mediaId: 'mid:another-id', normalizedVideoId: 'nid-unstamped' })).toBe(90)
    // A document id is no identity
    expect(read(store, { mediaId: '64b7f0c2a1b2c3d4e5f60799', normalizedVideoId: null })).toBe(PENDING)
  })

  it('a title the snapshot does not hold is pending, not "none": the snapshot is the recent rows only', async () => {
    const { store } = tab()
    store.identify(USER)
    surface(store)
    await settle()

    expect(read(store, SHORT)).toBe(PENDING)
  })

  it('asks again only when the snapshot is 30 s old: a navigation inside that costs nothing', async () => {
    const { store, conditionalFetch } = tab()
    store.identify(USER)
    const first = surface(store)
    await settle()
    first.off()

    clock += SUBSCRIBE_STALE_MS - 1
    surface(store).off()
    await settle()
    expect(conditionalFetch).toHaveBeenCalledTimes(1)

    clock += 1
    surface(store)
    surface(store)
    await settle()
    expect(conditionalFetch).toHaveBeenCalledTimes(2)
  })

  it('asks when the user is named after the surfaces mounted', async () => {
    const { store, conditionalFetch } = tab()
    surface(store)
    await settle()
    expect(conditionalFetch).not.toHaveBeenCalled()

    store.identify(USER)
    await settle()
    expect(conditionalFetch).toHaveBeenCalledTimes(1)
    expect(position(store)).toBe(600)
  })

  it('runs no timer: an hour with a surface mounted and nothing happening is one request', async () => {
    jest.useFakeTimers()
    try {
      const { store, conditionalFetch } = tab()
      store.identify(USER)
      surface(store)
      await settle()
      clock += 3_600_000
      jest.advanceTimersByTime(3_600_000)
      await settle()
      expect(conditionalFetch).toHaveBeenCalledTimes(1)
      expect(jest.getTimerCount()).toBe(0)
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('trigger 2: the tab comes back', () => {
  it.each([
    ['becomes visible', ({ doc }) => doc.setVisible(true)],
    ['gains focus', ({ win }) => win.fire('focus')],
    ['comes back online', ({ win }) => win.fire('online')],
    ['is restored from the back/forward cache', ({ win }) => win.fire('pageshow', { persisted: true })],
  ])('asks when it %s and the snapshot is 5 s old, not before', async (_name, comeBack) => {
    const page = tab()
    page.store.identify(USER)
    surface(page.store)
    await settle()

    clock += RETURN_STALE_MS - 1
    comeBack(page)
    await settle()
    expect(page.conditionalFetch).toHaveBeenCalledTimes(1)

    clock += 1
    comeBack(page)
    await settle()
    expect(page.conditionalFetch).toHaveBeenCalledTimes(2)
  })

  it('an ordinary page show is no return', async () => {
    const { store, win, conditionalFetch } = tab()
    store.identify(USER)
    surface(store)
    await settle()
    clock += RETURN_STALE_MS * 2

    win.fire('pageshow', { persisted: false })
    await settle()
    expect(conditionalFetch).toHaveBeenCalledTimes(1)
  })

  it('a hidden tab asks nothing, and catches up the moment it is shown', async () => {
    const { store, doc, win, conditionalFetch } = tab()
    doc.visibilityState = 'hidden'
    store.identify(USER)
    surface(store)
    await settle()
    expect(conditionalFetch).not.toHaveBeenCalled()

    win.fire('focus')
    win.fire('online')
    await settle()
    expect(conditionalFetch).not.toHaveBeenCalled()

    doc.setVisible(true)
    await settle()
    expect(conditionalFetch).toHaveBeenCalledTimes(1)
    expect(position(store)).toBe(600)
  })

  it('listens only while a surface is mounted', async () => {
    const { store, doc, win } = tab()
    store.identify(USER)
    const one = surface(store)
    const two = surface(store)
    expect(doc.listenerCount()).toBe(1)
    expect(win.listenerCount()).toBe(3)

    one.off()
    expect(doc.listenerCount()).toBe(1)
    two.off()
    expect(doc.listenerCount()).toBe(0)
    expect(win.listenerCount()).toBe(0)
  })
})

describe('what a surface reads', () => {
  it('is the same object while nothing about its title changes, so nothing renders again', async () => {
    const { store, conditionalFetch } = tab()
    const data = snapshot([filmRow(), { ...SHORT, playbackTime: 30, lastUpdated: iso(T0) }])
    conditionalFetch.mockResolvedValue(ok(data))
    store.identify(USER)
    const { listener } = surface(store)
    await settle()
    const film = read(store)
    const short = read(store, SHORT)
    expect(listener).toHaveBeenCalledTimes(1)

    // A 304 hands back the copy kept; a 200 with the same rows is new objects
    clock += SUBSCRIBE_STALE_MS
    conditionalFetch.mockResolvedValue({ response: { status: 304, ok: false }, data })
    await store.refresh()
    conditionalFetch.mockResolvedValue(ok(JSON.parse(JSON.stringify(data))))
    await store.refresh()
    expect(read(store)).toBe(film)
    expect(listener).toHaveBeenCalledTimes(1)

    // One row moves: its title's object is new, the other's is not
    conditionalFetch.mockResolvedValue(ok(snapshot([filmRow({ playbackTime: 700, lastUpdated: iso(T0 + 9000) }), { ...SHORT, playbackTime: 30, lastUpdated: iso(T0) }])))
    await store.refresh()
    expect(position(store)).toBe(700)
    expect(read(store, SHORT)).toBe(short)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('a row that left the snapshot is gone from the store', async () => {
    const { store, conditionalFetch } = tab()
    store.identify(USER)
    surface(store)
    await settle()

    conditionalFetch.mockResolvedValue(ok(snapshot([])))
    await store.refresh()
    expect(read(store)).toBe(PENDING)
  })
})

describe('a read that fails', () => {
  it('with no snapshot held the store says failed, and a title stays pending: never "no progress"', async () => {
    const { store, conditionalFetch } = tab()
    conditionalFetch.mockResolvedValue(status(500))
    store.identify(USER)
    surface(store)
    await settle()

    expect(store.getState()).toMatchObject({ status: 'failed', refusal: null })
    expect(read(store)).toBe(PENDING)

    // The next surface to mount asks again
    conditionalFetch.mockResolvedValue(ok(snapshot([filmRow()])))
    surface(store)
    await settle()
    expect(store.getState().status).toBe('ready')
    expect(position(store)).toBe(600)
  })

  it('a thrown request is a failure too', async () => {
    const { store, conditionalFetch } = tab()
    conditionalFetch.mockRejectedValue(new TypeError('Failed to fetch'))
    store.identify(USER)
    surface(store)
    await settle()
    expect(store.getState().status).toBe('failed')
  })

  it('the rows held stay when a later request fails, and it is asked again on the next return', async () => {
    const { store, win, conditionalFetch } = tab()
    store.identify(USER)
    surface(store)
    await settle()

    conditionalFetch.mockResolvedValue(status(503))
    clock += RETURN_STALE_MS
    win.fire('focus')
    await settle()
    expect(store.getState().status).toBe('ready')
    expect(position(store)).toBe(600)

    conditionalFetch.mockResolvedValue(ok(snapshot([filmRow({ playbackTime: 900, lastUpdated: iso(T0 + 5000) })])))
    clock += RETURN_STALE_MS
    win.fire('focus')
    await settle()
    expect(position(store)).toBe(900)
  })
})

describe('a refusal', () => {
  it.each([401, 403, 409])('%i empties the store for good and tells every surface', async (code) => {
    const { store, win, conditionalFetch, fetchImpl } = tab()
    store.identify(USER)
    const { listener } = surface(store)
    await settle()
    store.reportPosition({ userId: USER, ...SHORT, playbackTime: 50 })
    expect(position(store, SHORT)).toBe(50)
    const [channel] = [...bus.channels]

    conditionalFetch.mockResolvedValue(status(code))
    clock += RETURN_STALE_MS
    win.fire('focus')
    await settle()

    expect(store.getState()).toMatchObject({ status: 'refused', refusal: code })
    for (const title of [FILM, SHORT]) expect(read(store, title)).toEqual({ answer: 'unknown', entry: null, refusal: code })
    expect(listener).toHaveBeenCalled()
    expect(channel.closed).toBe(true)

    // Nothing is asked, held or said from then on
    const requests = conditionalFetch.mock.calls.length
    clock += SUBSCRIBE_STALE_MS
    surface(store)
    win.fire('focus')
    store.want({ ...SHORT, videoURL: 'https://files.example/short.mp4' })
    store.reportPosition({ userId: USER, ...FILM, playbackTime: 700 })
    store.seed({ userId: USER, title: FILM, entry: { found: true, ...FILM, playbackTime: 700, lastUpdated: iso(clock), asOf: iso(clock) } })
    await settle()
    expect(conditionalFetch).toHaveBeenCalledTimes(requests)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(read(store).refusal).toBe(code)
  })

  it('a snapshot that names another user is refused by the page: the rows are never held', async () => {
    const { store, conditionalFetch } = tab()
    conditionalFetch.mockResolvedValue(ok(snapshot([filmRow()], OTHER)))
    store.identify(USER)
    surface(store)
    await settle()

    expect(store.getState()).toMatchObject({ status: 'refused', refusal: 409 })
    expect(read(store).entry).toBeNull()
  })
})

describe('a title outside the snapshot (want)', () => {
  const WANTED = { ...SHORT, videoURL: 'https://files.example/shorts/short.mp4' }
  const answer = (body) => ({ status: 200, ok: true, json: async () => body })

  it('is asked for by itself, once, after the snapshot, by its id and its URL, naming the user', async () => {
    const { store, fetchImpl } = tab()
    fetchImpl.mockResolvedValue(answer({ found: true, ...SHORT, playbackTime: 45, lastUpdated: iso(T0 - 90 * 86_400_000), asOf: iso(clock) }))
    store.identify(USER)
    surface(store)
    store.want(WANTED)
    // Not before the snapshot: most titles are in it
    expect(fetchImpl).not.toHaveBeenCalled()
    await settle()

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(`/api/authenticated/sync/playback?mediaId=${encodeURIComponent('mid:short')}&videoId=${encodeURIComponent(WANTED.videoURL)}`)
    expect(init.headers).toEqual({ Accept: 'application/json', 'X-Playback-User': USER })
    expect(init.cache).toBe('no-store')
    expect(position(store, SHORT)).toBe(45)

    // Kept: asking again costs nothing, and a refresh does not lose it
    store.want(WANTED)
    await store.refresh()
    await settle()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(position(store, SHORT)).toBe(45)
  })

  it('"no row" is an answer: the title reads none, and is not asked again', async () => {
    const { store, fetchImpl } = tab()
    store.identify(USER)
    surface(store)
    store.want(WANTED)
    await settle()

    expect(read(store, SHORT)).toEqual({ answer: 'none', entry: null, refusal: null })
    store.want(WANTED)
    await settle()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('a title the snapshot holds is never asked for', async () => {
    const { store, fetchImpl } = tab()
    store.identify(USER)
    surface(store)
    store.want({ ...FILM, videoURL: 'https://files.example/film.mp4' })
    await settle()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('the row is filed under the keys the server found it by, and the ones the page asked with', async () => {
    const { store, fetchImpl } = tab()
    // Found under the file the title had before a quality swap
    fetchImpl.mockResolvedValue(answer({ found: true, mediaId: null, normalizedVideoId: 'nid-old-file', playbackTime: 45, lastUpdated: iso(T0), asOf: iso(clock) }))
    store.identify(USER)
    surface(store)
    store.want(WANTED)
    await settle()

    expect(position(store, SHORT)).toBe(45)
    expect(position(store, { mediaId: null, normalizedVideoId: 'nid-old-file' })).toBe(45)
  })

  it('a failed read is "unknown", never "none", and is asked again after a later snapshot', async () => {
    const { store, win, fetchImpl } = tab()
    fetchImpl.mockResolvedValue({ status: 500, ok: false, json: async () => ({}) })
    store.identify(USER)
    surface(store)
    store.want(WANTED)
    await settle()
    expect(read(store, SHORT)).toEqual({ answer: 'unknown', entry: null, refusal: null })
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    // Not on a loop
    store.want(WANTED)
    await settle()
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    fetchImpl.mockResolvedValue(answer({ found: true, ...SHORT, playbackTime: 45, lastUpdated: iso(T0), asOf: iso(clock) }))
    clock += RETURN_STALE_MS
    win.fire('focus')
    await settle()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(position(store, SHORT)).toBe(45)
  })

  it('is still asked when the snapshot failed, and a refusal of it empties the store', async () => {
    const { store, conditionalFetch, fetchImpl } = tab()
    conditionalFetch.mockResolvedValue(status(500))
    fetchImpl.mockResolvedValue({ status: 409, ok: false, json: async () => ({ error: 'USER_MISMATCH' }) })
    store.identify(USER)
    surface(store)
    store.want(WANTED)
    await settle()

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(store.getState()).toMatchObject({ status: 'refused', refusal: 409 })
  })

  it('a title with nothing to ask by is left alone', async () => {
    const { store, fetchImpl } = tab()
    store.identify(USER)
    surface(store)
    store.want({ mediaId: null, normalizedVideoId: null, videoURL: 'https://files.example/x.mp4' })
    store.want({ mediaId: null, normalizedVideoId: 'nid-only', videoURL: null })
    await settle()
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('the answer a page was rendered with (seed)', () => {
  const seeded = (playbackTime, at, asOf = at) => ({ found: true, ...SHORT, playbackTime, lastUpdated: iso(at), asOf: iso(asOf) })

  it('is known before any request answers, fixes the user, and saves the title its own request', async () => {
    const { store, conditionalFetch, fetchImpl } = tab()
    conditionalFetch.mockReturnValue(new Promise(() => {}))
    surface(store)
    store.seed({ userId: USER, title: SHORT, entry: seeded(45, T0) })

    expect(store.getState().userId).toBe(USER)
    expect(position(store, SHORT)).toBe(45)
    store.want({ ...SHORT, videoURL: 'https://files.example/short.mp4' })
    await settle()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('"no row" is seeded too', () => {
    const { store } = tab()
    store.seed({ userId: USER, title: SHORT, entry: { found: false, asOf: iso(T0) } })
    expect(read(store, SHORT).answer).toBe('none')
  })

  it('an older seed (a page the router replayed) never replaces a newer answer', () => {
    const { store } = tab()
    store.seed({ userId: USER, title: SHORT, entry: seeded(300, T0 + 20_000) })
    store.seed({ userId: USER, title: SHORT, entry: seeded(45, T0) })
    expect(position(store, SHORT)).toBe(300)
    store.seed({ userId: USER, title: SHORT, entry: { found: false, asOf: iso(T0 + 10_000) } })
    expect(position(store, SHORT)).toBe(300)
  })

  it('the snapshot’s row wins when it is the newer write, and a seed of "no row" yields to a row written since', async () => {
    const { store, conditionalFetch } = tab()
    store.seed({ userId: USER, title: FILM, entry: { found: true, ...FILM, playbackTime: 100, lastUpdated: iso(T0 - 60_000), asOf: iso(T0 - 1000) } })
    store.seed({ userId: USER, title: SHORT, entry: { found: false, asOf: iso(T0 - 1000) } })
    conditionalFetch.mockResolvedValue(ok(snapshot([filmRow(), { ...SHORT, playbackTime: 12, lastUpdated: iso(T0) }])))
    surface(store)
    await settle()

    expect(position(store)).toBe(600)
    expect(position(store, SHORT)).toBe(12)
  })

  it('a seed for another user’s page is the account changing', () => {
    const { store } = tab()
    store.identify(USER)
    store.seed({ userId: OTHER, title: SHORT, entry: seeded(45, T0) })
    expect(store.getState()).toMatchObject({ status: 'refused', refusal: 409 })
  })
})

describe('live: what a tab of this browser is playing', () => {
  const report = (store, playbackTime, extra = {}) => store.reportPosition({ userId: USER, ...FILM, playbackTime, ...extra })
  const positionsPosted = () => bus.posted.filter((message) => message.type === 'position')

  it('wins over the row at once, in the playing tab and in the others', async () => {
    const playing = tab('tab-playing')
    const other = tab('tab-other')
    for (const { store } of [playing, other]) {
      store.identify(USER)
      surface(store)
    }
    await settle()
    const heard = surface(other.store).listener

    report(playing.store, 1200)

    expect(read(playing.store)).toEqual({ answer: 'found', entry: { source: 'live', playbackTime: 1200, paused: false, ended: false }, refusal: null })
    expect(read(other.store).entry).toEqual({ source: 'live', playbackTime: 1200, paused: false, ended: false })
    expect(heard).toHaveBeenCalledTimes(1)
    expect(bus.posted).toEqual([
      { v: 1, userId: USER, tabId: 'tab-playing', type: 'position', mediaId: 'mid:film', nid: 'nid-film', playbackTime: 1200, paused: false, sessionId: null },
    ])
  })

  it('is posted every 5 s at most while it plays, and at once on pause, unpause and seek', () => {
    const { store } = tab()
    store.identify(USER)
    report(store, 100)
    for (let second = 1; second < POSITION_EVERY_MS / 1000; second++) {
      clock += 1000
      report(store, 100 + second)
    }
    expect(positionsPosted()).toHaveLength(1)
    // The tab's own surfaces move with what it posts
    expect(position(store)).toBe(100)

    clock += 1000
    report(store, 105)
    expect(positionsPosted()).toHaveLength(2)

    clock += 1000
    report(store, 106, { paused: true })
    expect(positionsPosted().at(-1)).toMatchObject({ playbackTime: 106, paused: true })

    clock += 20_000
    report(store, 106, { paused: false })
    expect(positionsPosted()).toHaveLength(4)

    // A seek: nowhere near where a second of playback leads
    clock += 1000
    report(store, 2400)
    expect(positionsPosted().at(-1)).toMatchObject({ playbackTime: 2400 })
    clock += 1000
    report(store, 2401)
    expect(positionsPosted()).toHaveLength(5)
    // Back as well as forward
    clock += 1000
    report(store, 1200)
    expect(positionsPosted()).toHaveLength(6)
    expect(position(store)).toBe(1200)
  })

  it('a message from another user’s tab, another version or no tab is ignored', async () => {
    const { store } = tab()
    store.identify(USER)
    surface(store)
    await settle()
    const sender = bus.create(PLAYBACK_CHANNEL)
    const message = { v: 1, userId: USER, tabId: 'tab-x', type: 'position', mediaId: 'mid:film', nid: 'nid-film', playbackTime: 1200, paused: false }

    for (const bad of [{ ...message, userId: OTHER }, { ...message, v: 2 }, { ...message, tabId: null }, { ...message, playbackTime: 'soon' }, { ...message, type: 'hello' }, 'switched', null]) {
      sender.postMessage(bad)
    }
    expect(position(store)).toBe(600)

    sender.postMessage(message)
    expect(position(store)).toBe(1200)
  })

  it('a page rendered for another user feeds nothing: its report is the account changing', () => {
    const { store } = tab()
    store.identify(USER)
    store.reportPosition({ userId: OTHER, ...FILM, playbackTime: 1200 })
    expect(bus.posted).toEqual([])
    expect(store.getState().status).toBe('refused')
  })

  it('a report with no user, no identity or no position is dropped', () => {
    const { store } = tab()
    store.identify(USER)
    store.reportPosition({ userId: null, ...FILM, playbackTime: 1200 })
    store.reportPosition({ userId: USER, mediaId: null, normalizedVideoId: null, playbackTime: 1200 })
    store.reportPosition({ userId: USER, ...FILM, playbackTime: NaN })
    expect(bus.posted).toEqual([])
    expect(read(store)).toBe(PENDING)
  })
})

describe('ended: a tab stopped playing', () => {
  it('its last position stays until a snapshot asked for after the end has the server’s', async () => {
    const { store, conditionalFetch } = tab('tab-playing')
    store.identify(USER)
    surface(store)
    await settle()
    store.reportPosition({ userId: USER, ...FILM, playbackTime: 1200 })

    let answerRefresh
    conditionalFetch.mockReturnValue(new Promise((resolve) => (answerRefresh = resolve)))
    store.reportEnded({ userId: USER, ...FILM, playbackTime: 1234 })

    expect(read(store).entry).toEqual({ source: 'live', playbackTime: 1234, paused: true, ended: true })
    expect(bus.posted.at(-1)).toEqual({ v: 1, userId: USER, tabId: 'tab-playing', type: 'ended', mediaId: 'mid:film', nid: 'nid-film', playbackTime: 1234, sessionId: null })
    expect(conditionalFetch).toHaveBeenCalledTimes(2)

    answerRefresh(ok(snapshot([filmRow({ playbackTime: 1233, lastUpdated: iso(T0 + 70_000) })])))
    await settle()
    expect(read(store).entry).toMatchObject({ source: 'row', playbackTime: 1233 })
  })

  it('a request already in flight when it ended does not drop it: one more is asked behind it', async () => {
    const { store, win, conditionalFetch } = tab()
    store.identify(USER)
    surface(store)
    await settle()
    store.reportPosition({ userId: USER, ...FILM, playbackTime: 1200 })

    const answers = []
    conditionalFetch.mockImplementation(() => new Promise((resolve) => answers.push(resolve)))
    clock += RETURN_STALE_MS
    win.fire('focus')
    store.reportEnded({ userId: USER, ...FILM, playbackTime: 1234 })
    expect(answers).toHaveLength(1)

    // Read before the end: it cannot hold the final position
    answers[0](ok(snapshot([filmRow({ playbackTime: 1190, lastUpdated: iso(T0 + 50_000) })])))
    await settle()
    expect(position(store)).toBe(1234)
    expect(answers).toHaveLength(2)

    answers[1](ok(snapshot([filmRow({ playbackTime: 1234, lastUpdated: iso(T0 + 70_000) })])))
    await settle()
    expect(read(store).entry).toMatchObject({ source: 'row', playbackTime: 1234 })
  })

  it('stays when the refresh fails: the tab’s own last position is better than an older row', async () => {
    const { store, conditionalFetch } = tab()
    store.identify(USER)
    surface(store)
    await settle()
    conditionalFetch.mockResolvedValue(status(500))
    store.reportEnded({ userId: USER, ...FILM, playbackTime: 1234 })
    await settle()
    expect(position(store)).toBe(1234)
  })

  it('another tab marks it ended, asks once, and shows the row when it answers', async () => {
    const playing = tab('tab-playing')
    const other = tab('tab-other')
    for (const { store } of [playing, other]) {
      store.identify(USER)
      surface(store)
    }
    await settle()
    playing.store.reportPosition({ userId: USER, ...FILM, playbackTime: 1200 })

    other.conditionalFetch.mockResolvedValue(ok(snapshot([filmRow({ playbackTime: 1234, lastUpdated: iso(T0 + 70_000) })])))
    playing.store.reportEnded({ userId: USER, ...FILM, playbackTime: 1234 })
    expect(read(other.store).entry).toMatchObject({ source: 'live', playbackTime: 1234, ended: true })
    await settle()

    expect(other.conditionalFetch).toHaveBeenCalledTimes(2)
    expect(read(other.store).entry).toMatchObject({ source: 'row', playbackTime: 1234 })
  })

  it('a hidden tab that hears it asks when it is shown, however fresh its snapshot', async () => {
    const playing = tab('tab-playing')
    const hidden = tab('tab-hidden')
    for (const { store } of [playing, hidden]) {
      store.identify(USER)
      surface(store)
    }
    await settle()
    hidden.doc.setVisible(false)

    playing.store.reportEnded({ userId: USER, ...FILM, playbackTime: 1234 })
    await settle()
    expect(hidden.conditionalFetch).toHaveBeenCalledTimes(1)

    hidden.doc.setVisible(true)
    await settle()
    expect(hidden.conditionalFetch).toHaveBeenCalledTimes(2)
  })

  it('with no surface mounted nothing is asked until one mounts, which then asks at once', async () => {
    const { store, conditionalFetch } = tab()
    store.identify(USER)
    const { off } = surface(store)
    await settle()
    off()

    store.reportEnded({ userId: USER, ...FILM, playbackTime: 1234 })
    await settle()
    expect(conditionalFetch).toHaveBeenCalledTimes(1)

    surface(store)
    await settle()
    expect(conditionalFetch).toHaveBeenCalledTimes(2)
  })

  it('two tabs on one title: one stopping does not end the other', () => {
    const one = tab('tab-one')
    const two = tab('tab-two')
    const watcher = tab('tab-watcher')
    for (const { store } of [one, two, watcher]) store.identify(USER)

    one.store.reportPosition({ userId: USER, ...FILM, playbackTime: 100 })
    two.store.reportPosition({ userId: USER, ...FILM, playbackTime: 2000 })
    one.store.reportEnded({ userId: USER, ...FILM, playbackTime: 101 })

    expect(read(watcher.store).entry).toEqual({ source: 'live', playbackTime: 2000, paused: false, ended: false })
  })
})

describe('a tab that went away without saying so', () => {
  it('is dropped by the next snapshot once it has been silent for 15 s; a tab still talking is kept', async () => {
    const gone = tab('tab-gone')
    const talking = tab('tab-talking')
    const { store, win, conditionalFetch } = tab('tab-watcher')
    for (const page of [gone, talking]) page.store.identify(USER)
    store.identify(USER)
    surface(store)
    await settle()
    gone.store.reportPosition({ userId: USER, ...FILM, playbackTime: 1200 })
    talking.store.reportPosition({ userId: USER, ...SHORT, playbackTime: 20 })

    clock += 14_000
    talking.store.reportPosition({ userId: USER, ...SHORT, playbackTime: 34 })
    win.fire('focus')
    await settle()
    expect(position(store)).toBe(1200)

    clock += RETURN_STALE_MS
    talking.store.reportPosition({ userId: USER, ...SHORT, playbackTime: 39 })
    conditionalFetch.mockResolvedValue(ok(snapshot([filmRow({ playbackTime: 1201, lastUpdated: iso(T0 + 61_000) })])))
    win.fire('focus')
    await settle()
    expect(read(store).entry).toMatchObject({ source: 'row', playbackTime: 1201 })
    expect(read(store, SHORT).entry).toMatchObject({ source: 'live', playbackTime: 39 })
  })

  it('a paused tab’s position is on the server: the next snapshot speaks for it, so another device’s later progress shows', async () => {
    const paused = tab('tab-paused')
    const { store, win, conditionalFetch } = tab('tab-watcher')
    paused.store.identify(USER)
    store.identify(USER)
    surface(store)
    await settle()
    paused.store.reportPosition({ userId: USER, ...FILM, playbackTime: 1200, paused: true })
    expect(position(store)).toBe(1200)

    conditionalFetch.mockResolvedValue(ok(snapshot([filmRow({ playbackTime: 3000, lastUpdated: iso(T0 + 90_000) })])))
    clock += RETURN_STALE_MS
    win.fire('focus')
    await settle()
    expect(read(store).entry).toMatchObject({ source: 'row', playbackTime: 3000 })
  })

  it('this tab’s own player is never dropped for being quiet', async () => {
    const { store, win } = tab()
    store.identify(USER)
    surface(store)
    await settle()
    store.reportPosition({ userId: USER, ...FILM, playbackTime: 1200, paused: true })

    clock += 600_000
    win.fire('focus')
    await settle()
    expect(read(store).entry).toMatchObject({ source: 'live', playbackTime: 1200 })
  })
})

describe('changed: a position set by hand', () => {
  it('Mark watched: the row is shown from the save’s answer at once, the tabs are told, and each asks once', async () => {
    const marking = tab('tab-marking')
    const other = tab('tab-other')
    for (const { store } of [marking, other]) {
      store.identify(USER)
      surface(store)
    }
    await settle()
    other.store.reportPosition({ userId: USER, ...FILM, playbackTime: 700 })
    const after = ok(snapshot([filmRow({ playbackTime: 7200, lastUpdated: iso(T0 + 80_000) })]))
    let answerMarking
    marking.conditionalFetch.mockReturnValue(new Promise((resolve) => (answerMarking = resolve)))
    other.conditionalFetch.mockResolvedValue(after)

    marking.store.reportChanged({ userId: USER, keys: [FILM], saved: { ...FILM, playbackTime: 7200, savedAt: iso(T0 + 80_000) } })

    // Before any request answers
    expect(read(marking.store).entry).toMatchObject({ source: 'row', playbackTime: 7200, lastUpdated: iso(T0 + 80_000) })
    expect(bus.posted.at(-1)).toEqual({ v: 1, userId: USER, tabId: 'tab-marking', type: 'changed', keys: [{ mediaId: 'mid:film', nid: 'nid-film' }] })
    await settle()
    expect(other.conditionalFetch).toHaveBeenCalledTimes(2)
    expect(read(other.store).entry).toMatchObject({ source: 'row', playbackTime: 7200 })

    answerMarking(after)
    await settle()
    expect(marking.conditionalFetch).toHaveBeenCalledTimes(2)
    expect(position(marking.store)).toBe(7200)
  })

  it('drops what a tab was playing for those titles, and no other', async () => {
    const { store } = tab()
    store.identify(USER)
    store.reportPosition({ userId: USER, ...FILM, playbackTime: 700 })
    store.reportPosition({ userId: USER, ...SHORT, playbackTime: 20 })
    const sender = bus.create(PLAYBACK_CHANNEL)

    sender.postMessage({ v: 1, userId: USER, tabId: 'tab-x', type: 'changed', keys: [{ mediaId: 'mid:film', nid: 'nid-film' }] })

    expect(read(store)).toBe(PENDING)
    expect(position(store, SHORT)).toBe(20)
  })

  it('the title’s own answer is old news after it: the next snapshot has the last word', async () => {
    const { store, conditionalFetch } = tab()
    store.seed({ userId: USER, title: SHORT, entry: { found: true, ...SHORT, playbackTime: 45, lastUpdated: iso(T0), asOf: iso(T0) } })
    surface(store)
    await settle()
    expect(position(store, SHORT)).toBe(45)
    const sender = bus.create(PLAYBACK_CHANNEL)

    // The row was removed elsewhere: the snapshot no longer holds it
    conditionalFetch.mockResolvedValue(ok(snapshot([filmRow()])))
    sender.postMessage({ v: 1, userId: USER, tabId: 'tab-x', type: 'changed', keys: [{ mediaId: 'mid:short', nid: 'nid-short' }] })
    // Until the snapshot answers, what was known stays on show
    expect(position(store, SHORT)).toBe(45)
    await settle()
    expect(read(store, SHORT)).toBe(PENDING)
  })

  it('with no keys it is "ask again": a cast that ended knows the receiver’s URL, not the title’s ids', async () => {
    const { store, conditionalFetch } = tab()
    store.identify(USER)
    surface(store)
    await settle()

    store.reportChanged({ userId: USER })
    await settle()
    expect(bus.posted.at(-1)).toMatchObject({ type: 'changed', keys: [] })
    expect(conditionalFetch).toHaveBeenCalledTimes(2)
  })
})

describe('without BroadcastChannel', () => {
  it('a tab works alone: its own reports, snapshot and seeds, and nothing thrown', async () => {
    const { store, win, conditionalFetch } = tab('tab-alone', { channel: false })
    store.identify(USER)
    surface(store)
    await settle()
    expect(position(store)).toBe(600)

    store.reportPosition({ userId: USER, ...FILM, playbackTime: 1200 })
    expect(position(store)).toBe(1200)
    store.reportEnded({ userId: USER, ...FILM, playbackTime: 1234 })
    store.reportChanged({ userId: USER, keys: [FILM] })
    await settle()
    expect(bus.posted).toEqual([])
    expect(conditionalFetch.mock.calls.length).toBeGreaterThan(1)

    // Other tabs catch up when they are next shown
    conditionalFetch.mockResolvedValue(ok(snapshot([filmRow({ playbackTime: 1500, lastUpdated: iso(T0 + 99_000) })])))
    clock += RETURN_STALE_MS
    win.fire('focus')
    await settle()
    expect(position(store)).toBe(1500)
  })

  it('a channel that cannot be opened is the same as none', () => {
    const store = createPlaybackStore({
      conditionalFetch: jest.fn(async () => ok(snapshot([]))),
      getDocument: fakeDocument,
      getWindow: fakeWindow,
      createChannel: () => {
        throw new Error('SecurityError')
      },
      now: () => clock,
    })
    expect(() => store.identify(USER)).not.toThrow()
    expect(() => store.reportPosition({ userId: USER, ...FILM, playbackTime: 10 })).not.toThrow()
    expect(position(store)).toBe(10)
  })
})

describe('the viewer’s own sessions on other devices (the presence store, observed)', () => {
  const tv = (overrides = {}) => ({
    id: 'row-tv',
    sessionId: 'tv-session',
    state: 'playing',
    ...FILM,
    position: 1800,
    positionAt: iso(T0 + 30_000),
    ...overrides,
  })

  it('is not observed until the store has a user, and never asked for', () => {
    const presence = fakePresence()
    const { store } = tab('tab-a', { presence })
    expect(presence.observe).not.toHaveBeenCalled()
    store.identify(USER)
    expect(presence.observe).toHaveBeenCalledTimes(1)
  })

  it('a session playing elsewhere moves the title on from its last position, by the server’s clock', async () => {
    const presence = fakePresence()
    const { store } = tab('tab-a', { presence })
    store.identify(USER)
    const { listener } = surface(store)
    await settle()
    listener.mockClear()

    // The browser's clock is 300 s behind the server's; 15 s have passed there since the position was written
    clock = T0 + 45_000 - 300_000
    presence.tell([tv()], 300_000)

    expect(read(store).entry).toMatchObject({ source: 'presence', playbackTime: 1815, playing: true })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('a row written after the session’s position is the newer word: a device that just stopped, or paused long ago', async () => {
    const presence = fakePresence()
    const { store, conditionalFetch } = tab('tab-a', { presence })
    conditionalFetch.mockResolvedValue(ok(snapshot([filmRow({ playbackTime: 2400, lastUpdated: iso(T0 + 40_000) })])))
    store.identify(USER)
    surface(store)
    await settle()

    presence.tell([tv({ state: 'paused', position: 900, positionAt: iso(T0 - 600_000) })])
    expect(read(store).entry).toMatchObject({ source: 'row', playbackTime: 2400 })

    presence.tell([tv()])
    expect(read(store).entry).toMatchObject({ source: 'row', playbackTime: 2400 })

    // The device plays on: its position is written after the row was
    presence.tell([tv({ position: 2460, positionAt: iso(T0 + 100_000) })])
    expect(read(store).entry).toMatchObject({ source: 'presence' })
  })

  it('a session that is a tab of this browser is not another device', async () => {
    const presence = fakePresence()
    const { store } = tab('tab-a', { presence })
    store.identify(USER)
    surface(store)
    await settle()
    store.reportPosition({ userId: USER, ...FILM, playbackTime: 1200, sessionId: 'web-session' })
    presence.tell([tv({ id: 'row-web', sessionId: 'web-session', position: 1195 })])
    expect(read(store).entry).toMatchObject({ source: 'live', playbackTime: 1200 })

    // It stopped; the presence answer is up to a poll old and still lists it
    store.reportEnded({ userId: USER, ...FILM, playbackTime: 1234, sessionId: 'web-session' })
    await settle()
    expect(read(store).entry).toMatchObject({ source: 'row', playbackTime: 600 })
  })

  it('trigger 4: a session that disappears asks for the snapshot, its last position being on the server', async () => {
    const presence = fakePresence()
    const { store, conditionalFetch } = tab('tab-a', { presence })
    store.identify(USER)
    surface(store)
    await settle()
    presence.tell([tv(), tv({ id: 'row-phone', sessionId: 'phone-session', ...SHORT })])
    await settle()
    expect(conditionalFetch).toHaveBeenCalledTimes(1)

    conditionalFetch.mockResolvedValue(ok(snapshot([filmRow({ playbackTime: 5400, lastUpdated: iso(T0 + 120_000) })])))
    presence.tell([tv({ id: 'row-phone', sessionId: 'phone-session', ...SHORT })])
    await settle()

    expect(conditionalFetch).toHaveBeenCalledTimes(2)
    expect(read(store).entry).toMatchObject({ source: 'row', playbackTime: 5400 })
  })

  it('nothing live before or after tells no surface anything', async () => {
    const presence = fakePresence()
    const { store } = tab('tab-a', { presence })
    store.identify(USER)
    const { listener } = surface(store)
    await settle()
    listener.mockClear()
    presence.tell([])
    expect(listener).not.toHaveBeenCalled()
  })
})
