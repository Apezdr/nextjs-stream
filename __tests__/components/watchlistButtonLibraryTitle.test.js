/**
 * The "add to my list" button on a library title with no TMDB id. It used to
 * ask for the title's status as the literal "tmdbId=undefined", and when the
 * add was refused it showed the response's status text ("Bad Request") instead
 * of what the server said was wrong.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'

const mockToast = Object.assign(jest.fn(), { success: jest.fn(), info: jest.fn(), error: jest.fn() })
jest.mock('react-toastify', () => ({ toast: mockToast }))
jest.mock('@src/lib/auth-client', () => ({
  authClient: { useSession: () => ({ data: { user: { id: 'u1' } }, isPending: false }) },
}))
jest.mock('@src/app/loading', () => ({ LoadingDots: () => null }))
const mockFetchWithETag = jest.fn()
jest.mock('@src/utils/conditionalFetch', () => ({ fetchWithETag: (...args) => mockFetchWithETag(...args) }))

const WatchlistButton = require('@components/WatchlistButton').default

// The catalog document's _id: what a title page hands the button as mediaId
const SINTEL_DOC = '6a4fa5575bd6dc41316ddacd'

const renderButton = (props) =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <WatchlistButton mediaId={SINTEL_DOC} mediaType="movie" title="Sintel" variant="outline" {...props} />
    </SWRConfig>
  )

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'error').mockImplementation(() => {})
  mockFetchWithETag.mockResolvedValue({ response: { ok: true, status: 200 }, data: { inWatchlist: false }, notModified: false })
})

afterEach(() => jest.restoreAllMocks())

it('asks for the status with the ids the title has, and no "tmdbId=undefined"', async () => {
  renderButton({ tmdbId: undefined })

  await screen.findByRole('button', { name: 'My list' })
  expect(mockFetchWithETag).toHaveBeenCalledWith(
    `/api/authenticated/watchlist?action=status&mediaId=${SINTEL_DOC}&mediaType=movie`,
    expect.anything()
  )
})

it('still names a TMDB title by both ids', async () => {
  renderButton({ tmdbId: 603 })

  await screen.findByRole('button', { name: 'My list' })
  expect(mockFetchWithETag).toHaveBeenCalledWith(
    `/api/authenticated/watchlist?action=status&mediaId=${SINTEL_DOC}&tmdbId=603&mediaType=movie`,
    expect.anything()
  )
})

it('adds the title by its mediaId, and shows it as on the list', async () => {
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, action: 'added', item: { id: 'w1' } }) }))
  renderButton({ tmdbId: undefined })

  await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'My list' })))

  const [url, request] = global.fetch.mock.calls[0]
  expect(url).toBe(`/api/authenticated/watchlist?action=toggle&mediaId=${SINTEL_DOC}`)
  expect(JSON.parse(request.body)).toEqual({ mediaType: 'movie', title: 'Sintel', mediaId: SINTEL_DOC })
  expect(await screen.findByRole('button', { name: 'In my list' })).toBeInTheDocument()
  expect(mockToast.success).toHaveBeenCalled()
})

it('says what the server said was wrong when the add is refused', async () => {
  const message = 'This title has no TMDB id and the library has not given it an id of its own yet, so it cannot be added to a list'
  global.fetch = jest.fn(async () => ({
    ok: false,
    status: 400,
    statusText: 'Bad Request',
    json: async () => ({ success: false, error: 'Bad Request', message, code: 'MISSING_TITLE_IDENTITY' }),
  }))
  renderButton({ tmdbId: undefined })

  await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'My list' })))

  await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith(message))
  expect(mockToast.error).not.toHaveBeenCalledWith('Bad Request')
})

it('falls back to the status text when the refusal has no body to read', async () => {
  global.fetch = jest.fn(async () => ({
    ok: false,
    status: 502,
    statusText: 'Bad Gateway',
    json: async () => {
      throw new SyntaxError('Unexpected token <')
    },
  }))
  renderButton({ tmdbId: undefined })

  await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'My list' })))

  await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('Bad Gateway'))
})
