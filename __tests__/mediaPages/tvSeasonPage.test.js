/**
 * Render smoke tests for the season info page.
 *
 * The page is an async server component: it loads the season with its
 * episodes and the viewer's history (mocked), picks the season's next-up
 * episode, and renders the hero, the episode rows with live progress, the
 * season selector, the view toggle and the action dialog.
 */

import { render, screen, within, fireEvent } from '@testing-library/react'

jest.mock('react', () => ({
  ...jest.requireActual('react'),
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

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: jest.fn() }),
}))

jest.mock('react-toastify', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}))

jest.mock('@components/WatchProgress/markWatched', () => ({
  markWatched: jest.fn().mockResolvedValue({ playbackTime: 2940 }),
  PLAYBACK_POSITION_KEY: (u) => u,
}))

jest.mock('@src/utils/flatDatabaseUtils', () => ({
  getFlatTVSeasonWithEpisodes: jest.fn(),
}))

jest.mock('@src/utils/actions/refreshEpisodes', () => ({
  refreshEpisodes: jest.fn(),
}))

const mockHistory = {}
jest.mock('@src/utils/watchHistoryUtils', () => ({
  createWatchHistoryLookupMap: jest.fn(async () => new Map()),
  addWatchHistoryToItemsBounded: jest.fn(async (items) =>
    items.map((item) => ({
      ...item,
      watchHistory: mockHistory[item.mediaId] || { playbackTime: 0, lastWatched: null, isWatched: false, completed: false, progressPercent: 0 },
    }))
  ),
}))

const { getFlatTVSeasonWithEpisodes } = require('@src/utils/flatDatabaseUtils')
const TVEpisodesListComponent = require('@components/MediaPages/TVEpisodesListComponent').default

const episode = (e, title, extra = {}) => ({
  _id: `e1${e}`,
  showId: 'show1',
  seasonId: 'season1',
  seasonNumber: 1,
  episodeNumber: e,
  title,
  showTitle: 'Preacher',
  mediaId: `mid:abc:s01e0${e}`,
  normalizedVideoId: `n1${e}`,
  videoURL: `https://files.example.com/tv/Preacher/Season%201/S01E0${e}.mp4`,
  duration: 2_940_000,
  dimensions: '1920x1080',
  hdr: '10-bit SDR (BT.709)',
  thumbnail: `https://files.example.com/tv/Preacher/Season%201/0${e}%20-%20Thumbnail.jpg`,
  thumbnailBlurhash: 'CCCC',
  metadata: { name: title, runtime: 49 },
  ...extra,
})

const season = {
  _id: 'season1',
  showId: 'show1',
  showTitle: 'Preacher',
  seasonNumber: 1,
  title: 'Season 1',
  episodeCount: 3,
  airDate: '2016-05-22',
  overview: 'Synced season overview',
  posterURL: 'https://files.example.com/tv/Preacher/Season%201/season_poster.jpg',
  posterBlurhash: 'BBBB',
  metadata: {
    air_date: '2016-05-22',
    name: 'Season 1',
    overview: 'Jesse Custer returns home to West Texas to take over his dad\'s church.',
    vote_average: 7.7,
    episode_count: 10,
    tvOverview: 'A preacher sets out to make the Almighty confess his sin of abandoning the world.',
  },
  showSummary: {
    id: 'show1',
    title: 'Preacher',
    originalTitle: 'Preacher',
    name: 'Preacher',
    overview: 'A preacher sets out to make the Almighty confess his sin of abandoning the world.',
    posterURL: 'https://files.example.com/tv/Preacher/show_poster.jpg',
    posterBlurhash: 'AAAA',
    tmdbId: 66992,
  },
  siblingSeasons: [
    { seasonNumber: 1, title: 'Season 1', episodeCount: 10, visibleEpisodeCount: 3 },
    { seasonNumber: 2, title: 'Season 2', episodeCount: 13, visibleEpisodeCount: 13 },
    { seasonNumber: 4, title: 'Season 4', episodeCount: 10, visibleEpisodeCount: 0 },
  ],
  episodes: [
    episode(1, 'Pilot', {
      duration: 3_841_000,
      metadata: { name: 'Pilot', runtime: 64, overview: 'Jesse struggles to escape a past that is slowly catching up to him.' },
      captionURLs: { English: { srcLang: 'en', url: 'https://x/en.srt' } },
    }),
    episode(2, 'See', { thumbnail: null, thumbnailBlurhash: null }),
    episode(3, 'The Possibilities', { duration: 2_520_000, metadata: { name: 'The Possibilities', runtime: 42, overview: 'Jesse tests his new power.' } }),
  ],
}

