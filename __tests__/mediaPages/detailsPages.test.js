/**
 * Render smoke tests for the redesigned movie and episode info pages.
 *
 * The pages are server components with async children (the collection card
 * and the watched-by row) and client islands (action row, sticky bar, cast
 * rail). Those async pieces and the network hooks are mocked here; what is
 * under test is that the page composes its real data into the hero, the
 * meta line, the actions and the details panel without throwing.
 */

import { render, screen, within } from '@testing-library/react'

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
}))

jest.mock('swr/mutation', () => ({
  __esModule: true,
  default: () => ({ trigger: jest.fn(), isMutating: false }),
}))

jest.mock('@src/lib/auth-client', () => ({
  authClient: { useSession: () => ({ data: { user: { id: 'u1', role: 'user' } }, isPending: false }) },
}))

jest.mock('@components/MediaPages/details/CollectionCard', () => ({
  __esModule: true,
  default: ({ collection, currentOriginalTitle }) => (
    <div data-testid="collection-card">
      {collection.name} / {currentOriginalTitle}
    </div>
  ),
}))

jest.mock('@components/MediaPages/ViewCount', () => ({
  __esModule: true,
  default: () => null,
  WatchedByRow: ({ normalizedVideoId }) => (
    <>
      <dt>Watched by</dt>
      <dd data-testid="watched-by">{normalizedVideoId}</dd>
    </>
  ),
}))

jest.mock('react-dom', () => ({
  ...jest.requireActual('react-dom'),
  createPortal: (node) => node,
}))

const MovieDetailsComponent = require('@components/MediaPages/MovieDetailsComponent').default
const TVEpisodeDetailsComponent = require('@components/MediaPages/TVEpisodeDetailsComponent').default

const hobbit = {
  _id: '6a4fa5565bd6dc41316dda7f',
  title: 'The Hobbit: An Unexpected Journey',
  originalTitle: 'The Hobbit An Unexpected Journey',
  type: 'movie',
  posterURL: 'https://files.example.com/movies/The%20Hobbit/poster.jpg',
  posterBlurhash: 'AAAA',
  videoURL: 'https://files.example.com/movies/The%20Hobbit/movie.mp4',
  normalizedVideoId: '6a63359ffa2aa04e',
  mediaId: 'mid:eac02008f5a84746',
  duration: 10_949_000,
  dimensions: '3840x2160',
  hdr: 'Dolby Vision',
  size: 61_000_000_000,
  primaryContainer: 'mkv',
  videoSource: 'default',
  mediaLastModified: '2025-04-22T21:41:23.822Z',
  mediaQuality: { format: 'Dolby Vision', bitDepth: 10, viewingExperience: { dolbyVision: true, standardHDR: true } },
  captionURLs: { English: { srcLang: 'en', url: 'https://x/en.srt' } },
  sources: [{ container: 'mkv', videoCodec: 'hevc', pixFmt: 'yuv420p10le', audioTrackCount: 2, audioLanguages: ['eng'], isPrimary: true }],
  cast: [
    { id: 1, name: 'Martin Freeman', character: 'Bilbo', profile_path: '/mf.jpg' },
    { id: 2, name: 'Ian McKellen', character: 'Gandalf', profile_path: null },
  ],
  metadata: {
    id: 49051,
    release_date: '2012-12-12T00:00:00.000Z',
    rating: 'PG-13',
    genres: [{ name: 'Adventure' }, { name: 'Fantasy' }],
    tagline: 'From the smallest beginnings come the greatest legends.',
    overview: 'Bilbo Baggins is swept into a quest to reclaim the lost Dwarf Kingdom of Erebor.',
    trailer_url: 'https://www.youtube.com/watch?v=abc',
    original_language: 'en',
    production_companies: [{ name: 'New Line Cinema' }],
    production_countries: [{ name: 'New Zealand' }],
    belongs_to_collection: { id: 121938, name: 'The Hobbit Collection', poster_path: '/p.jpg' },
    vote_average: 7.3,
  },
}

const countdown = {
  _id: '6a550c58025dd5c7f7266e71',
  title: 'Countdown',
  showTitle: '3 Body Problem',
  originalTitle: '3 Body Problem',
  showMediaId: '6a550c57025dd5c7f7266e55',
  showTmdbId: 108545,
  seasonNumber: 1,
  episodeNumber: 1,
  type: 'tv',
  posterURL: 'https://files.example.com/tv/3BP/season1/poster.jpg',
  videoURL: 'https://files.example.com/tv/3BP/S01E01.mp4',
  normalizedVideoId: 'abc123',
  mediaId: 'mid:0123456789abcdef',
  duration: 3_635_199,
  dimensions: '3840x2160',
  hdr: 'HDR10',
  size: 5_366_482_273,
  primaryContainer: 'mp4',
  videoSource: 'server9',
  mediaLastModified: '2025-08-11T03:29:22.482Z',
  mediaQuality: { format: 'HDR10', bitDepth: 10, viewingExperience: { standardHDR: true } },
  captionURLs: { Spanish: { srcLang: 'es', url: 'https://x/es.srt' } },
  sources: [{ container: 'mp4', videoCodec: 'hevc', pixFmt: 'yuv420p10le', audioTrackCount: 2, audioLanguages: ['eng'] }],
  cast: [{ id: 10, name: 'Jovan Adepo', character: 'Saul Durand', profile_path: '/ja.jpg' }],
  metadata: {
    name: 'Countdown',
    air_date: '2024-03-21',
    episode_type: 'finale',
    runtime: 61,
    rating: 'TV-MA',
    overview: 'A young scientist finds a countdown only she can see.',
    genres: [{ name: 'Sci-Fi & Fantasy' }, { name: 'Drama' }],
    networks: [{ name: 'Netflix' }],
    original_language: 'en',
    trailer_url: 'https://www.youtube.com/watch?v=xyz',
    guest_stars: [{ id: 20, name: 'Guest One', character: 'Scientist', profile_path: null }],
    crew: [
      { job: 'Director', name: 'Derek Tsang Kwok-Cheung' },
      { job: 'Writer', name: 'David Benioff' },
    ],
  },
}

