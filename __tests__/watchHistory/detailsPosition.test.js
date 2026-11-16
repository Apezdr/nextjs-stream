/**
 * The first paint of a movie or episode details page. Its HTML is cached for
 * every viewer, so the button, the resume panel and the clocks get the
 * viewer's position on the client, from the positions store:
 *
 * - until the store has an answer the button shows no word (it never says
 *   "Play" and then "Resume"), in a slot that does not change size;
 * - the page's own server render hands the answer in with the page (the seed);
 * - an answer that could not be had is said, not shown as "not started".
 */
import { render, screen, act } from '@testing-library/react'
import { renderToString } from 'react-dom/server'

let mockStore
jest.mock('@components/WatchProgress/playbackStore', () => {
  const actual = jest.requireActual('@components/WatchProgress/playbackStore')
  return {
    ...actual,
    get playbackStore() {
      return mockStore
    },
  }
})

const { createPlaybackStore } = require('@components/WatchProgress/playbackStore')
const PrimaryPlayButton = require('@components/MediaPages/details/PrimaryPlayButton').default
const { PENDING_LABEL_MS } = require('@components/MediaPages/details/PrimaryPlayButton')
const WatchProgressPanel = require('@components/WatchProgress/WatchProgressPanel').default
const PlaybackSeed = require('@components/WatchProgress/PlaybackSeed').default
const PlaybackStoreUser = require('@components/WatchProgress/PlaybackStoreUser').default
const { TotalRuntime } = require('@components/watched')
const { useWatched } = require('@components/useWatchedWidth')

const USER = 'user-1'
const FILM = { mediaId: 'mid:film', normalizedVideoId: 'nid-film' }
const VIDEO_URL = 'https://files.example/movies/film/film.mp4'
const PLAY_HREF = '/list/movie/Film/play'
const TWO_HOURS = 7_200_000
const T0 = Date.parse('2026-11-16T20:00:00.000Z')
const iso = (ms) => new Date(ms).toISOString()

const title = { ...FILM, videoURL: VIDEO_URL, durationMs: TWO_HOURS, playHref: PLAY_HREF }
const seedOf = (playbackTime) => ({ found: true, ...FILM, playbackTime, lastUpdated: iso(T0), asOf: iso(T0) })

let conditionalFetch
let fetchImpl

async function settle() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve()
  })
}

beforeEach(() => {
  // Nothing answers unless a test says so: the wait is what is under test
  conditionalFetch = jest.fn(() => new Promise(() => {}))
  fetchImpl = jest.fn(() => new Promise(() => {}))
  mockStore = createPlaybackStore({ conditionalFetch, fetchImpl, createChannel: () => null, tabId: 'tab-test' })
})

