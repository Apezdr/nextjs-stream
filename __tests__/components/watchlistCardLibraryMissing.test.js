/**
 * A list keeps a title with no TMDB id after it leaves the library. Its card
 * says so, shows the poster blurhash the item stored (the poster file went
 * with the title, and there is no TMDB entry), and offers only what still
 * applies: no details to open, no Coming Soon and no Radarr/Sonarr (both are
 * kept by TMDB id), but it can still be removed.
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import WatchlistCard from '@src/components/Watchlist/WatchlistCard'

jest.mock('react-toastify', () => ({ toast: { success: jest.fn(), error: jest.fn(), warn: jest.fn() } }))
jest.mock('@src/contexts/NavigationContext', () => ({
  useNavigation: () => ({ navigate: jest.fn(), isNavigating: false, targetUrl: null }),
}))

const click = (element) => act(() => fireEvent.click(element))

const removed = {
  id: 'w1',
  tmdbId: null,
  libraryMediaId: 'mid:e31a15704f374ca9',
  libraryMissing: true,
  mediaType: 'movie',
  title: 'Sintel',
  releaseDate: '2010-09-30',
  posterURL: '/sorry-image-not-available.jpg',
  posterBlurhash: 'iVBORw0KGgo',
  dateAdded: '2026-11-01T00:00:00.000Z',
}
// A TMDB title the library doesn't have: the state these cards already had
const wanted = { id: 'w2', tmdbId: 920, mediaType: 'movie', title: 'Cars', posterURL: 'https://image.tmdb.org/t/p/w500/cars.jpg', dateAdded: '2026-11-01T00:00:00.000Z' }

const admin = { id: 'u1', role: 'admin' }
const arr = {
  arrStatus: { state: 'absent' },
  arrPermissions: { profiles: { radarr: 'all', sonarr: 'all' }, manual: true, anyTitle: true, manage: true },
  arrServices: { radarr: 'ok', sonarr: 'ok' },
}
const renderCard = (item, props = {}) =>
  render(<WatchlistCard item={item} viewMode="grid" user={admin} onSelect={jest.fn()} onRefresh={jest.fn()} {...arr} {...props} />)

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

test('the grid card says the title is no longer in the library, over the stored blurhash', () => {
  renderCard(removed)

  expect(screen.getByText('No longer in the library')).toBeInTheDocument()
  expect(screen.queryByText('Not available yet')).toBeNull()
  expect(screen.getByRole('img', { name: 'Sintel' })).toHaveAttribute('src', 'data:image/png;base64,iVBORw0KGgo')
  // Nothing to open
  expect(screen.queryByRole('button', { name: 'View Sintel' })).toBeNull()
})

test('the list row says so too', () => {
  renderCard(removed, { viewMode: 'list' })

  expect(screen.getByText('No longer in the library')).toBeInTheDocument()
  expect(screen.getByRole('img', { name: 'Sintel' })).toHaveAttribute('src', 'data:image/png;base64,iVBORw0KGgo')
})

test('with no blurhash stored, the stock poster stands in', () => {
  renderCard({ ...removed, posterBlurhash: undefined })

  expect(screen.getByRole('img', { name: 'Sintel' }).getAttribute('src')).toContain('sorry-image-not-available.jpg')
})

test('its menu offers removal, and neither Coming Soon nor Radarr: both are kept by TMDB id', async () => {
  renderCard(removed)
  await click(screen.getAllByRole('button', { name: /More actions/ })[0])

  expect(screen.getByRole('button', { name: 'Remove from watchlist' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Coming Soon/ })).toBeNull()
  expect(screen.queryByRole('button', { name: /Radarr/ })).toBeNull()
})

test('a TMDB title the library doesn’t have keeps the card it had', async () => {
  renderCard(wanted)

  expect(screen.getByText('Not available yet')).toBeInTheDocument()
  expect(screen.queryByText('No longer in the library')).toBeNull()
  expect(screen.getByRole('img', { name: 'Cars' }).getAttribute('src')).not.toMatch(/^data:/)

  await click(screen.getAllByRole('button', { name: /More actions/ })[0])
  expect(screen.getByRole('button', { name: 'Mark as "Coming Soon"' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Send to Radarr…' })).toBeInTheDocument()
})
