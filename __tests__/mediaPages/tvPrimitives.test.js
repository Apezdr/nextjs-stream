/**
 * The shared pieces the three TV info pages are built from: the trail, the
 * status chip, in-app fact links, the primary button's noun and server seed,
 * the cast tabs, the episode nav and next-episode card, season tiles,
 * episode rows, the list/grid toggle, the season selector and the episode
 * action dialog.
 *
 * Network hooks, next/image, the router, toasts and the mark-watched helper
 * are mocked; what is under test is what each piece renders from its props
 * and what it calls back with.
 */

import { render, screen, within, fireEvent, waitFor, act } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import Link from 'next/link'

const mockPush = jest.fn()

jest.mock('react', () => ({
  ...jest.requireActual('react'),
  // Next's compiled React carries ViewTransition; the test runtime does not.
  ViewTransition: ({ children }) => children,
}))

jest.mock('next/image', () => ({
  __esModule: true,
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt, fill, priority, quality, placeholder, blurDataURL, sizes, ...rest }) => <img src={typeof src === 'string' ? src : ''} alt={alt} {...rest} />,
}))

jest.mock('swr', () => ({
  __esModule: true,
  default: () => ({ data: undefined, error: undefined, isLoading: false }),
  mutate: jest.fn(),
}))

jest.mock('swr/mutation', () => ({
  __esModule: true,
  default: () => ({ trigger: jest.fn(), isMutating: false }),
}))

jest.mock('@src/lib/auth-client', () => ({
  authClient: { useSession: () => ({ data: { user: { id: 'u1', role: 'user' } }, isPending: false }) },
}))

// react-dom is NOT mocked here (detailsPages.test.js stubs createPortal for
// the sticky bar): Headless UI's Dialog portals to <body> and marks its
// siblings inert, so an inline "portal" would hide the dialog itself.

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: jest.fn() }),
}))

jest.mock('react-toastify', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}))

jest.mock('@components/WatchProgress/markWatched', () => ({
  markWatched: jest.fn().mockResolvedValue({ playbackTime: 3841 }),
  PLAYBACK_POSITION_KEY: (u) => u,
}))

const { Trail, Chip, MetaLine, DetailsPanel, PRIMARY_CLASSES, SECONDARY_CLASSES } = require('@components/MediaPages/details/Primitives')
const PrimaryPlayButton = require('@components/MediaPages/details/PrimaryPlayButton')
const ActionRow = require('@components/MediaPages/details/ActionRow')
const CastRail = require('@components/MediaPages/details/CastRail').default
const CastTabs = require('@components/MediaPages/details/CastTabs').default
const EpisodeNav = require('@components/MediaPages/details/EpisodeNav').default
const NextEpisodeCard = require('@components/MediaPages/details/NextEpisodeCard').default
const SeasonTile = require('@components/MediaPages/details/SeasonTile').default
const EpisodeRow = require('@components/MediaPages/details/EpisodeRow').default
const { default: ViewToggle, useStoredView } = require('@components/MediaPages/details/ViewToggle')
const SeasonSelector = require('@components/MediaPages/details/SeasonSelector').default
const EpisodeActionDialog = require('@components/MediaPages/details/EpisodeActionDialog').default
const { markWatched } = require('@components/WatchProgress/markWatched')
const { toast } = require('react-toastify')
const { episodeStatusLine } = require('@components/WatchProgress/episodeStatus')

const PLAY_HREF = '/list/tv/Preacher/1/1/play'
const inProgress = { playbackTime: 509, progressPercent: 13.3, completed: false, lastWatched: '2026-09-01T20:00:00.000Z' }
const finished = { playbackTime: 3800, progressPercent: 99, completed: true, lastWatched: '2026-09-02T20:00:00.000Z' }
const untouched = { playbackTime: 0, progressPercent: 0, completed: false, lastWatched: null }

