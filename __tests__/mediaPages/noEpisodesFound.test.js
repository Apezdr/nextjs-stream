/**
 * An empty season's "Try again": it asks the server whether the season has
 * episodes now (a GET, fetchSeasonHasEpisodes, where the refreshEpisodes
 * Server Action used to be), and refreshes the page to render them.
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import NoEpisodesFound from '@components/MediaPages/NoEpisodesFound'

jest.mock('next/image', () => ({
  __esModule: true,
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }) => <img src={typeof src === 'string' ? src : ''} alt={alt} />,
}))
const mockRefresh = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mockRefresh }) }))
jest.mock('@components/HOC/PageContentAnimatePresence', () => ({ __esModule: true, default: ({ children }) => children }))
jest.mock('@components/SyncClientWithServerWatched', () => ({ __esModule: true, default: () => null }))
const mockAsk = jest.fn()
jest.mock('@components/MediaPages/mediaListApi', () => ({ fetchSeasonHasEpisodes: (...args) => mockAsk(...args) }))

const retry = () => act(async () => fireEvent.click(screen.getByRole('button', { name: /Try Again/ })))

beforeEach(() => jest.clearAllMocks())

it('asks the server for this season, and refreshes the page when it has episodes now', async () => {
  mockAsk.mockResolvedValue({ success: true, hasEpisodes: true })
  render(<NoEpisodesFound showTitle="100% Wolf" seasonNumber="2" season={{}} />)
  await retry()
  expect(mockAsk).toHaveBeenCalledWith({ showTitle: '100% Wolf', seasonNumber: '2' })
  expect(mockRefresh).toHaveBeenCalledTimes(1)
})

it('says so when there are still none, and can be tried again', async () => {
  mockAsk.mockResolvedValue({ success: true, hasEpisodes: false })
  jest.spyOn(console, 'log').mockImplementation(() => {})
  render(<NoEpisodesFound showTitle="A Show" seasonNumber="1" season={{}} />)
  await retry()
  expect(mockRefresh).not.toHaveBeenCalled()
  expect(screen.getByText('No episodes found. Please try again later.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Try Again/ })).not.toBeDisabled()
})

it('stays busy while the page leaves for sign-in (null), and frees the button on a failure', async () => {
  mockAsk.mockResolvedValue(null)
  const { unmount } = render(<NoEpisodesFound showTitle="A Show" seasonNumber="1" season={{}} />)
  await retry()
  expect(screen.getByRole('button', { name: /Refreshing/ })).toBeDisabled()
  unmount()

  mockAsk.mockRejectedValue(new Error('Couldn’t load the season (500)'))
  jest.spyOn(console, 'error').mockImplementation(() => {})
  render(<NoEpisodesFound showTitle="A Show" seasonNumber="1" season={{}} />)
  await retry()
  expect(screen.getByRole('button', { name: /Try Again/ })).not.toBeDisabled()
  expect(mockRefresh).not.toHaveBeenCalled()
})
