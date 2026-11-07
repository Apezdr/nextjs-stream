/**
 * The Cast position mirror's reports name the user the document was rendered
 * for, as every browser playback write does (src/lib/playbackUser.ts), so the
 * server refuses them once the browser's session is someone else's. A
 * document rendered for no one reports nothing.
 */
import { render } from '@testing-library/react'
import CastPositionMirror from '@components/Cast/CastPositionMirror'

let mockSession = { active: true, ending: false, mediaLoaded: true, contentUrl: 'https://files.example.com/x.mp4', contentId: null }
jest.mock('@components/Cast/useCastSession', () => ({ __esModule: true, default: () => mockSession }))
const mockFinal = jest.fn(() => null)
jest.mock('@components/Cast/castSdk', () => ({
  getRemote: () => ({ player: { isMediaLoaded: true, currentTime: 600, isPaused: false } }),
  readFinalRemotePosition: () => mockFinal(),
}))

beforeEach(() => {
  mockSession = { active: true, ending: false, mediaLoaded: true, contentUrl: 'https://files.example.com/x.mp4', contentId: null }
  global.fetch = jest.fn().mockResolvedValue({ ok: true })
  window.localStorage.clear()
})

it('reports the receiver’s position as the document’s user, as a cast mirror', () => {
  render(<CastPositionMirror userId="u1" />)
  const [url, init] = global.fetch.mock.calls[0]
  expect(url).toBe('/api/authenticated/sync/updatePlayback')
  expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'X-Playback-User': 'u1' })
  expect(JSON.parse(init.body)).toEqual({ videoId: 'https://files.example.com/x.mp4', playbackTime: 600, isPaused: false, source: 'cast-mirror' })
})

it('the final flush names the user too', () => {
  const { rerender } = render(<CastPositionMirror userId="u1" />)
  mockFinal.mockReturnValue({ time: 900, contentUrl: 'https://files.example.com/x.mp4' })
  mockSession = { ...mockSession, active: false, ending: true }
  rerender(<CastPositionMirror userId="u1" />)
  const [, init] = global.fetch.mock.calls.at(-1)
  expect(init.keepalive).toBe(true)
  expect(JSON.parse(init.body).playbackTime).toBe(900)
  expect(init.headers['X-Playback-User']).toBe('u1')
})

it('a document rendered for no one reports nothing', () => {
  render(<CastPositionMirror userId={null} />)
  expect(global.fetch).not.toHaveBeenCalled()
})