describe('MovieDetailsComponent', () => {
  it('composes the hero, actions, progress hooks and details from the document', () => {
    render(<MovieDetailsComponent media={hobbit} />)

    // Title split on the colon
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('The Hobbit')
    expect(screen.getByText('An Unexpected Journey')).toBeInTheDocument()

    // Eyebrow, meta line and chips
    expect(screen.getByText('Adventure · Fantasy')).toBeInTheDocument()
    expect(screen.getByText('2012')).toBeInTheDocument()
    expect(screen.getByText('3h 2m')).toBeInTheDocument()
    expect(screen.getByText('PG-13')).toBeInTheDocument()
    expect(screen.getAllByText('4K').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Dolby Vision').length).toBeGreaterThan(0)

    // Chrome
    expect(screen.getByRole('link', { name: /back to movies/i })).toHaveAttribute('href', '/list/movie')
    expect(screen.queryByText('Edit movie')).not.toBeInTheDocument() // not an admin

    // One primary button, saying Play until the position is known; trailer + list beside it
    const play = screen.getAllByRole('link', { name: /^play$/i })
    expect(play[0]).toHaveAttribute('href', '/list/movie/The%20Hobbit%20An%20Unexpected%20Journey/play')
    expect(screen.getByRole('link', { name: /trailer/i })).toHaveAttribute('href', 'https://www.youtube.com/watch?v=abc')
    expect(screen.getByRole('button', { name: /my list/i })).toBeInTheDocument()

    // No progress panel until a position exists
    expect(screen.queryByTestId('watch-progress-panel')).not.toBeInTheDocument()

    // Sticky bar is rendered (hidden) with the headline
    const bar = screen.getByTestId('sticky-title-bar')
    expect(bar).toHaveAttribute('aria-hidden', 'true')
    expect(within(bar).getByText(/The Hobbit/)).toBeInTheDocument()

    // Cast rail with a fallback monogram for the missing photo
    expect(screen.getByRole('heading', { name: /^Cast/ })).toBeInTheDocument()
    expect(screen.getByText('Martin Freeman')).toBeInTheDocument()
    expect(screen.getByText('IM')).toBeInTheDocument()

    // Collection card gets the identity it needs to mark the current film
    expect(screen.getByTestId('collection-card')).toHaveTextContent('The Hobbit Collection / The Hobbit An Unexpected Journey')

    // Details panel: catalog facts, file facts, source host and watched-by row
    const panel = screen.getByRole('heading', { name: 'Movie details' }).closest('section')
    const rows = within(panel).getAllByRole('term').map((dt) => dt.textContent)
    expect(rows).toEqual(['Language', 'Studio', 'Country', 'Released', 'TMDB score', 'Resolution', 'Video', 'Dynamic range', 'Audio', 'Subtitles', 'File', 'Added', 'Watched by'])
    expect(within(panel).getByText('3840 × 2160 (4K)')).toBeInTheDocument()
    expect(within(panel).getByText('HEVC (H.265) · 10-bit')).toBeInTheDocument()
    expect(within(panel).getByText('MKV · 56.81 GB')).toBeInTheDocument()
    expect(within(panel).queryByText(/adamdrumm|example.com/)).not.toBeInTheDocument()
    expect(screen.getByTestId('watched-by')).toHaveTextContent('6a63359ffa2aa04e')
  })

  it('renders a bare document without crashing', () => {
    render(<MovieDetailsComponent media={{ _id: 'x', title: 'Untitled', originalTitle: 'Untitled' }} />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Untitled')
    expect(screen.queryByTestId('collection-card')).not.toBeInTheDocument()
    // Nothing is known about the file, so there is no panel to show
    expect(screen.queryByRole('heading', { name: 'Movie details' })).not.toBeInTheDocument()
  })
})

describe('TVEpisodeDetailsComponent', () => {
  it('composes the episode page with the show as the eyebrow and the code on the meta line', () => {
    render(<TVEpisodeDetailsComponent media={countdown} />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Countdown')
    expect(screen.getByText(/3 Body Problem/, { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByText('S01E01')).toBeInTheDocument()
    expect(screen.getByText('Mar 21, 2024')).toBeInTheDocument()
    expect(screen.getByText('1h 1m')).toBeInTheDocument()
    expect(screen.getByText('TV-MA')).toBeInTheDocument()
    expect(screen.getByText('Season finale')).toBeInTheDocument()

    expect(screen.getByRole('link', { name: /3 Body Problem · Season 1/ })).toHaveAttribute('href', '/list/tv/3%20Body%20Problem/1')
    expect(screen.getAllByRole('link', { name: /^play$/i })[0]).toHaveAttribute('href', '/list/tv/3%20Body%20Problem/1/1/play')

    // Guest stars and cast are separate rails
    expect(screen.getByRole('heading', { name: /^Guest stars/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /^Cast/ })).toBeInTheDocument()

    const panel = screen.getByRole('heading', { name: 'Episode details' }).closest('section')
    const rows = within(panel).getAllByRole('term').map((dt) => dt.textContent)
    expect(rows.slice(0, 4)).toEqual(['Director', 'Writer', 'Network', 'Language'])
    expect(within(panel).getByText('Derek Tsang Kwok-Cheung')).toBeInTheDocument()
    expect(rows).toContain('Watched by')
  })
})
