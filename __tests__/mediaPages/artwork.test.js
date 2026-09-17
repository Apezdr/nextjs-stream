/**
 * The artwork viewer: the pure tab builder, the poster button and the
 * dialog (grid, in-use badges, preview with previous/next, full-size link).
 */

import { render, screen, within, fireEvent } from '@testing-library/react'

const mockImages = {
  posters: [
    { file_path: '/de.jpg', width: 2000, height: 3000, iso_639_1: 'de', vote_average: 9 },
    { file_path: '/en-low.jpg', width: 1000, height: 1500, iso_639_1: 'en', vote_average: 4 },
    { file_path: '/used.jpg', width: 2000, height: 3000, iso_639_1: 'en', vote_average: 1 },
    { file_path: '/textless.jpg', width: 2000, height: 3000, iso_639_1: null, vote_average: 8 },
    { file_path: '/en-high.jpg', width: 2000, height: 3000, iso_639_1: 'en', vote_average: 7 },
    { file_path: '/en-high.jpg', width: 2000, height: 3000, iso_639_1: 'en', vote_average: 7 },
  ],
  backdrops: [{ file_path: '/bd.jpg', width: 3840, height: 2160, iso_639_1: null, vote_average: 5 }],
  logos: [],
}

let mockSwrState = { data: mockImages, error: undefined, isLoading: false }
const mockSwr = jest.fn((key) => (key ? mockSwrState : { data: undefined, error: undefined, isLoading: false }))
jest.mock('swr', () => ({ __esModule: true, default: (...args) => mockSwr(...args) }))

const { buildArtworkTabs, tmdbFileName, artworkInUse } = require('@src/utils/media/artwork')
const ArtworkViewer = require('@components/MediaPages/details/ArtworkViewer').default
const ArtworkButton = require('@components/MediaPages/details/ArtworkButton').default

const inUse = {
  poster: { path: 'https://image.tmdb.org/t/p/original/used.jpg', url: 'https://files.example.com/movies/X/poster.jpg' },
  backdrop: { path: '/not-in-the-list.jpg', url: 'https://files.example.com/movies/X/backdrop.jpg' },
  logo: { path: null, url: null },
}

beforeEach(() => {
  mockSwrState = { data: mockImages, error: undefined, isLoading: false }
  mockSwr.mockClear()
})

describe('buildArtworkTabs', () => {
  it('reads the file name out of a path or a sized URL', () => {
    expect(tmdbFileName('/abc.jpg')).toBe('/abc.jpg')
    expect(tmdbFileName('https://image.tmdb.org/t/p/w342/abc.png?x=1')).toBe('/abc.png')
    expect(tmdbFileName(null)).toBeNull()
    expect(tmdbFileName('nope')).toBeNull()
  })

  it('pins the in-use image, then English, textless and other languages by rating, without repeats', () => {
    const [posters] = buildArtworkTabs({ images: mockImages, inUse })
    expect(posters.id).toBe('posters')
    expect(posters.items.map((i) => i.key)).toEqual(['/used.jpg', '/en-high.jpg', '/en-low.jpg', '/textless.jpg', '/de.jpg'])
    expect(posters.items[0]).toMatchObject({
      inUse: true,
      badge: 'In use',
      thumb: 'https://image.tmdb.org/t/p/w342/used.jpg',
      preview: 'https://image.tmdb.org/t/p/w780/used.jpg',
      full: 'https://image.tmdb.org/t/p/original/used.jpg',
    })
    expect(posters.items[1].badge).toBeNull()
  })

  it('gives an in-use image TMDB does not list a tile of its own, and drops empty tabs', () => {
    const tabs = buildArtworkTabs({ images: mockImages, inUse })
    expect(tabs.map((t) => t.id)).toEqual(['posters', 'backdrops'])
    const backdrops = tabs[1].items
    expect(backdrops[0]).toMatchObject({ inUse: true, badge: 'In use · custom', full: inUse.backdrop.url })
    expect(backdrops[1].key).toBe('/bd.jpg')
  })

  it('still answers "what is in use" when the list never loads, with the caller\'s label', () => {
    const tabs = buildArtworkTabs({ images: undefined, inUse: { poster: { path: '/s1.jpg', url: 'https://files.example.com/s1.jpg', label: 'This season' } } })
    expect(tabs).toHaveLength(1)
    expect(tabs[0].items).toHaveLength(1)
    expect(tabs[0].items[0].badge).toBe('This season')
    expect(buildArtworkTabs()).toEqual([])
  })

  it('maps a record to its in-use images', () => {
    expect(artworkInUse({ posterURL: 'p', backdrop: 'b', logo: null, metadata: { poster_path: '/p.jpg' } })).toEqual({
      poster: { path: '/p.jpg', url: 'p' },
      backdrop: { path: null, url: 'b' },
      logo: { path: null, url: null },
    })
    expect(artworkInUse(null).poster).toEqual({ path: null, url: null })
  })
})