const pilot = {
  _id: 'e1',
  showId: 's1',
  seasonNumber: 1,
  episodeNumber: 1,
  title: 'Pilot',
  overview: null,
  thumbnail: 'https://files.example.com/tv/Preacher/S01E01.jpg',
  thumbnailBlurDataURL: 'data:image/png;base64,AAAA',
  durationMs: 3_841_000,
  videoURL: 'https://files.example.com/tv/Preacher/S01E01.mp4',
  mediaId: 'mid:abc:s01e01',
  chips: ['1080p', 'CC'],
  hrefs: { info: '/list/tv/Preacher/1/1', play: PLAY_HREF },
  watchHistory: inProgress,
  viewTransitionName: 'tv-episode-preacher-1-1',
}

beforeEach(() => {
  window.localStorage.clear()
  mockPush.mockClear()
  markWatched.mockClear()
  toast.success.mockClear()
  toast.error.mockClear()
})

describe('Trail', () => {
  it('links every item but the last, which is the current page', () => {
    render(<Trail items={[{ label: 'TV', href: '/list/tv' }, { label: 'Preacher', href: '/list/tv/Preacher' }, { label: 'Season 1', href: '/list/tv/Preacher/1' }]} />)
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(nav).getByRole('link', { name: 'TV' })).toHaveAttribute('href', '/list/tv')
    expect(within(nav).getByRole('link', { name: 'Preacher' })).toHaveAttribute('href', '/list/tv/Preacher')
    expect(within(nav).queryByRole('link', { name: 'Season 1' })).not.toBeInTheDocument()
    expect(within(nav).getByText('Season 1')).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getAllByText('/', { selector: '[aria-hidden="true"]' })).toHaveLength(2)
  })

  it('renders nothing for an empty trail', () => {
    const { container } = render(<Trail items={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('Chip and MetaLine', () => {
  it('keeps quality chips uppercase and renders a status chip as written', () => {
    render(<MetaLine items={['2016–2019', 'Drama / Fantasy']} chips={[{ label: 'Ended', tone: 'status' }, '4K']} />)
    const status = screen.getByText('Ended')
    expect(status).not.toHaveClass('uppercase')
    expect(status).toHaveClass('normal-case')
    expect(screen.getByText('4K')).toHaveClass('uppercase')
    expect(screen.getByText('2016–2019')).toBeInTheDocument()
  })

  it('leaves the outline and solid chips exactly as before', () => {
    const { container } = render(
      <>
        <Chip>HDR10</Chip>
        <Chip tone="solid">PG-13</Chip>
      </>
    )
    const [outline, solid] = container.querySelectorAll('span')
    expect(outline.className).toBe('inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase leading-4 tracking-wide border border-white/35 text-white/90')
    expect(solid.className).toBe('inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase leading-4 tracking-wide bg-white/90 text-slate-900')
  })

  it('renders nothing with no items and no chips', () => {
    const { container } = render(<MetaLine items={[null, undefined]} chips={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('DetailsPanel links', () => {
  it('opens external links in a new tab and keeps in-app links in the page', () => {
    render(
      <DetailsPanel
        id="episode-details"
        title="Episode details"
        rows={[
          { label: 'Show', value: 'Preacher', links: [{ label: 'Preacher', href: '/list/tv/Preacher', external: false }] },
          { label: 'Links', value: 'TMDB', links: [{ label: 'TMDB', href: 'https://www.themoviedb.org/tv/1' }] },
        ]}
      />
    )
    const inApp = screen.getByRole('link', { name: 'Preacher' })
    expect(inApp).toHaveAttribute('href', '/list/tv/Preacher')
    expect(inApp).not.toHaveAttribute('target')
    expect(inApp).not.toHaveAttribute('rel')
    const external = screen.getByRole('link', { name: 'TMDB' })
    expect(external).toHaveAttribute('target', '_blank')
    expect(external).toHaveAttribute('rel', 'noopener noreferrer')
  })
})

describe('PrimaryPlayButton', () => {
  it('appends the noun to the verb and keeps the bare verb in data-primary-action', () => {
    render(<PrimaryPlayButton.default videoURL={pilot.videoURL} playHref={PLAY_HREF} noun="S1 · E1" />)
    const link = screen.getByRole('link', { name: 'Play S1 · E1' })
    expect(link).toHaveAttribute('href', PLAY_HREF)
    expect(link).toHaveAttribute('data-primary-action', 'Play')
  })

  it('says Resume on the first render from the server seed', () => {
    render(<PrimaryPlayButton.default videoURL={pilot.videoURL} mediaId={pilot.mediaId} durationMs={pilot.durationMs} playHref={PLAY_HREF} noun="S1 · E1" watchHistory={inProgress} />)
    const link = screen.getByRole('link', { name: 'Resume S1 · E1' })
    expect(link).toHaveAttribute('href', PLAY_HREF)
  })

  it('says Watch again with a restart href from a completed seed', () => {
    render(<PrimaryPlayButton.default videoURL={pilot.videoURL} mediaId={pilot.mediaId} durationMs={pilot.durationMs} playHref={PLAY_HREF} noun="S1 · E1" watchHistory={finished} />)
    const link = screen.getByRole('link', { name: 'Watch again S1 · E1' })
    expect(link).toHaveAttribute('href', `${PLAY_HREF}?start=0`)
    expect(link).toHaveAttribute('data-primary-action', 'Watch again')
  })

  it('drops the noun after Watch again when restartNoun is empty', () => {
    render(<PrimaryPlayButton.default videoURL={pilot.videoURL} playHref={PLAY_HREF} noun="episode" restartNoun="" watchHistory={finished} />)
    expect(screen.getByRole('link', { name: 'Watch again' })).toBeInTheDocument()
  })

  it('exports the class strings from the plain module and re-exports them from the client ones', () => {
    expect(PrimaryPlayButton.PRIMARY_CLASSES).toBe(PRIMARY_CLASSES)
    expect(ActionRow.SECONDARY_CLASSES).toBe(SECONDARY_CLASSES)
    expect(PRIMARY_CLASSES).toContain('bg-blue-500')
    expect(PRIMARY_CLASSES).toContain('h-12')
    expect(SECONDARY_CLASSES).toContain('border-white/25')
  })
})

describe('ActionRow', () => {
  it('forwards the noun and seed and renders children after the watchlist button', () => {
    render(
      <ActionRow.default videoURL={pilot.videoURL} playHref={PLAY_HREF} noun="Episode 1" watchHistory={inProgress} trailerUrl={null} watchlist={null}>
        <Link href="/list/tv/Preacher/1/1" className={SECONDARY_CLASSES}>
          Episode details
        </Link>
      </ActionRow.default>
    )
    expect(screen.getByRole('link', { name: 'Resume Episode 1' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Episode details' })).toHaveAttribute('href', '/list/tv/Preacher/1/1')
    expect(screen.queryByRole('button', { name: /my list/i })).not.toBeInTheDocument()
  })
})

describe('CastRail', () => {
  const cast = [{ id: 1, name: 'Dominic Cooper', character: 'Jesse Custer', profile_path: null }]

  it('keeps its heading and bleeding scroller by default', () => {
    const { container } = render(<CastRail cast={cast} />)
    expect(screen.getByRole('heading', { name: /^Cast/ })).toBeInTheDocument()
    expect(container.querySelector('ul')).toHaveClass('-mx-4')
  })

  it('drops the heading and the bleed when told to, naming the section instead', () => {
    const { container } = render(<CastRail cast={cast} title="Guest stars" hideHeading bleed={false} />)
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Guest stars' })).toBeInTheDocument()
    expect(container.querySelector('ul')).not.toHaveClass('-mx-4')
    expect(container.querySelector('ul')).toHaveClass('px-1')
  })

  it('scrolls freely with a visible scrollbar: no snapping, no hidden bar', () => {
    const { container } = render(<CastRail cast={cast} />)
    const list = container.querySelector('ul')
    expect(list).toHaveClass('overflow-x-auto', 'scrollbar-thin')
    expect(list.className).not.toMatch(/snap-|scrollbar-none/)
    expect(container.querySelector('li').className).not.toMatch(/snap-/)
  })

  it('lays out as a wrapping grid on request: three rows first, the rest behind See all', () => {
    const many = Array.from({ length: 29 }, (_, i) => ({ id: i + 1, name: `Person ${i + 1}`, character: 'Role', profile_path: null }))
    const { container } = render(<CastRail cast={many} title="Series cast" hideHeading bleed={false} layout="grid" />)
    const list = container.querySelector('ul')
    expect(list).toHaveClass('grid')
    expect(list).not.toHaveClass('overflow-x-auto')
    expect(container.querySelectorAll('li')).toHaveLength(12)

    fireEvent.click(screen.getByRole('button', { name: 'See all 29' }))
    expect(container.querySelectorAll('li')).toHaveLength(29)
    expect(screen.getByRole('button', { name: 'Show fewer' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('needs no toggle when everyone fits', () => {
    render(<CastRail cast={cast} hideHeading bleed={false} layout="grid" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('CastTabs', () => {
  const guests = [{ id: 20, name: 'Guest One', character: 'Scientist', profile_path: null }]
  const series = [
    { id: 1, name: 'Dominic Cooper', character: 'Jesse Custer', profile_path: null },
    { id: 2, name: 'Ruth Negga', character: 'Tulip', profile_path: null },
  ]
  const tabs = [
    { id: 'guests', label: 'Guest stars', cast: guests },
    { id: 'series', label: 'Series cast', cast: series },
  ]

  it('renders a tablist, switches on click and wraps with the arrow keys', () => {
    render(<CastTabs tabs={tabs} defaultTab="guests" />)
    const tablist = screen.getByRole('tablist', { name: 'Cast' })
    const [guestTab, seriesTab] = within(tablist).getAllByRole('tab')
    expect(guestTab).toHaveTextContent('Guest stars · 1')
    expect(seriesTab).toHaveTextContent('Series cast · 2')
    expect(guestTab).toHaveAttribute('aria-selected', 'true')
    expect(seriesTab).toHaveAttribute('tabindex', '-1')
    expect(screen.getByText('Guest One')).toBeInTheDocument()
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'tab-guests')

    fireEvent.click(seriesTab)
    expect(seriesTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Ruth Negga')).toBeInTheDocument()
    expect(screen.queryByText('Guest One')).not.toBeInTheDocument()

    fireEvent.keyDown(seriesTab, { key: 'ArrowRight' })
    expect(guestTab).toHaveAttribute('aria-selected', 'true')
    expect(guestTab).toHaveFocus()
    fireEvent.keyDown(guestTab, { key: 'End' })
    expect(seriesTab).toHaveAttribute('aria-selected', 'true')
    expect(seriesTab).toHaveFocus()
  })

  it('falls back to a plain rail with one tab and nothing with none', () => {
    render(<CastTabs tabs={[{ id: 'guests', label: 'Guest stars', cast: [] }, { id: 'series', label: 'Series cast', cast: series }]} defaultTab="guests" />)
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /^Series cast/ })).toBeInTheDocument()

    const { container } = render(<CastTabs tabs={[{ id: 'guests', label: 'Guest stars', cast: [] }]} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('EpisodeNav', () => {
  it('disables Previous, keeps the centre link and hides Next when there is none', () => {
    render(<EpisodeNav previous={null} all={{ href: '/list/tv/Preacher/1', count: 8 }} next={null} />)
    const nav = screen.getByRole('navigation', { name: 'Episode navigation' })
    expect(within(nav).getByText('Previous episode')).toHaveAttribute('aria-disabled', 'true')
    expect(within(nav).queryByRole('link', { name: /previous/i })).not.toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'All 8 episodes' })).toHaveAttribute('href', '/list/tv/Preacher/1')
    expect(within(nav).queryByText(/Next episode/)).not.toBeInTheDocument()
  })

  it('links both neighbours, pluralises the count and falls back to the episode number', () => {
    render(<EpisodeNav previous={{ href: '/list/tv/Preacher/1/1', episodeNumber: 1, title: 'Pilot' }} all={{ href: '/list/tv/Preacher/1', count: 1 }} next={{ href: '/list/tv/Preacher/1/3', episodeNumber: 3, title: null }} />)
    expect(screen.getByRole('link', { name: 'Previous episode' })).toHaveAttribute('href', '/list/tv/Preacher/1/1')
    expect(screen.getByRole('link', { name: 'All 1 episode' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Next episode · Episode 3' })).toHaveAttribute('href', '/list/tv/Preacher/1/3')
  })

  it('renders nothing when there is nothing to navigate to', () => {
    const { container } = render(<EpisodeNav previous={null} all={null} next={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('NextEpisodeCard', () => {
  it('is one link named by the episode, with the runtime and chips', () => {
    render(<NextEpisodeCard href="/list/tv/Preacher/1/2" seasonNumber={1} episodeNumber={2} title="See" thumbnail="https://files.example.com/S01E02.jpg" durationMs={2_940_000} chips={['1080p']} />)
    expect(screen.getByRole('heading', { name: 'Next in Season 1' })).toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'Episode 2: See' })
    expect(link).toHaveAttribute('href', '/list/tv/Preacher/1/2')
    expect(within(link).getByText('49m · 1080p')).toBeInTheDocument()
    // The still is decorative (alt ""), so it has no img role: query the element
    expect(link.querySelector('img')).toHaveAttribute('src', 'https://files.example.com/S01E02.jpg')
  })

  it('copes with no still, no runtime and Specials, and renders nothing without an href', () => {
    const { container: withoutStill } = render(<NextEpisodeCard href="/list/tv/Preacher/0/2" seasonNumber={0} episodeNumber={2} title={null} thumbnail={null} />)
    expect(screen.getByRole('heading', { name: 'Next in Specials' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Episode 2: Episode 2' })).toBeInTheDocument()
    expect(withoutStill.querySelector('img')).toBeNull()

    const { container } = render(<NextEpisodeCard href={null} seasonNumber={1} episodeNumber={2} title="See" thumbnail={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('SeasonTile', () => {
  it('is one link named by its lines when the season is in the library', () => {
    render(
      <SeasonTile seasonNumber={1} title="Season 1" href="/list/tv/Preacher/1" posterURL="https://files.example.com/s1.jpg" posterBlurhash="AAAA" available year="2016" episodeCount={10} status={{ kind: 'continue', label: 'Continue Episode 1' }} viewTransitionName="tv-season-preacher-1" />
    )
    const link = screen.getByRole('link', { name: 'Season 1, 2016 · 10 episodes available, Continue Episode 1' })
    expect(link).toHaveAttribute('href', '/list/tv/Preacher/1')
    expect(within(link).getByText('Continue Episode 1')).toHaveClass('text-blue-300')
    expect(link.querySelector('img')).toHaveAttribute('src', 'https://files.example.com/s1.jpg')
  })

  it('shows a check for a watched season and a muted line for a partial one', () => {
    const { container } = render(
      <>
        <SeasonTile seasonNumber={2} title="Season 2" href="/list/tv/Preacher/2" posterURL={null} posterBlurhash={null} available year={null} episodeCount={1} status={{ kind: 'watched', label: 'Watched' }} />
        <SeasonTile seasonNumber={4} title="Season 4" href="/list/tv/Preacher/4" posterURL={null} posterBlurhash={null} available year={null} episodeCount={null} status={{ kind: 'partial', label: '3 of 10 watched' }} />
      </>
    )
    expect(screen.getByText('Watched')).toHaveClass('text-emerald-300')
    expect(screen.getByText('1 episode available')).toBeInTheDocument()
    expect(screen.getByText('3 of 10 watched')).toHaveClass('text-white/45')
    expect(screen.getByText('Available in your library')).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
  })

  it('is a dashed placeholder, not a link, when the season is missing', () => {
    const { container } = render(<SeasonTile seasonNumber={3} title="Season 3" href={null} posterURL={null} posterBlurhash={null} available={false} year="2018" episodeCount={null} status={{ kind: 'unavailable', label: null }} />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('Not available')).toBeInTheDocument()
    expect(screen.getByText('3')).toHaveClass('text-4xl')
    expect(screen.getByText('Missing from your library')).toBeInTheDocument()
    expect(container.querySelector('.border-dashed')).not.toBeNull()
  })
})

describe('EpisodeRow', () => {
  it('lists the row with the exact placeholder synopsis, chips, live status and one tab stop', () => {
    const onActions = jest.fn()
    render(
      <ul>
        <EpisodeRow episode={pilot} onActions={onActions} />
      </ul>
    )
    expect(screen.getByText('01')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '1. Pilot' })).toHaveAttribute('href', '/list/tv/Preacher/1/1')
    expect(screen.getByText('Episode synopsis will appear here.')).toBeInTheDocument()
    expect(screen.getByText('In progress · 56m left')).toHaveClass('text-blue-300')
    expect(screen.getByText('1080p')).toBeInTheDocument()
    expect(screen.getByText('CC')).toBeInTheDocument()
    expect(screen.getByText('1h 4m')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { hidden: true })).toBeInTheDocument()

    const stillLink = document.querySelector('a[aria-hidden="true"]')
    expect(stillLink).toHaveAttribute('href', '/list/tv/Preacher/1/1')
    expect(stillLink).toHaveAttribute('tabindex', '-1')
    expect(screen.getAllByRole('link')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Episode actions' }))
    expect(onActions).toHaveBeenCalledWith(pilot)
  })

  it('shows the synopsis, Not watched and no bar for an untouched episode', () => {
    const { container } = render(
      <ul>
        <EpisodeRow episode={{ ...pilot, _id: 'e2', episodeNumber: 2, title: 'See', overview: 'Jesse tries to be a better preacher.', chips: [], durationMs: null, watchHistory: untouched, thumbnail: null }} onActions={jest.fn()} />
      </ul>
    )
    expect(screen.getByText('Jesse tries to be a better preacher.')).toBeInTheDocument()
    expect(screen.queryByText('Episode synopsis will appear here.')).not.toBeInTheDocument()
    expect(screen.getByText('Not watched')).toHaveClass('text-blue-300/60')
    expect(screen.queryByRole('progressbar', { hidden: true })).not.toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
  })

  it('marks a finished episode Watched and drops the synopsis in the grid view', () => {
    render(
      <ul>
        <EpisodeRow episode={{ ...pilot, watchHistory: finished }} view="grid" onActions={jest.fn()} />
      </ul>
    )
    expect(screen.getByText('Watched')).toHaveClass('text-emerald-300')
    expect(screen.queryByText('Episode synopsis will appear here.')).not.toBeInTheDocument()
    expect(screen.queryByRole('progressbar', { hidden: true })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Episode actions' })).toBeInTheDocument()
  })
})

describe('episodeStatusLine', () => {
  it('names the three states', () => {
    expect(episodeStatusLine({ completed: true, hasProgress: true })).toEqual({ kind: 'watched', label: 'Watched' })
    expect(episodeStatusLine({ completed: false, hasProgress: true, remainingSeconds: 3332 })).toEqual({ kind: 'in-progress', label: 'In progress · 56m left' })
    expect(episodeStatusLine({ completed: false, hasProgress: true, remainingSeconds: null, progressPercent: 13.3 })).toEqual({ kind: 'in-progress', label: 'In progress · 13%' })
    expect(episodeStatusLine({ completed: false, hasProgress: false })).toEqual({ kind: 'unwatched', label: 'Not watched' })
  })
})

describe('ViewToggle and useStoredView', () => {
  function Harness() {
    const [view, setView] = useStoredView()
    return (
      <div>
        <span data-testid="view">{view}</span>
        <ViewToggle value={view} onChange={setView} />
      </div>
    )
  }

  it('renders the list view on the server whatever is stored', () => {
    window.localStorage.setItem('tv-episodes-view', 'grid')
    const html = renderToString(<Harness />)
    expect(html).toContain('data-testid="view">list<')
  })

  it('applies the stored choice on the client and remembers a change', () => {
    window.localStorage.setItem('tv-episodes-view', 'grid')
    render(<Harness />)
    expect(screen.getByTestId('view')).toHaveTextContent('grid')
    expect(screen.getByRole('button', { name: 'Grid view' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'List view' })).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'List view' }))
    expect(screen.getByTestId('view')).toHaveTextContent('list')
    expect(window.localStorage.getItem('tv-episodes-view')).toBe('list')
    expect(screen.getByRole('group', { name: 'Episode layout' })).toBeInTheDocument()
  })

  it('ignores a stored value that is not a view', () => {
    window.localStorage.setItem('tv-episodes-view', 'carousel')
    render(<Harness />)
    expect(screen.getByTestId('view')).toHaveTextContent('list')
  })
})

describe('SeasonSelector', () => {
  it('lists the seasons and navigates on change', () => {
    render(<SeasonSelector seasons={[{ seasonNumber: 0 }, { seasonNumber: 1 }, { seasonNumber: 2 }, { seasonNumber: 4 }]} current={1} routeKey="Preacher" />)
    const select = screen.getByRole('combobox')
    expect(select).toHaveValue('1')
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Specials', 'Season 1', 'Season 2', 'Season 4'])

    fireEvent.change(select, { target: { value: '2' } })
    expect(mockPush).toHaveBeenCalledWith('/list/tv/Preacher/2')
  })
})

describe('EpisodeActionDialog', () => {
  it('offers Resume and Mark watched, then marks, notifies and closes', async () => {
    const onClose = jest.fn()
    const onMarked = jest.fn()
    render(<EpisodeActionDialog open episode={pilot} onClose={onClose} onMarked={onMarked} />)

    expect(screen.getByText('Episode 1 · Pilot')).toBeInTheDocument()
    expect(screen.getByText('Choose an episode action.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Resume' })).toHaveAttribute('href', PLAY_HREF)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mark watched' }))
    })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(markWatched).toHaveBeenCalledWith(pilot)
    expect(toast.success).toHaveBeenCalledWith('Marked as watched')
    expect(onMarked).toHaveBeenCalledWith(pilot)
  })

  it('hides Mark watched once the episode is watched and offers Watch again', () => {
    render(<EpisodeActionDialog open episode={{ ...pilot, watchHistory: finished }} onClose={jest.fn()} />)
    expect(screen.queryByRole('button', { name: 'Mark watched' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Watch again' })).toHaveAttribute('href', `${PLAY_HREF}?start=0`)
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })

  it('stays open and toasts when marking fails', async () => {
    markWatched.mockRejectedValueOnce(new Error('Runtime unknown'))
    const onClose = jest.fn()
    render(<EpisodeActionDialog open episode={pilot} onClose={onClose} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mark watched' }))
    })
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Runtime unknown'))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Mark watched' })).not.toBeDisabled()
  })

  it('renders nothing without an episode', () => {
    const { container } = render(<EpisodeActionDialog open episode={null} onClose={jest.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('EpisodePageSkeleton', () => {
  const fs = require('fs')
  const path = require('path')
  const EpisodePageSkeleton = require('@components/MediaPages/details/EpisodePageSkeleton').default

  it('announces itself and holds the same frame as the episode page', () => {
    render(<EpisodePageSkeleton />)
    const status = screen.getByRole('status', { name: 'Loading episode' })
    expect(status).toHaveAttribute('aria-busy', 'true')

    // The frame and hero grid must match TVEpisodeDetailsComponent, or the swap reflows
    const page = fs.readFileSync(path.join(process.cwd(), 'src/components/MediaPages/TVEpisodeDetailsComponent.js'), 'utf8')
    const frame = 'media-details-page relative mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6 lg:px-8'
    const heroGrid = 'mt-6 grid gap-6 sm:mt-10 lg:grid-cols-[minmax(0,55fr)_minmax(0,45fr)] lg:gap-x-10'
    expect(status).toHaveClass(...frame.split(' '))
    expect(page).toContain(frame)
    expect(status.querySelector('header')).toHaveClass(...heroGrid.split(' '))
    expect(page).toContain(heroGrid)
  })

  it('is the fallback on the episode route and its view', () => {
    const route = fs.readFileSync(path.join(process.cwd(), 'src/app/(styled)/list/tv/[title]/[season]/[episode]/page.js'), 'utf8')
    const view = fs.readFileSync(path.join(process.cwd(), 'src/components/MediaPages/DynamicPage/views/TVEpisodeDetailsView.js'), 'utf8')
    expect(route).toContain('fallback={<EpisodePageSkeleton />}')
    expect(view).toContain('fallback={<EpisodePageSkeleton />}')
  })
})