describe('the primary button', () => {
  const button = () => screen.getByRole('link')
  const shownWord = () => [...button().querySelectorAll('span > span')].filter((word) => !word.classList.contains('invisible')).map((word) => word.textContent)

  it('shows no word while the position is on its way, and still plays', () => {
    render(<PrimaryPlayButton {...title} />)

    expect(button()).toHaveAttribute('data-primary-action', 'pending')
    expect(button()).toHaveAttribute('href', PLAY_HREF)
    expect(shownWord()).toEqual([])
    // Named for what it does, for a reader that cannot see the empty slot
    expect(button()).toHaveAccessibleName('Play')
  })

  it('the cached HTML is the same wordless button for every viewer', () => {
    mockStore.seed({ userId: USER, title: FILM, entry: seedOf(1800) })
    const html = renderToString(<PrimaryPlayButton {...title} />)
    expect(html).toContain('data-primary-action="pending"')
    expect(html).not.toMatch(/<span class="col-start-1 row-start-1">/)
  })

  it('holds every word it can say in its slot, so the slot is one width whichever shows', () => {
    render(<PrimaryPlayButton {...title} noun="episode" restartNoun="" />)
    const words = [...button().querySelectorAll('span > span')]
    expect(words.map((word) => word.textContent)).toEqual(['Play episode', 'Resume episode', 'Watch again'])
    for (const word of words) expect(word).toHaveClass('col-start-1', 'row-start-1')
  })

  it.each([
    ['Resume', 1800, PLAY_HREF],
    ['Watch again', 7000, `${PLAY_HREF}?start=0`],
  ])('says %s the moment the page’s seed arrives, never "Play" first', (word, playbackTime, href) => {
    render(<PrimaryPlayButton {...title} />)
    const said = [shownWord()]

    render(<PlaybackSeed userId={USER} title={FILM} entry={seedOf(playbackTime)} />)
    said.push(shownWord())

    expect(said).toEqual([[], [word]])
    expect(button()).toHaveAttribute('data-primary-action', word)
    expect(button()).toHaveAttribute('href', href)
    expect(button()).toHaveAccessibleName(word)
  })

  it('says Play when the seed says the viewer has no row', () => {
    render(<PrimaryPlayButton {...title} />)
    render(<PlaybackSeed userId={USER} title={FILM} entry={{ found: false, asOf: iso(T0) }} />)
    expect(shownWord()).toEqual(['Play'])
    expect(button()).toHaveAttribute('data-primary-action', 'Play')
  })

  it('says Play after 1.5 s without an answer, and the right word when the answer comes late', async () => {
    jest.useFakeTimers()
    try {
      render(<PrimaryPlayButton {...title} />)
      act(() => jest.advanceTimersByTime(PENDING_LABEL_MS - 1))
      expect(shownWord()).toEqual([])
      act(() => jest.advanceTimersByTime(1))
      expect(shownWord()).toEqual(['Play'])
      expect(button()).toHaveAttribute('data-primary-action', 'Play')

      act(() => mockStore.seed({ userId: USER, title: FILM, entry: seedOf(1800) }))
      expect(shownWord()).toEqual(['Resume'])
    } finally {
      jest.useRealTimers()
    }
  })

  it('arms no timeout once it has its answer', () => {
    const timeouts = jest.spyOn(global, 'setTimeout')
    try {
      mockStore.seed({ userId: USER, title: FILM, entry: seedOf(1800) })
      render(<PrimaryPlayButton {...title} />)
      expect(shownWord()).toEqual(['Resume'])
      expect(timeouts.mock.calls.filter(([, ms]) => ms === PENDING_LABEL_MS)).toEqual([])

      // And one, once, for a button that is waiting
      render(<PrimaryPlayButton {...title} mediaId="mid:another" normalizedVideoId="nid-another" />)
      expect(timeouts.mock.calls.filter(([, ms]) => ms === PENDING_LABEL_MS)).toHaveLength(1)
    } finally {
      timeouts.mockRestore()
    }
  })

  it('with the server’s object it has its word from the first paint, at its natural width', () => {
    const watchHistory = { ...FILM, playbackTime: 1800, progressPercent: 25, completed: false, lastWatched: iso(T0) }
    const html = renderToString(<PrimaryPlayButton {...title} watchHistory={watchHistory} noun="S1 · E1" />)
    expect(html).toContain('data-primary-action="Resume"')
    expect(html).not.toContain('invisible')

    render(<PrimaryPlayButton {...title} watchHistory={watchHistory} noun="S1 · E1" />)
    expect(screen.getByRole('link', { name: 'Resume S1 · E1' })).toHaveAttribute('href', PLAY_HREF)
  })

  it('a read that failed says Play: the player finds its own place', async () => {
    conditionalFetch.mockResolvedValue({ response: { status: 500, ok: false }, data: undefined })
    fetchImpl.mockResolvedValue({ status: 500, ok: false, json: async () => ({}) })
    mockStore.identify(USER)
    render(<PrimaryPlayButton {...title} />)
    await settle()
    expect(shownWord()).toEqual(['Play'])
  })
})

