/**
 * The popup card's Radarr/Sonarr button: only for users who may use them
 * (admins, for now), only for a title with a TMDB id, and it hands the card
 * exactly what the dialog needs.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import ArrPopupButton from '@src/components/Arr/ArrPopupButton'

const mockUseSession = jest.fn()
jest.mock('@src/lib/auth-client', () => ({ authClient: { useSession: () => mockUseSession() } }))

const asUser = (user) => mockUseSession.mockReturnValue({ data: user ? { user } : null })

beforeEach(() => {
  mockUseSession.mockReset()
})

test('an admin gets the service’s button, which hands the card the title', () => {
  asUser({ id: 'u1', role: 'admin' })
  const onOpen = jest.fn()
  render(<ArrPopupButton mediaType="movie" tmdbId="11" title="Star Wars" onOpen={onOpen} />)

  fireEvent.click(screen.getByRole('button', { name: /Radarr/ }))

  expect(onOpen).toHaveBeenCalledWith({ mediaType: 'movie', tmdbId: 11, title: 'Star Wars' })
})

test('a show goes to Sonarr', () => {
  asUser({ id: 'u1', role: 'admin' })
  render(<ArrPopupButton mediaType="tv" tmdbId={1438} title="The Wire" onOpen={jest.fn()} />)
  expect(screen.getByRole('button', { name: /Sonarr/ })).toHaveAttribute('title', 'Send to Sonarr, or manage it there')
})

test.each([
  ['signed out', null],
  ['a regular user', { id: 'u2', role: 'user' }],
  // The server checks the role alone; a legacy permissions entry isn't enough.
  ['a user with only the legacy Admin permission', { id: 'u3', role: 'user', permissions: ['Admin'] }],
])('nothing for %s', (_label, user) => {
  asUser(user)
  const { container } = render(<ArrPopupButton mediaType="movie" tmdbId={11} title="Star Wars" onOpen={jest.fn()} />)
  expect(container).toBeEmptyDOMElement()
})

test.each([
  ['no TMDB id', { mediaType: 'movie', tmdbId: undefined }],
  ['a bad TMDB id', { mediaType: 'movie', tmdbId: 'abc' }],
  ['an episode-only type', { mediaType: 'episode', tmdbId: 11 }],
])('nothing for %s', (_label, props) => {
  asUser({ id: 'u1', role: 'admin' })
  const { container } = render(<ArrPopupButton {...props} title="x" onOpen={jest.fn()} />)
  expect(container).toBeEmptyDOMElement()
})
