/**
 * The web's presence surfaces (plans/media-activity-presence.md, "A user's own
 * sessions"): the media pages' "watching now" line and the cards' badge. Both
 * read the one store of the viewer's own sessions (ownSessions.js, tested on
 * its own) and pick their sessions with the shared rules.
 */
import { render, screen } from '@testing-library/react'
import WatchingNowLine from '@components/WatchingNow/WatchingNowLine'
import LiveBadge from '@components/WatchingNow/LiveBadge'
import { badgeParts, deviceName, episodeNoun } from '@components/WatchingNow/wording'

let mockOwn = { sessions: [], offsetMs: 0 }
jest.mock('@components/WatchingNow/ownSessions', () => ({
  __esModule: true,
  useOwnLiveSessions: () => mockOwn,
}))

// A whole second, so the line's once-a-second clock reads exactly this
const CLIENT_NOW = Date.parse('2026-11-09T20:00:00.000Z')
// The server's clock runs five minutes ahead of this browser's
const OFFSET_MS = 5 * 60_000
const SERVER_NOW = CLIENT_NOW + OFFSET_MS

const TV = { type: 'tv', label: 'TV', platform: 'Android' }
const CHROME = { type: 'desktop', label: 'Chrome · Desktop', platform: 'Windows' }
const CAST = { type: 'cast', label: 'Cast', platform: 'Cast' }
const SHOW_ID = '64b000000000000000000001'

function session(overrides = {}) {
  return {
    id: 'row-1',
    sessionId: 'tv-session',
    mediaId: 'mid:film',
    normalizedVideoId: 'nid-film',
    mediaType: 'movie',
    showId: null,
    seasonNumber: null,
    episodeNumber: null,
    state: 'playing',
    // 10 s before the server's now: 41:02 then, 41:12 now
    position: 2462,
    positionAt: new Date(SERVER_NOW - 10_000).toISOString(),
    device: TV,
    lastHeartbeat: new Date(SERVER_NOW - 10_000).toISOString(),
    staleAfter: new Date(SERVER_NOW + 50_000).toISOString(),
    ...overrides,
  }
}
const episode = (overrides = {}) =>
  session({ mediaId: 'mid:s02e07', normalizedVideoId: 'nid-s02e07', mediaType: 'tv', showId: SHOW_ID, seasonNumber: 2, episodeNumber: 7, ...overrides })

function own(sessions, offsetMs = OFFSET_MS) {
  mockOwn = { sessions, offsetMs }
}

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(CLIENT_NOW)
  own([])
})

afterEach(() => {
  jest.restoreAllMocks()
})

const line = () => screen.queryByRole('list', { name: 'Watching now' })

describe('the line, on a movie or an episode page', () => {
  it('says what is playing where, with the position now by the server’s clock', () => {
    own([session()])
    render(<WatchingNowLine mediaId="mid:film" normalizedVideoId="nid-film" />)
    // By this browser's clock, five minutes behind, it would read 41:02: the
    // position was written in what this browser takes for the future
    expect(line()).toHaveTextContent('Playing on TV · 41:12')
  })

  it('a paused session stays where it stopped', () => {
    own([session({ state: 'paused', position: 723, device: CHROME })])
    render(<WatchingNowLine mediaId="mid:film" />)
    expect(line()).toHaveTextContent('Paused on Chrome · Desktop · 12:03')
  })

  it('shows only the sessions on this title: by mediaId when both have one, by the hash otherwise', () => {
    own([
      session(),
      session({ id: 'row-2', mediaId: 'mid:other', normalizedVideoId: 'nid-film', device: CHROME }),
      session({ id: 'row-3', mediaId: null, normalizedVideoId: 'nid-film', state: 'paused', position: 60, device: CAST }),
    ])
    render(<WatchingNowLine mediaId="mid:film" normalizedVideoId="nid-film" />)
    expect([...line().querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'Playing on TV · 41:12',
      'Paused on a Cast device · 1:00',
    ])
  })

  it('one line per device, in the server’s order, at most three', () => {
    own([
      session(),
      session({ id: 'row-2', state: 'paused', position: 60, device: CHROME }),
      session({ id: 'row-3', state: 'paused', position: 0, device: CAST }),
      session({ id: 'row-4', state: 'paused', device: { type: null, label: 'Unknown', platform: '' } }),
    ])
    render(<WatchingNowLine mediaId="mid:film" />)
    expect([...line().querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'Playing on TV · 41:12',
      'Paused on Chrome · Desktop · 1:00',
      // No position yet: no clock
      'Paused on a Cast device',
      'and 1 more',
    ])
  })

  it('shows nothing when nothing is live on this title', () => {
    own([session({ mediaId: 'mid:other', normalizedVideoId: 'nid-other' })])
    render(<WatchingNowLine mediaId="mid:film" normalizedVideoId="nid-film" />)
    expect(line()).toBeNull()
  })
})