describe('the resume panel', () => {
  it('is empty until there is a position, and for a title not started', () => {
    const { container } = render(<WatchProgressPanel {...title} />)
    expect(container).toBeEmptyDOMElement()

    act(() => mockStore.seed({ userId: USER, title: FILM, entry: { found: false, asOf: iso(T0) } }))
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the position the seed carried', () => {
    render(<WatchProgressPanel {...title} />)
    render(<PlaybackSeed userId={USER} title={FILM} entry={seedOf(1800)} />)

    const panel = screen.getByTestId('watch-progress-panel')
    expect(panel).toHaveTextContent('Continue where you left off')
    expect(panel).toHaveTextContent('30:00 / 2:00:00')
    expect(panel).toHaveTextContent('1h 30m left')
  })

  it('says so when the position could not be read: an empty panel would read as "not started"', async () => {
    conditionalFetch.mockResolvedValue({ response: { status: 200, ok: true }, data: { userId: USER, asOf: iso(T0), rows: [] } })
    fetchImpl.mockResolvedValue({ status: 502, ok: false, json: async () => ({}) })
    mockStore.identify(USER)
    render(<WatchProgressPanel {...title} />)
    await settle()

    expect(screen.getByRole('status')).toHaveTextContent('Your progress could not be loaded.')
    expect(screen.queryByTestId('watch-progress-panel')).not.toBeInTheDocument()
  })

  it('says to reload when the browser’s session is another account’s now', async () => {
    conditionalFetch.mockResolvedValue({ response: { status: 409, ok: false }, data: undefined })
    mockStore.identify(USER)
    render(<WatchProgressPanel {...title} />)
    await settle()

    expect(screen.getByRole('status')).toHaveTextContent('This page was opened for another account. Reload it.')
  })
})

describe('the store’s user', () => {
  it('comes from the layout, once: the store asks for nothing until it is told', async () => {
    conditionalFetch.mockResolvedValue({ response: { status: 200, ok: true }, data: { userId: USER, asOf: iso(T0), rows: [] } })
    const { rerender } = render(
      <>
        <PlaybackStoreUser userId={null} />
        <WatchProgressPanel {...title} />
      </>
    )
    await settle()
    expect(conditionalFetch).not.toHaveBeenCalled()

    rerender(
      <>
        <PlaybackStoreUser userId={USER} />
        <WatchProgressPanel {...title} />
      </>
    )
    await settle()
    expect(conditionalFetch).toHaveBeenCalledTimes(1)
    expect(conditionalFetch.mock.calls[0][1].headers['X-Playback-User']).toBe(USER)
    expect(mockStore.getState().userId).toBe(USER)
  })

  it('a seed for another user’s page empties the store rather than paint their position here', () => {
    render(
      <>
        <PlaybackStoreUser userId={USER} />
        <PlaybackSeed userId="user-2" title={FILM} entry={seedOf(1800)} />
        <WatchProgressPanel {...title} />
      </>
    )
    expect(mockStore.getState().status).toBe('refused')
    expect(screen.queryByTestId('watch-progress-panel')).not.toBeInTheDocument()
  })
})

describe('the grid’s poster and clock', () => {
  const movie = {
    ...FILM,
    duration: TWO_HOURS,
    watchHistory: { ...FILM, playbackTime: 1800, progressPercent: 25, completed: false, lastWatched: iso(T0 - 60_000) },
  }

  function Poster({ item }) {
    const watched = useWatched(item.metadata, item)
    return <span data-testid="poster">{`${watched.progressPercent}|${Math.round(watched.playbackTime)}|${watched.completed}`}</span>
  }

  it('one reading gives the bar, the clock and the finished flag: the server’s, then the store’s when it is newer', () => {
    mockStore.identify(USER)
    render(<Poster item={movie} />)
    expect(screen.getByTestId('poster')).toHaveTextContent('25|1800|false')

    act(() => mockStore.reportPosition({ userId: USER, ...FILM, playbackTime: 6900 }))
    expect(screen.getByTestId('poster')).toHaveTextContent('95.8|6900|true')
  })

  it('falls back to the TMDB runtime when the file’s is unknown', () => {
    render(<Poster item={{ ...movie, duration: undefined, metadata: { runtime: 60 }, watchHistory: null }} />)
    act(() => mockStore.seed({ userId: USER, title: FILM, entry: seedOf(1800) }))
    expect(screen.getByTestId('poster')).toHaveTextContent('50|1800|false')
  })

  it('the clock formats the position it is handed, and reads the store when handed none', () => {
    const { container } = render(<TotalRuntime length={TWO_HOURS} watchedSeconds={1800} />)
    expect(container).toHaveTextContent('00:30:00 - 02:00:00')

    const live = render(<TotalRuntime length={TWO_HOURS} {...FILM} watchHistory={movie.watchHistory} />)
    expect(live.container).toHaveTextContent('00:30:00 - 02:00:00')
    act(() => mockStore.reportPosition({ userId: USER, ...FILM, playbackTime: 3600 }))
    expect(live.container).toHaveTextContent('01:00:00 - 02:00:00')
  })
})
