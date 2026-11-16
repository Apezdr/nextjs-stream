/**
 * Live progress on every surface: the newer of the server's object (exact,
 * frozen at render) and what the positions store holds for the title, by the
 * server's clock on both sides. Then the two hooks over the store: one
 * subscription per surface, the title found by the ids the server handed in,
 * and an answer that could not be had told apart from "no progress".
 */
import { renderHook, act } from '@testing-library/react'
import { renderToString } from 'react-dom/server'

let mockStore
jest.mock('@components/WatchProgress/playbackStore', () => {
  const actual = jest.requireActual('@components/WatchProgress/playbackStore')
  return {
    ...actual,
    // The app's one store, a fresh one for each test
    get playbackStore() {
      return mockStore
    },
  }
})

const { createPlaybackStore } = require('@components/WatchProgress/playbackStore')
const useLiveProgress = require('@components/WatchProgress/useLiveProgress').default
const { pickProgress } = require('@components/WatchProgress/useLiveProgress')
const useWatchPosition = require('@components/WatchProgress/useWatchPosition').default

const t = (iso) => new Date(iso).getTime()
const DURATION = 7_200_000
const USER = 'user-1'
const FILM = { mediaId: 'mid:film', normalizedVideoId: 'nid-film' }
const VIDEO_URL = 'https://files.example/movies/film/film.mp4'

describe('pickProgress', () => {
  const server = {
    playbackTime: 1800,
    progressPercent: 25,
    completed: false,
    lastWatched: '2026-09-09T10:00:00Z',
  }
  const row = (playbackTime, at) => ({ source: 'row', playbackTime, at })

  it('keeps the server object while it is the newer write, with its exact percentage', () => {
    const p = pickProgress({ watchHistory: server, entry: row(900, t('2026-09-09T09:00:00Z')), durationMs: DURATION })
    expect(p.playbackTime).toBe(1800)
    expect(p.progressPercent).toBe(25)
  })

  it('moves with the store once its row is the newer write: the film playing on the television', () => {
    const p = pickProgress({ watchHistory: server, entry: row(3600, t('2026-09-09T10:05:00Z')), durationMs: DURATION })
    expect(p.playbackTime).toBe(3600)
    expect(p.progressPercent).toBe(50)
    expect(p.completed).toBe(false)
  })

  it('the same write on both sides is the server object’s', () => {
    const p = pickProgress({ watchHistory: server, entry: row(1800, t('2026-09-09T10:00:00Z')), durationMs: DURATION })
    expect(p.progressPercent).toBe(25)
  })

  it('an entry with no server time never overrides a dated server value', () => {
    for (const at of [null, undefined, 0, NaN]) {
      expect(pickProgress({ watchHistory: server, entry: row(3600, at), durationMs: DURATION }).playbackTime).toBe(1800)
    }
  })

  it('the entry fills in when the page was rendered with no position', () => {
    const none = { playbackTime: 0, lastWatched: null, completed: false, progressPercent: 0 }
    for (const watchHistory of [null, none]) {
      const p = pickProgress({ watchHistory, entry: row(600, null), durationMs: DURATION })
      expect(p.playbackTime).toBe(600)
      expect(p.hasProgress).toBe(true)
    }
    expect(pickProgress({ watchHistory: null, entry: null, durationMs: DURATION }).hasProgress).toBe(false)
  })

  it('what a tab of this browser is playing is newer than anything rendered, whatever the times say', () => {
    const later = { ...server, lastWatched: '2030-01-01T00:00:00Z' }
    const p = pickProgress({ watchHistory: later, entry: { source: 'live', playbackTime: 2000, paused: false, ended: false }, durationMs: DURATION })
    expect(p.playbackTime).toBe(2000)
  })

  it('a session on another device is set against the object by when its position was written', () => {
    const session = (at) => ({ source: 'presence', playbackTime: 2400, playing: true, at })
    expect(pickProgress({ watchHistory: server, entry: session(t('2026-09-09T10:10:00Z')), durationMs: DURATION }).playbackTime).toBe(2400)
    // The rail fetched a row written after the session was last polled: the device has moved on, or stopped
    expect(pickProgress({ watchHistory: server, entry: session(t('2026-09-09T09:59:00Z')), durationMs: DURATION }).playbackTime).toBe(1800)
  })

  it('a newer row can be an earlier position: a rewatch is not finished any more', () => {
    const finished = { playbackTime: 7100, progressPercent: 98.6, completed: true, lastWatched: '2026-09-09T10:00:00Z' }
    const p = pickProgress({ watchHistory: finished, entry: row(120, t('2026-09-10T10:00:00Z')), durationMs: DURATION })
    expect(p.completed).toBe(false)
    expect(p.playbackTime).toBe(120)
  })

  it('completed and the percentage of a store position come from the server’s rule and the surface’s runtime', () => {
    expect(pickProgress({ watchHistory: server, entry: row(6840, t('2026-09-09T11:00:00Z')), durationMs: DURATION })).toMatchObject({
      progressPercent: 95,
      completed: true,
    })
    expect(pickProgress({ watchHistory: null, entry: row(6830, null), durationMs: DURATION })).toMatchObject({
      progressPercent: 94.9,
      completed: false,
    })
    // No runtime: a position is not a percentage
    expect(pickProgress({ watchHistory: null, entry: row(6840, null), durationMs: null })).toMatchObject({
      progressPercent: 0,
      completed: false,
      hasProgress: true,
    })
  })

  it('an entry that holds no number is no entry', () => {
    expect(pickProgress({ watchHistory: server, entry: { source: 'row', playbackTime: NaN, at: t('2030-01-01T00:00:00Z') }, durationMs: DURATION }).playbackTime).toBe(1800)
  })
})