describe('the line, on a show or a season page', () => {
  const show = { originalTitle: 'The Show (2019)', showTitle: 'The Show' }

  it('a show page names the episode and links to it', () => {
    own([episode()])
    render(<WatchingNowLine showId={SHOW_ID} show={show} />)
    expect(line()).toHaveTextContent('Playing S2 · E7 on TV · 41:12')
    expect(screen.getByRole('link', { name: 'S2 · E7' })).toHaveAttribute('href', '/list/tv/The%20Show%20(2019)/2/7')
  })

  it('a season page names it by number, and leaves other seasons out', () => {
    own([episode({ state: 'paused' }), episode({ id: 'row-2', seasonNumber: 3, episodeNumber: 1 })])
    render(<WatchingNowLine showId={SHOW_ID} seasonNumber={2} show={show} />)
    expect(line()).toHaveTextContent('Paused Episode 7 on TV · 41:02')
    expect(line().querySelectorAll('li')).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'Episode 7' })).toHaveAttribute('href', '/list/tv/The%20Show%20(2019)/2/7')
  })

  it('Specials are season 0', () => {
    own([episode({ seasonNumber: 0, episodeNumber: 3 })])
    render(<WatchingNowLine showId={SHOW_ID} show={show} />)
    expect(screen.getByRole('link', { name: 'Specials · E3' })).toHaveAttribute('href', '/list/tv/The%20Show%20(2019)/0/3')
  })

  it('without a route key (the hover popup) names the episode without a link', () => {
    own([episode()])
    render(<WatchingNowLine showId={SHOW_ID} tone="light" />)
    expect(line()).toHaveTextContent('Playing S2 · E7 on TV · 41:12')
    expect(screen.queryByRole('link')).toBeNull()
  })
})

describe('the card badge', () => {
  it('a movie card: the verb on the poster, the sentence for the tooltip and screen readers', () => {
    own([session()])
    render(<LiveBadge title={{ mediaId: 'mid:film', normalizedVideoId: 'nid-film' }} />)
    const badge = screen.getByTestId('live-badge')
    expect(badge).toHaveAttribute('title', 'Playing on TV')
    expect(badge).toHaveTextContent('Playing')
    expect(screen.getByText('Playing on TV')).toHaveClass('sr-only')
  })

  it('a show card: any episode of the show, named', () => {
    own([episode({ state: 'paused', device: CAST })])
    render(<LiveBadge showId={SHOW_ID} />)
    expect(screen.getByTestId('live-badge')).toHaveAttribute('title', 'Paused S2 · E7 on a Cast device')
  })

  it('names the first device and counts the rest', () => {
    own([session(), session({ id: 'row-2', state: 'paused', device: CHROME })])
    render(<LiveBadge title={{ mediaId: 'mid:film' }} />)
    expect(screen.getByTestId('live-badge')).toHaveAttribute('title', 'Playing on TV, and 1 more device')
  })

  it('nothing for a title or show with nothing live', () => {
    own([episode()])
    const { container } = render(
      <>
        <LiveBadge title={{ mediaId: 'mid:film', normalizedVideoId: 'nid-film' }} />
        <LiveBadge showId="64b0000000000000000000ff" />
        <LiveBadge />
      </>
    )
    expect(container).toBeEmptyDOMElement()
  })
})

describe('the words', () => {
  it('names the device after "on"', () => {
    expect(deviceName(TV)).toBe('TV')
    expect(deviceName(CHROME)).toBe('Chrome · Desktop')
    expect(deviceName(CAST)).toBe('a Cast device')
    expect(deviceName({ type: null, label: 'Unknown' })).toBe('another device')
    expect(deviceName(null)).toBe('another device')
  })

  it('names the episode only on a show or a season page, and only when the catalog placed it', () => {
    const placed = { seasonNumber: 2, episodeNumber: 7 }
    expect(episodeNoun(placed, 'title')).toBeNull()
    expect(episodeNoun(placed, 'show')).toBe('S2 · E7')
    expect(episodeNoun(placed, 'season')).toBe('Episode 7')
    expect(episodeNoun({ seasonNumber: null, episodeNumber: 7 }, 'show')).toBeNull()
    expect(episodeNoun({ seasonNumber: 2, episodeNumber: null }, 'season')).toBeNull()
  })

  it('a badge needs a session', () => {
    expect(badgeParts([], 'title')).toBeNull()
    expect(badgeParts([session(), session({ id: 'b' }), session({ id: 'c' })], 'title').description).toBe('Playing on TV, and 2 more devices')
  })
})
