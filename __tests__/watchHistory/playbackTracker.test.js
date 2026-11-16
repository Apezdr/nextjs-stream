/**
 * The web player's tracker and the positions store: what this tab is playing
 * goes to the store (and through it to the browser's other tabs), never to
 * localStorage; when the player stops, the store is told, after the final
 * save, with the position that save carried.
 */
import { render, act } from '@testing-library/react'

// The player store the tracker subscribes to: a position, a pause flag, listeners
const mockPlayer = {
  currentTime: 0,
  paused: false,
  target: { media: { target: null } },
  listeners: new Set(),
  seek: jest.fn(),
  subscribe(listener) {
    mockPlayer.listeners.add(listener)
    return () => mockPlayer.listeners.delete(listener)
  },
}
jest.mock('@components/MediaPlayer/videojs', () => ({
  Player: { usePlayer: (selector) => (selector ? selector(mockPlayer) : mockPlayer) },
}))
let mockReady = { canSeek: true, canTrack: true }
jest.mock('@components/MediaPlayer/usePlaybackReady', () => ({ __esModule: true, default: () => mockReady }))
jest.mock('next/navigation', () => ({ usePathname: () => '/list/movie/Film/play' }))
// The 1 s throttle is the tracker's own cadence; here every tick goes through
jest.mock('lodash/throttle', () => (fn) => Object.assign((...args) => fn(...args), { cancel: jest.fn() }))

const mockStore = { reportPosition: jest.fn(), reportEnded: jest.fn() }
jest.mock('@components/WatchProgress/playbackStore', () => ({ playbackStore: mockStore }))

const WithPlaybackTracker = require('@components/built-in/WithPlaybackTracker').default

const USER = 'user-1'
const VIDEO_URL = 'https://files.example/movies/film/film.mp4'
const TITLE = { mediaId: 'mid:film', normalizedVideoId: 'nid-film' }
// One object, as the server render hands the player one: a new one each render would re-run the tracker's effects
const METADATA = { mediaType: 'movie', mediaId: 'doc-1' }

const posted = []
class FakeWorker {
  constructor() {
    this.listeners = new Set()
  }
  postMessage(message) {
    posted.push(message)
  }
  addEventListener(_type, fn) {
    this.listeners.add(fn)
  }
  removeEventListener(_type, fn) {
    this.listeners.delete(fn)
  }
  terminate() {}
}

function tracker(props = {}) {
  return (
    <WithPlaybackTracker
      videoURL={VIDEO_URL}
      {...TITLE}
      userId={USER}
      mediaMetadata={METADATA}
      {...props}
    />
  )
}

/** The player reaches `seconds`: the store notifies, as on a timeupdate. */
function playTo(seconds, paused = mockPlayer.paused) {
  mockPlayer.currentTime = seconds
  mockPlayer.paused = paused
  act(() => {
    for (const listener of [...mockPlayer.listeners]) listener()
  })
}

const setItem = jest.spyOn(Storage.prototype, 'setItem')

beforeEach(() => {
  jest.clearAllMocks()
  posted.length = 0
  mockPlayer.currentTime = 0
  mockPlayer.paused = false
  mockPlayer.listeners.clear()
  mockReady = { canSeek: true, canTrack: true }
  global.Worker = FakeWorker
  global.fetch = jest.fn().mockResolvedValue({ ok: true })
  window.localStorage.clear()
  setItem.mockClear()
})

it('tells the store where this tab is on every tick, by the ids the server handed in, and stores nothing', () => {
  render(tracker())
  playTo(30)

  expect(mockStore.reportPosition).toHaveBeenCalledTimes(1)
  expect(mockStore.reportPosition).toHaveBeenCalledWith({
    userId: USER,
    mediaId: 'mid:film',
    normalizedVideoId: 'nid-film',
    playbackTime: 30,
    paused: false,
    sessionId: expect.any(String),
  })
  // The session it names is the one its saves carry: the presence row's
  expect(mockStore.reportPosition.mock.calls[0][0].sessionId).toBe(posted[0].sessionId)
  expect(posted[0]).toMatchObject({ videoURL: VIDEO_URL, currentTime: 30 })

  expect(setItem).not.toHaveBeenCalled()
  expect(window.localStorage.length).toBe(0)
})