// --- the hooks, over a store of the test's own ------------------------------

const T0 = Date.parse('2026-11-16T20:00:00.000Z')
const iso = (ms) => new Date(ms).toISOString()
const snapshotOf = (rows) => ({ response: { status: 200, ok: true }, data: { userId: USER, asOf: iso(T0), rows } })
const filmRow = (playbackTime, at = T0) => ({ ...FILM, playbackTime, lastUpdated: iso(at) })

let conditionalFetch
let fetchImpl

async function settle() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve()
  })
}

beforeEach(() => {
  conditionalFetch = jest.fn(async () => snapshotOf([]))
  fetchImpl = jest.fn(async () => ({ status: 200, ok: true, json: async () => ({ found: false, asOf: iso(T0) }) }))
  mockStore = createPlaybackStore({ conditionalFetch, fetchImpl, createChannel: () => null, tabId: 'tab-test' })
})

describe('useLiveProgress', () => {
  const rendered = { ...FILM, playbackTime: 1800, progressPercent: 25, completed: false, lastWatched: iso(T0 - 60_000) }

  it('starts from the object the surface was rendered with, and moves when the store holds a newer row', async () => {
    conditionalFetch.mockResolvedValue(snapshotOf([filmRow(3600)]))
    const { result } = renderHook(() => useLiveProgress({ watchHistory: rendered, ...FILM, durationMs: DURATION }))
    expect(result.current.playbackTime).toBe(1800)

    act(() => {
      mockStore.identify(USER)
    })
    await settle()
    expect(result.current).toMatchObject({ playbackTime: 3600, progressPercent: 50 })
  })

  it('moves with what a tab of this browser is playing', () => {
    mockStore.identify(USER)
    const { result } = renderHook(() => useLiveProgress({ watchHistory: rendered, ...FILM, durationMs: DURATION }))
    act(() => mockStore.reportPosition({ userId: USER, ...FILM, playbackTime: 2000 }))
    expect(result.current.playbackTime).toBe(2000)
  })

  it('finds its title by the ids in the server object when the surface passes none', async () => {
    conditionalFetch.mockResolvedValue(snapshotOf([filmRow(3600)]))
    mockStore.identify(USER)
    const { result } = renderHook(() => useLiveProgress({ watchHistory: rendered, durationMs: DURATION }))
    await settle()
    expect(result.current.playbackTime).toBe(3600)
  })

  it('is one subscription per surface, and none for a surface that is disabled or has no identity', async () => {
    mockStore.identify(USER)
    const subscribe = jest.spyOn(mockStore, 'subscribe')

    renderHook(() => useLiveProgress({ ...FILM, enabled: false }))
    renderHook(() => useLiveProgress({ watchHistory: null }))
    await settle()
    expect(subscribe).not.toHaveBeenCalled()
    expect(conditionalFetch).not.toHaveBeenCalled()

    const { unmount } = renderHook(() => useLiveProgress({ watchHistory: rendered, ...FILM, durationMs: DURATION }))
    expect(subscribe).toHaveBeenCalledTimes(1)
    await settle()
    // No timer and no request of its own: the one snapshot
    expect(conditionalFetch).toHaveBeenCalledTimes(1)
    expect(fetchImpl).not.toHaveBeenCalled()
    unmount()
  })

  it('renders the server object on the server, whatever the store holds', () => {
    mockStore.seed({ userId: USER, title: FILM, entry: { found: true, ...FILM, playbackTime: 3600, lastUpdated: iso(T0), asOf: iso(T0) } })
    function Bar() {
      const progress = useLiveProgress({ watchHistory: rendered, ...FILM, durationMs: DURATION })
      return <span>{progress.playbackTime}</span>
    }
    expect(renderToString(<Bar />)).toContain('1800')
  })
})

