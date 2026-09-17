/**
 * Render smoke tests for the show info page.
 *
 * The page is an async server component: it loads the show, the light
 * episode list and the viewer's history (all mocked here), picks the
 * next-up episode, merges TMDB's seasons with the library's, and renders
 * the hero, the seasons grid, the cast rail and the facts panel. The client
 * islands (primary button, watchlist button, next-up line, cast rail) render
 * with their network hooks mocked.
 */

import { render, screen, within } from '@testing-library/react'
import fs from 'fs'
import path from 'path'

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

jest.mock('react-toastify', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}))

jest.mock('@src/utils/flatDatabaseUtils', () => ({
  getFlatRequestedMedia: jest.fn(),
  getFlatShowEpisodesForProgress: jest.fn(),
}))

// The viewer's history, keyed by the durable episode identity
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

const { getFlatRequestedMedia, getFlatShowEpisodesForProgress } = require('@src/utils/flatDatabaseUtils')
const TVShowSeasonsList = require('@components/MediaPages/TVShowSeasonsListComponent').default

const tmdbSeason = (n, name, episode_count, air_date) => ({ season_number: n, name, episode_count, air_date, overview: '', poster_path: `/s${n}.jpg` })
const librarySeason = (n, episodeCount, airDate) => ({
  _id: `season${n}`,
  showId: 'show1',
  seasonNumber: n,
  title: `Season ${n}`,
  episodeCount,
  airDate,
  posterURL: `https://files.example.com/tv/Preacher/Season%20${n}/season_poster.jpg`,
  posterBlurhash: 'BBBB',
  metadata: { air_date: airDate, episode_count: episodeCount, name: `Season ${n}` },
})

const preacher = {
  _id: 'show1',
  title: 'Preacher',
  originalTitle: 'Preacher',
  posterURL: 'https://files.example.com/tv/Preacher/show_poster.jpg',
  posterBlurhash: 'AAAA',
  overview: 'Synced overview',
  seasons: [librarySeason(1, 10, '2016-05-22'), librarySeason(2, 13, '2017-06-25'), librarySeason(4, 10, '2019-08-04')],
  metadata: {
    id: 66992,
    name: 'Preacher',
    overview: 'A preacher sets out to make the Almighty confess his sin of abandoning the world.',
    type: 'Scripted',
    status: 'Ended',
    first_air_date: '2016-05-22',
    last_air_date: '2019-09-29',
    number_of_seasons: 4,
    number_of_episodes: 43,
    genres: [{ name: 'Drama' }, { name: 'Fantasy' }, { name: 'Mystery' }],
    networks: [{ name: 'AMC' }],
    created_by: [{ name: 'Sam Catlin' }, { name: 'Evan Goldberg' }, { name: 'Seth Rogen' }],
    original_language: 'en',
    production_countries: [{ name: 'United States of America' }],
    vote_average: 7.451,
    vote_count: 1200,
    homepage: 'https://www.sonypictures.com/tv/preacher',
    seasons: [
      tmdbSeason(0, 'Specials', 18, '2016-05-22'),
      tmdbSeason(1, 'Season 1', 10, '2016-05-22'),
      tmdbSeason(2, 'Season 2', 13, '2017-06-25'),
      tmdbSeason(3, 'Season 3', 10, '2018-06-24'),
      tmdbSeason(4, 'Season 4', 10, '2019-08-04'),
    ],
    cast: [
      { id: 1, name: 'Dominic Cooper', character: 'Jesse Custer', profile_path: 'https://image.tmdb.org/t/p/original/dc.jpg' },
      { id: 2, name: 'Ruth Negga', character: "Tulip O'Hare", profile_path: null },
    ],
  },
}

const episode = (n, e, title, extra = {}) => ({
  _id: `e${n}${e}`,
  seasonId: `season${n}`,
  seasonNumber: n,
  episodeNumber: e,
  title,
  mediaId: `mid:abc:s0${n}e0${e}`,
  videoURL: `https://files.example.com/tv/Preacher/S0${n}E0${e}.mp4`,
  jitUrl: null,
  normalizedVideoId: `n${n}${e}`,
  duration: 2_940_000,
  dimensions: '1920x1080',
  hdr: null,
  metadata: { runtime: 49, name: title },
  ...extra,
})
const episodes = [
  episode(1, 1, 'Pilot', { duration: 3_841_000, metadata: { runtime: 64, name: 'Pilot' } }),
  episode(1, 2, 'See'),
  episode(2, 1, 'On the Road'),
  episode(4, 1, 'Masada'),
]

async function renderShow(props = {}) {
  const ui = await TVShowSeasonsList({ showTitle: 'Preacher', show: preacher, userId: 'u1', ...props })
  return render(ui)
}

beforeEach(() => {
  for (const key of Object.keys(mockHistory)) delete mockHistory[key]
  getFlatRequestedMedia.mockReset()
  getFlatShowEpisodesForProgress.mockReset().mockResolvedValue(episodes)
})