it('keeps telling the store while a save is in flight: the bars show where the tab is, not what was acknowledged', () => {
  render(tracker())
  playTo(30)
  playTo(31)
  playTo(32)

  // One save in flight, never answered
  expect(posted).toHaveLength(1)
  expect(mockStore.reportPosition.mock.calls.map(([report]) => report.playbackTime)).toEqual([30, 31, 32])
})

it('reports nothing in the first two seconds, nor before the start position was applied', () => {
  mockReady = { canSeek: false, canTrack: true }
  const { rerender } = render(tracker({ resumeAt: 600 }))
  playTo(30)
  expect(mockStore.reportPosition).not.toHaveBeenCalled()

  mockReady = { canSeek: true, canTrack: true }
  rerender(tracker({ resumeAt: 600 }))
  expect(mockPlayer.seek).toHaveBeenCalledWith(600)
  playTo(1.5)
  expect(mockStore.reportPosition).not.toHaveBeenCalled()
  playTo(601)
  expect(mockStore.reportPosition).toHaveBeenCalledTimes(1)
})

it('a pause or an unpause is told at once', () => {
  const { rerender } = render(tracker())
  playTo(30)
  mockStore.reportPosition.mockClear()

  mockPlayer.paused = true
  rerender(tracker())
  expect(mockStore.reportPosition).toHaveBeenLastCalledWith(expect.objectContaining({ playbackTime: 30, paused: true }))

  mockPlayer.paused = false
  rerender(tracker())
  expect(mockStore.reportPosition).toHaveBeenLastCalledWith(expect.objectContaining({ playbackTime: 30, paused: false }))
})

it('on unmount: the final save first, then the store is told it stopped, at the position saved', () => {
  const { unmount } = render(tracker())
  playTo(30)
  mockPlayer.currentTime = 34.5

  unmount()

  const final = global.fetch.mock.calls.find(([url]) => url === '/api/authenticated/sync/updatePlayback')
  expect(JSON.parse(final[1].body)).toMatchObject({ kind: 'final', playbackTime: 34.5 })
  expect(mockStore.reportEnded).toHaveBeenCalledTimes(1)
  expect(mockStore.reportEnded).toHaveBeenCalledWith({
    userId: USER,
    mediaId: 'mid:film',
    normalizedVideoId: 'nid-film',
    playbackTime: 34.5,
    sessionId: mockStore.reportPosition.mock.calls[0][0].sessionId,
  })
  expect(global.fetch.mock.invocationCallOrder[0]).toBeLessThan(mockStore.reportEnded.mock.invocationCallOrder[0])
})

it('when the final save has nothing to read (the media already detached) it still says it stopped, at the last position reported', () => {
  const { unmount } = render(tracker())
  playTo(30)
  mockPlayer.target = null

  unmount()

  expect(global.fetch.mock.calls.filter(([url]) => url === '/api/authenticated/sync/updatePlayback')).toEqual([])
  expect(mockStore.reportEnded).toHaveBeenCalledWith(expect.objectContaining({ playbackTime: 30 }))
  mockPlayer.target = { media: { target: null } }
})

it('on pagehide too, once: the unmount that follows says nothing again', () => {
  const { unmount } = render(tracker())
  playTo(30)

  act(() => {
    window.dispatchEvent(new Event('pagehide'))
  })
  expect(mockStore.reportEnded).toHaveBeenCalledTimes(1)
  unmount()
  expect(mockStore.reportEnded).toHaveBeenCalledTimes(1)
})

it('a player that never reported a position has nothing to end', () => {
  const { unmount } = render(tracker())
  playTo(1)
  unmount()
  expect(mockStore.reportEnded).not.toHaveBeenCalled()
})

it('when a cast takes the title over, the tab stops being what plays it, under the session it had', () => {
  const { rerender } = render(tracker())
  playTo(30)
  const { sessionId } = mockStore.reportPosition.mock.calls[0][0]

  mockReady = { canSeek: false, canTrack: false }
  rerender(tracker({ castAdopted: true }))

  expect(mockStore.reportEnded).toHaveBeenCalledTimes(1)
  expect(mockStore.reportEnded).toHaveBeenCalledWith(expect.objectContaining({ playbackTime: 30, sessionId }))
})