describe('useWatchPosition', () => {
  const title = { ...FILM, videoURL: VIDEO_URL, durationMs: DURATION }

  it('is not settled until the store has an answer for the title, then says what it is', async () => {
    conditionalFetch.mockResolvedValue(snapshotOf([filmRow(3600)]))
    const { result } = renderHook(() => useWatchPosition(title))
    expect(result.current).toMatchObject({ settled: false, unknown: false })
    expect(result.current.progress.hasProgress).toBe(false)

    act(() => {
      mockStore.identify(USER)
    })
    await settle()
    expect(result.current).toMatchObject({ settled: true, unknown: false, refusal: null })
    expect(result.current.progress).toMatchObject({ playbackTime: 3600, progressPercent: 50, completed: false })
    // In the snapshot: nothing was asked for the title itself
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('a title outside the snapshot is asked for once, however many surfaces read it', async () => {
    mockStore.identify(USER)
    const surfaces = [renderHook(() => useWatchPosition(title)), renderHook(() => useWatchPosition(title)), renderHook(() => useWatchPosition(title))]
    await settle()

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0][0]).toBe(
      `/api/authenticated/sync/playback?mediaId=${encodeURIComponent('mid:film')}&videoId=${encodeURIComponent(VIDEO_URL)}`
    )
    for (const { result } of surfaces) {
      expect(result.current).toMatchObject({ settled: true, unknown: false })
      expect(result.current.progress.hasProgress).toBe(false)
    }
  })

  it('the page’s seed settles it with no request at all', async () => {
    conditionalFetch.mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useWatchPosition(title))
    act(() => mockStore.seed({ userId: USER, title: FILM, entry: { found: true, ...FILM, playbackTime: 6900, lastUpdated: iso(T0), asOf: iso(T0) } }))

    expect(result.current.settled).toBe(true)
    expect(result.current.progress.completed).toBe(true)
    await settle()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('a page that joined the history on the server is settled from the first render, and asks nothing', async () => {
    mockStore.identify(USER)
    const watchHistory = { ...FILM, playbackTime: 1800, progressPercent: 25, completed: false, lastWatched: iso(T0) }
    const { result } = renderHook(() => useWatchPosition({ ...title, watchHistory }))

    expect(result.current).toMatchObject({ settled: true, unknown: false })
    expect(result.current.progress.playbackTime).toBe(1800)
    await settle()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('a read that fails is unknown, not "no progress"', async () => {
    fetchImpl.mockResolvedValue({ status: 500, ok: false, json: async () => ({}) })
    mockStore.identify(USER)
    const { result } = renderHook(() => useWatchPosition(title))
    await settle()

    expect(result.current).toMatchObject({ settled: true, unknown: true, refusal: null })
  })

  it('a refusal is unknown too, with its status', async () => {
    conditionalFetch.mockResolvedValue({ response: { status: 409, ok: false }, data: undefined })
    mockStore.identify(USER)
    const { result } = renderHook(() => useWatchPosition(title))
    await settle()

    expect(result.current).toMatchObject({ settled: true, unknown: true, refusal: 409 })
  })

  it('a title with no identity has nothing to wait for', () => {
    const { result } = renderHook(() => useWatchPosition({ videoURL: VIDEO_URL }))
    expect(result.current).toMatchObject({ settled: true, unknown: false })
  })
})