describe('ArtworkViewer', () => {
  const open = (props = {}) => render(<ArtworkViewer open onClose={jest.fn()} title="Supergirl" tmdbId={123} type="movie" inUse={inUse} {...props} />)

  it('fetches only while open, through the TMDB proxy', () => {
    render(<ArtworkViewer open={false} onClose={jest.fn()} title="Supergirl" tmdbId={123} type="movie" />)
    expect(mockSwr.mock.calls.at(-1)[0]).toBeNull()
    open()
    expect(mockSwr.mock.calls.at(-1)[0]).toBe('/api/authenticated/tmdb/images/movie?tmdb_id=123')
  })

  it('shows tabs with counts, badges the in-use tile and marks other languages', async () => {
    open()
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('tab', { name: /Posters · 5/ })).toHaveAttribute('aria-selected', 'true')
    expect(within(dialog).getByRole('tab', { name: /Backdrops · 2/ })).toBeInTheDocument()
    expect(within(dialog).queryByRole('tab', { name: /Logos/ })).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Poster 1, In use' })).toBeInTheDocument()
    expect(within(dialog).getByText('de')).toBeInTheDocument()
  })

  it('previews a tile with previous/next and a full-size link, and steps back to the grid', async () => {
    open()
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Poster 2' }))
    expect(within(dialog).getByText('2 of 5')).toBeInTheDocument()
    expect(within(dialog).getByText(/2000 × 3000/)).toBeInTheDocument()
    const full = within(dialog).getByRole('link', { name: /Open full size/ })
    expect(full).toHaveAttribute('href', 'https://image.tmdb.org/t/p/original/en-high.jpg')
    expect(full).toHaveAttribute('target', '_blank')

    fireEvent.click(within(dialog).getByRole('button', { name: /Previous/ }))
    expect(within(dialog).getByText('1 of 5')).toBeInTheDocument()
    expect(within(dialog).getByText('In use')).toBeInTheDocument()
    fireEvent.keyDown(within(dialog).getByText('1 of 5'), { key: 'ArrowLeft' })
    expect(within(dialog).getByText('5 of 5')).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: /All posters/ }))
    expect(within(dialog).getByRole('button', { name: 'Poster 1, In use' })).toBeInTheDocument()
  })

  it('offers the custom in-use image full size too', async () => {
    open({ initialTab: 'backdrops' })
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Backdrop 1, In use · custom' }))
    expect(within(dialog).getByRole('link', { name: /Open full size/ })).toHaveAttribute('href', inUse.backdrop.url)
  })

  it('falls back to what the title uses when the list fails, and says so', async () => {
    mockSwrState = { data: undefined, error: new Error('nope'), isLoading: false }
    open()
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/could not be loaded/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Poster 1, In use · custom' })).toBeInTheDocument()
  })

  it('shows a loading grid while the list is on its way', async () => {
    mockSwrState = { data: undefined, error: undefined, isLoading: true }
    open({ inUse: {} })
    expect(await screen.findByRole('status', { name: 'Loading artwork' })).toBeInTheDocument()
  })
})

describe('ArtworkButton', () => {
  it('wraps the poster in a labelled button', () => {
    render(
      <ArtworkButton title="Supergirl" tmdbId={123} type="movie" className="sm:row-span-2">
        <span>poster</span>
      </ArtworkButton>
    )
    const button = screen.getByRole('button', { name: 'View artwork for Supergirl' })
    expect(button).toHaveClass('sm:row-span-2', 'self-start')
    expect(button).toHaveAttribute('aria-haspopup', 'dialog')
    expect(within(button).getByText('poster')).toBeInTheDocument()
  })

  it('leaves the poster alone when there is nothing to show', () => {
    render(
      <ArtworkButton title="Unknown" tmdbId={null} type="movie" inUse={{ poster: { path: null, url: null } }}>
        <span>poster</span>
      </ArtworkButton>
    )
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('poster')).toBeInTheDocument()
  })
})
