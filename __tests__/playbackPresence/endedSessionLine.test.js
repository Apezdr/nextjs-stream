/**
 * The app's own two stores, wired as the app wires them: the positions store
 * (WatchProgress/playbackStore.js) hears a player stop, and the presence
 * store (WatchingNow/ownSessions.js) is what the "watching now" line reads.
 *
 * Leaving a player sends the session's end and, from the page it leaves for,
 * a presence poll at the same moment. The poll can be answered first, still
 * listing the session. The line must not show it.
 */
import { render, screen } from '@testing-library/react'
import WatchingNowLine from '@components/WatchingNow/WatchingNowLine'
import { playbackStore } from '@components/WatchProgress/playbackStore'

const USER = 'user-1'
const FILM = { mediaId: 'mid:film', normalizedVideoId: 'nid-film' }

function live(overrides) {
  const at = new Date().toISOString()
  return {
    ...FILM,
    mediaType: 'movie',
    showId: null,
    seasonNumber: null,
    episodeNumber: null,
    state: 'playing',
    position: 600,
    positionAt: at,
    lastHeartbeat: at,
    staleAfter: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  }
}

const WEB = live({ id: 'row-web', sessionId: 'web-session', device: { type: 'desktop', label: 'Chrome · Desktop', platform: 'Windows' } })
const TV = live({ id: 'row-tv', sessionId: 'tv-session', device: { type: 'tv', label: 'TV', platform: 'Android' } })

const realFetch = global.fetch

afterEach(() => {
  global.fetch = realFetch
})

it('a player this tab just left is not shown as playing by an answer that still lists it', async () => {
  // The answer that got in before the session's end did
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ sessions: [WEB, TV], asOf: new Date().toISOString() }),
  }))

  // The player in this tab played, then its page was left
  playbackStore.reportPosition({ userId: USER, ...FILM, playbackTime: 1200, sessionId: 'web-session' })
  playbackStore.reportEnded({ userId: USER, ...FILM, playbackTime: 1234, sessionId: 'web-session' })

  // The page it left for
  const { unmount } = render(<WatchingNowLine {...FILM} />)

  const line = await screen.findByRole('list', { name: 'Watching now' })
  expect(global.fetch).toHaveBeenCalledWith('/api/authenticated/presence', expect.anything())
  // The television is still playing it; this browser is not
  expect(line).toHaveTextContent('Playing on TV')
  expect(line).not.toHaveTextContent('Chrome')
  expect(screen.getAllByRole('listitem')).toHaveLength(1)
  unmount()
})