async function renderSeason(props = {}) {
  const ui = await TVEpisodesListComponent({ showTitle: 'Preacher', originalTitle: 'Preacher', seasonNumber: '1', userId: 'u1', ...props })
  return render(ui)
}

beforeEach(() => {
  for (const key of Object.keys(mockHistory)) delete mockHistory[key]
  mockPush.mockReset()
  getFlatTVSeasonWithEpisodes.mockReset().mockResolvedValue(season)
})

describe('TVEpisodesListComponent', () => {
  it('composes the hero around the season\'s next-up episode and lists every episode with its state', async () => {
    mockHistory['mid:abc:s01e01'] = { playbackTime: 509, lastWatched: '2026-09-01T20:00:00.000Z', isWatched: true, completed: false, progressPercent: 13.3 }
    mockHistory['mid:abc:s01e03'] = { playbackTime: 2900, lastWatched: '2026-08-01T20:00:00.000Z', isWatched: true, completed: true, progressPercent: 98.6 }
    await renderSeason()

    expect(getFlatTVSeasonWithEpisodes).toHaveBeenCalledWith({ showTitle: 'Preacher', seasonNumber: 1 })

    // Trail and eyebrow lead back to the show
    expect(screen.getByRole('link', { name: 'TV' })).toHaveAttribute('href', '/list/tv')
    expect(screen.getAllByRole('link', { name: 'Preacher' }).every((a) => a.getAttribute('href') === '/list/tv/Preacher')).toBe(true)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Season 1')
    expect(screen.getByText('2016')).toBeInTheDocument()
    expect(screen.getByText('3 episodes')).toBeInTheDocument()
    expect(screen.getAllByText('1080p').length).toBeGreaterThan(0)
    expect(screen.getByText(season.metadata.overview)).toBeInTheDocument()
    expect(screen.getByText('More about this season')).toBeInTheDocument()
    expect(screen.getByText(season.metadata.tvOverview)).toBeInTheDocument()
    expect(screen.getByAltText('Preacher Season 1 poster')).toHaveAttribute('src', season.posterURL)

    // Next-up in this season is the in-progress pilot
    expect(screen.getByRole('link', { name: /Resume Episode 1/ })).toHaveAttribute('href', '/list/tv/Preacher/1/1/play')
    expect(screen.getByRole('link', { name: /Episode details/ })).toHaveAttribute('href', '/list/tv/Preacher/1/1')

    // Rows: title links, synopsis or its placeholder, state, chips, runtime, actions
    expect(screen.getByRole('link', { name: '1. Pilot' })).toHaveAttribute('href', '/list/tv/Preacher/1/1')
    expect(screen.getByRole('link', { name: '2. See' })).toHaveAttribute('href', '/list/tv/Preacher/1/2')
    expect(screen.getByText('Jesse struggles to escape a past that is slowly catching up to him.')).toBeInTheDocument()
    expect(screen.getByText('Episode synopsis will appear here.')).toBeInTheDocument()
    expect(screen.getByText(/^In progress · /)).toBeInTheDocument()
    expect(screen.getByText('Not watched')).toBeInTheDocument()
    expect(screen.getByText('Watched')).toBeInTheDocument()
    expect(screen.getByText('CC')).toBeInTheDocument()
    expect(screen.getByText('1h 4m')).toBeInTheDocument()
    expect(screen.getByText('49m')).toBeInTheDocument()
    expect(screen.getByText('42m')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Episode actions' })).toHaveLength(3)

    // Season selector offers the seasons with visible episodes; the toggle starts on the list
    const select = screen.getByRole('combobox')
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Season 1', 'Season 2'])
    expect(select).toHaveValue('1')
    expect(screen.getByRole('button', { name: 'List view' })).toHaveAttribute('aria-pressed', 'true')

    // Where the files live is not a viewer's business
    expect(document.body.textContent).not.toMatch(/files\.example\.com/)
  })

  it('opens the action dialog for a row and offers to mark it watched', async () => {
    await renderSeason()
    fireEvent.click(screen.getAllByRole('button', { name: 'Episode actions' })[1])

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Episode 2 · See')).toBeInTheDocument()
    expect(within(dialog).getByText('Choose an episode action.')).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: /^play$/i })).toHaveAttribute('href', '/list/tv/Preacher/1/2/play')
    expect(within(dialog).getByRole('button', { name: 'Mark watched' })).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('switches seasons through the selector', async () => {
    await renderSeason()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '2' } })
    expect(mockPush).toHaveBeenCalledWith('/list/tv/Preacher/2', { scroll: false })
  })

  it('says so when the season is not in the library', async () => {
    getFlatTVSeasonWithEpisodes.mockResolvedValue(null)
    await renderSeason({ seasonNumber: '7' })
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent("We don't have Season 7 of Preacher")
  })
})