describe('TVShowSeasonsList', () => {
  it('composes the hero, the seasons grid, the cast and the facts around the viewer\'s next-up episode', async () => {
    mockHistory['mid:abc:s01e01'] = { playbackTime: 509, lastWatched: '2026-09-01T20:00:00.000Z', isWatched: true, completed: false, progressPercent: 13.3 }
    await renderShow()

    // The route already fetched the show; nothing is refetched
    expect(getFlatRequestedMedia).not.toHaveBeenCalled()
    expect(getFlatShowEpisodesForProgress).toHaveBeenCalledWith('show1')

    expect(screen.getByRole('link', { name: 'TV' })).toHaveAttribute('href', '/list/tv')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Preacher')
    expect(screen.getByText('AMC · Series')).toBeInTheDocument()
    expect(screen.getByText('2016–2019')).toBeInTheDocument()
    expect(screen.getByText('Drama / Fantasy / Mystery')).toBeInTheDocument()
    expect(screen.getByText('Ended')).toBeInTheDocument()
    expect(screen.getByText(preacher.metadata.overview)).toBeInTheDocument()
    expect(screen.getByAltText('Preacher poster')).toHaveAttribute('src', preacher.posterURL)

    // Next-up: the in-progress pilot, resumed, with its position under the buttons
    expect(screen.getByRole('link', { name: /Resume S1 · E1/ })).toHaveAttribute('href', '/list/tv/Preacher/1/1/play')
    expect(screen.getByText(/^Pilot · 8:29 watched/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /my list/i })).toBeInTheDocument()

    // Seasons: TMDB's four merged with the library's three; specials dropped
    expect(screen.getByText('3 of 4 seasons available')).toBeInTheDocument()
    expect(screen.getByText('Season 1 in progress')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^Season 1, 2016 · 2 episodes available, Continue Episode 1$/ })).toHaveAttribute('href', '/list/tv/Preacher/1')
    expect(screen.getByRole('link', { name: /^Season 2, /, exact: false })).toHaveAttribute('href', '/list/tv/Preacher/2')
    expect(screen.getByText('Missing from your library')).toBeInTheDocument()
    expect(screen.getByText('Not available')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^Season 3/ })).toBeNull()
    expect(screen.getAllByText('Not started')).toHaveLength(2)
    expect(screen.queryByText(/Specials/)).toBeNull()

    // Series regulars, not the guest-star-padded list
    expect(screen.getByRole('heading', { name: /^Cast/ })).toBeInTheDocument()
    expect(screen.getByText('Dominic Cooper')).toBeInTheDocument()

    // Show facts
    const panel = screen.getByRole('heading', { name: 'Show details' }).closest('section')
    const rows = within(panel).getAllByRole('term').map((dt) => dt.textContent)
    expect(rows).toEqual(['Created by', 'Network', 'Language', 'Country', 'First aired', 'Last aired', 'Episodes', 'TMDB score', 'Links'])
    expect(within(panel).getByText('Sam Catlin, Evan Goldberg, Seth Rogen')).toBeInTheDocument()
    expect(within(panel).getByText('43 · 4 in your library')).toBeInTheDocument()
    expect(within(panel).getByRole('link', { name: 'TMDB' })).toHaveAttribute('href', 'https://www.themoviedb.org/tv/66992')

    // Where the files live is not a viewer's business
    expect(document.body.textContent).not.toMatch(/files\.example\.com/)
  })

  it('starts a fresh viewer at the first episode and marks every season not started', async () => {
    await renderShow({ userId: null })

    expect(screen.getByRole('link', { name: /Play S1 · E1/ })).toHaveAttribute('href', '/list/tv/Preacher/1/1/play')
    expect(screen.getByText('Pilot')).toBeInTheDocument()
    expect(screen.queryByText(/in progress$/)).toBeNull()
    expect(screen.getAllByText('Not started')).toHaveLength(3)
  })

  it('fetches the show by title when the route did not hand one down, and copes with an empty library', async () => {
    getFlatRequestedMedia.mockResolvedValue({ ...preacher, seasons: [], metadata: { ...preacher.metadata, seasons: undefined, number_of_seasons: undefined } })
    getFlatShowEpisodesForProgress.mockResolvedValue([])
    await renderShow({ show: null })

    expect(getFlatRequestedMedia).toHaveBeenCalledWith({ type: 'tv', title: 'Preacher' })
    expect(screen.getByText('No seasons in your library yet.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /S1 · E1/ })).toBeNull()
  })

  it('says so when the show is not in the library', async () => {
    getFlatRequestedMedia.mockResolvedValue(null)
    await renderShow({ show: null })
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent("We don't have Preacher")
    expect(screen.getByRole('link', { name: 'Back to TV' })).toHaveAttribute('href', '/list/tv')
  })
})

describe('the show route', () => {
  it('keys its cached subtree on the viewer and hands the show down', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/app/(styled)/list/tv/[title]/page.js'), 'utf8')
    expect(source).toMatch(/TVShowContent\(\{[^)]*userId/)
    expect(source).toMatch(/user-watch-history-\$\{userId/)
    expect(source).toMatch(/<TVShowView[^>]*media=\{result\.media\}[^>]*userId=\{userId\}/)
  })
})
