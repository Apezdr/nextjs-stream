/**
 * The popup card's Radarr/Sonarr button: offered for a service the user's
 * roles allow (admins hold everything), only for a title with a TMDB id, and
 * it hands the card exactly what the dialog needs.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import ArrPopupButton from '@src/components/Arr/ArrPopupButton'

jest.mock('@src/lib/auth-client', () => ({ authClient: { useSession: () => ({ data: { user: { id: 'u1' } } }) } }))
const mockPermissions = jest.fn()
jest.mock('@src/components/Roles/usePermissions', () => ({
  __esModule: true,
  default: () => mockPermissions(),
}))

const ADMIN = {
  admin: true,
  grants: { 'arr.request': { radarr: 'all', sonarr: 'all', manual: true, anyTitle: true }, 'arr.manage': {} },
}
const RADARR_REQUESTER = {
  admin: false,
  grants: { 'arr.request': { radarr: [4], sonarr: [], manual: false, anyTitle: false } },
}

beforeEach(() => {
  mockPermissions.mockReset()
})

test('a user whose roles allow it gets the service’s button, which hands the card the title', () => {
  mockPermissions.mockReturnValue(ADMIN)
  const onOpen = jest.fn()
  render(<ArrPopupButton mediaType="movie" tmdbId="11" title="Star Wars" onOpen={onOpen} />)

  fireEvent.click(screen.getByRole('button', { name: /Radarr/ }))

  expect(onOpen).toHaveBeenCalledWith({ mediaType: 'movie', tmdbId: 11, title: 'Star Wars' })
})

test('a show goes to Sonarr', () => {
  mockPermissions.mockReturnValue(ADMIN)
  render(<ArrPopupButton mediaType="tv" tmdbId={1438} title="The Wire" onOpen={jest.fn()} />)
  expect(screen.getByRole('button', { name: /Sonarr/ })).toHaveAttribute('title', 'Send to Sonarr, or manage it there')
})

test('only for the services a requester’s role includes', () => {
  mockPermissions.mockReturnValue(RADARR_REQUESTER)
  const { rerender } = render(<ArrPopupButton mediaType="movie" tmdbId={11} title="Star Wars" onOpen={jest.fn()} />)
  expect(screen.getByRole('button', { name: /Radarr/ })).toBeInTheDocument()

  rerender(<ArrPopupButton mediaType="tv" tmdbId={1438} title="The Wire" onOpen={jest.fn()} />)
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})

test.each([
  ['no permissions (yet, or at all)', null],
  ['roles that grant nothing here', { admin: false, grants: {} }],
])('nothing for %s', (_label, permissions) => {
  mockPermissions.mockReturnValue(permissions)
  const { container } = render(<ArrPopupButton mediaType="movie" tmdbId={11} title="Star Wars" onOpen={jest.fn()} />)
  expect(container).toBeEmptyDOMElement()
})

test.each([
  ['no TMDB id', { mediaType: 'movie', tmdbId: undefined }],
  ['a bad TMDB id', { mediaType: 'movie', tmdbId: 'abc' }],
  ['an episode-only type', { mediaType: 'episode', tmdbId: 11 }],
])('nothing for %s', (_label, props) => {
  mockPermissions.mockReturnValue(ADMIN)
  const { container } = render(<ArrPopupButton {...props} title="x" onOpen={jest.fn()} />)
  expect(container).toBeEmptyDOMElement()
})
