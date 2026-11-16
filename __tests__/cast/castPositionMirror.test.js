/**
 * The Cast position mirror's reports name the user the document was rendered
 * for, as every browser playback write does (src/lib/playbackUser.ts), so the
 * server refuses them once the browser's session is someone else's. A
 * document rendered for no one reports nothing.
 *
 * It keeps nothing in the browser: no localStorage, and no title named to the
 * positions store (it knows the receiver's URL, not the title's ids). When
 * the cast ends and its last position is saved, it tells the store so, and
 * the bars of every tab ask for the rows again.
 */
import { render, act } from '@testing-library/react'
import CastPositionMirror from '@components/Cast/CastPositionMirror'

let mockSession = { active: true, ending: false, mediaLoaded: true, contentUrl: 'https://files.example.com/x.mp4', contentId: null }
jest.mock('@components/Cast/useCastSession', () => ({ __esModule: true, default: () => mockSession }))
const mockFinal = jest.fn(() => null)
jest.mock('@components/Cast/castSdk', () => ({
  getRemote: () => ({ player: { isMediaLoaded: true, currentTime: 600, isPaused: false } }),
  readFinalRemotePosition: () => mockFinal(),
}))
const mockStore = { reportChanged: jest.fn(), reportPosition: jest.fn(), reportEnded: jest.fn(), seed: jest.fn() }
jest.mock('@components/WatchProgress/playbackStore', () => ({
  // Read when the mirror calls it: the import above runs before `mockStore` exists
  get playbackStore() {
    return mockStore
  },
}))

const setItem = jest.spyOn(Storage.prototype, 'setItem')

async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

/** A cast that was live and has just ended at `time`. */
function endCastAt(time) {
  const view = render(<CastPositionMirror userId="u1" />)
  mockFinal.mockReturnValue({ time, contentUrl: 'https://files.example.com/x.mp4' })
  mockSession = { ...mockSession, active: false, ending: true }
  view.rerender(<CastPositionMirror userId="u1" />)
  return view
}

beforeEach(() => {
  jest.clearAllMocks()
  mockFinal.mockReturnValue(null)
  mockSession = { active: true, ending: false, mediaLoaded: true, contentUrl: 'https://files.example.com/x.mp4', contentId: null }
  global.fetch = jest.fn().mockResolvedValue({ ok: true })
  window.localStorage.clear()
  setItem.mockClear()
})

it('reports the receiver’s position as the document’s user, as a cast mirror', () => {
  render(<CastPositionMirror userId="u1" />)
  const [url, init] = global.fetch.mock.calls[0]
  expect(url).toBe('/api/authenticated/sync/updatePlayback')
  expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'X-Playback-User': 'u1' })
  expect(JSON.parse(init.body)).toEqual({ videoId: 'https://files.example.com/x.mp4', playbackTime: 600, isPaused: false, source: 'cast-mirror' })
})

it('the final flush names the user too', () => {
  endCastAt(900)
  const [, init] = global.fetch.mock.calls.at(-1)
  expect(init.keepalive).toBe(true)
  expect(JSON.parse(init.body).playbackTime).toBe(900)
  expect(init.headers['X-Playback-User']).toBe('u1')
})

it('a document rendered for no one reports nothing', () => {
  render(<CastPositionMirror userId={null} />)
  expect(global.fetch).not.toHaveBeenCalled()
})

describe('what it keeps in the browser', () => {
  it('is nothing: no localStorage on a tick or at the end, and no title named to the store while the cast runs', async () => {
    endCastAt(900)
    await settle()

    expect(setItem).not.toHaveBeenCalled()
    expect(window.localStorage.length).toBe(0)
    // While it runs the bars follow the cast's own presence session
    for (const feed of [mockStore.reportPosition, mockStore.reportEnded, mockStore.seed]) expect(feed).not.toHaveBeenCalled()
  })

  it('tells the store the cast ended once its last position is saved, naming the user and no title', async () => {
    endCastAt(900)
    expect(mockStore.reportChanged).not.toHaveBeenCalled()
    await settle()

    expect(mockStore.reportChanged).toHaveBeenCalledTimes(1)
    expect(mockStore.reportChanged).toHaveBeenCalledWith({ userId: 'u1' })
  })

  it('says nothing when the last position was not saved: refused, failed, or never sent', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 409 })
    endCastAt(900).unmount()
    await settle()

    mockSession = { ...mockSession, active: true, ending: false }
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    endCastAt(900).unmount()
    await settle()

    // Under two seconds is "the start": never persisted
    mockSession = { ...mockSession, active: true, ending: false }
    global.fetch = jest.fn().mockResolvedValue({ ok: true })
    endCastAt(1)
    await settle()

    expect(mockStore.reportChanged).not.toHaveBeenCalled()
  })
})
