import { render, screen } from '@testing-library/react'
import TVLayout from '@components/HOC/TVLayout'

const mockUseParams = jest.fn()
const mockUsePathname = jest.fn()
const mockUseSWR = jest.fn()
const mockUseSession = jest.fn()

jest.mock('next/navigation', () => ({
  useParams: () => mockUseParams(),
  usePathname: () => mockUsePathname(),
}))

jest.mock('swr', () => ({
  __esModule: true,
  default: (...args) => mockUseSWR(...args),
}))

jest.mock('@src/lib/auth-client', () => ({
  authClient: {
    useSession: () => mockUseSession(),
  },
}))

jest.mock('framer-motion', () => ({
  AnimatePresence: ({ children }) => <>{children}</>,
}))

jest.mock('@components/Backdrop/FullScreen', () => ({
  __esModule: true,
  default: ({ media }) => (
    <div data-testid="fullscreen-backdrop">{media?.originalTitle}</div>
  ),
}))

describe('TVLayout', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUseSession.mockReturnValue({
      data: { user: { id: 'user-1' } },
      isPending: false,
    })
    mockUsePathname.mockReturnValue('/list/tv/Current%20Show')
    mockUseParams.mockReturnValue({ title: 'Current%20Show' })
  })

  it('does not render a backdrop when SWR data belongs to a different show', () => {
    mockUseSWR.mockReturnValue({
      data: {
        originalTitle: 'Older Show',
        backdrop: 'https://cdn.example.com/older-backdrop.jpg',
      },
    })

    render(<TVLayout />)

    expect(screen.queryByTestId('fullscreen-backdrop')).not.toBeInTheDocument()
  })

  it('renders a backdrop when SWR data matches the current show route', () => {
    mockUseSWR.mockReturnValue({
      data: {
        originalTitle: 'Current Show',
        backdrop: 'https://cdn.example.com/current-backdrop.jpg',
      },
    })

    render(<TVLayout />)

    expect(screen.getByTestId('fullscreen-backdrop')).toHaveTextContent('Current Show')
  })

  it('clears the backdrop when navigating away from a TV route to the list screen', () => {
    mockUseSWR.mockReturnValue({
      data: {
        originalTitle: 'Current Show',
        backdrop: 'https://cdn.example.com/current-backdrop.jpg',
      },
    })

    const { rerender } = render(<TVLayout />)

    expect(screen.getByTestId('fullscreen-backdrop')).toHaveTextContent('Current Show')

    mockUsePathname.mockReturnValue('/list')
    mockUseParams.mockReturnValue({})
    mockUseSWR.mockReturnValue({ data: undefined })

    rerender(<TVLayout />)

    expect(screen.queryByTestId('fullscreen-backdrop')).not.toBeInTheDocument()
  })

  it('requests SWR with the canonical show originalTitle from the route', () => {
    mockUseSWR.mockReturnValue({ data: undefined })

    render(<TVLayout />)

    expect(mockUseSWR).toHaveBeenCalledWith(['tv-layout-media', 'tv', 'Current Show'], expect.any(Function))
  })

  it('keeps one backdrop, and one request key, across the seasons and episodes of a show', () => {
    const show = { originalTitle: 'Current Show', backdrop: 'https://cdn.example.com/current-backdrop.jpg' }
    mockUseSWR.mockReturnValue({ data: show })
    const { rerender } = render(<TVLayout />)
    const backdrop = screen.getByTestId('fullscreen-backdrop')

    for (const [pathname, params] of [
      ['/list/tv/Current%20Show/1', { title: 'Current%20Show', season: '1' }],
      ['/list/tv/Current%20Show/1/2', { title: 'Current%20Show', season: '1', episode: '2' }],
      ['/list/tv/Current%20Show/1/3', { title: 'Current%20Show', season: '1', episode: '3' }],
      ['/list/tv/Current%20Show/2', { title: 'Current%20Show', season: '2' }],
    ]) {
      mockUsePathname.mockReturnValue(pathname)
      mockUseParams.mockReturnValue(params)
      rerender(<TVLayout />)
      // The same element, never unmounted: nothing behind the page moves
      expect(screen.getByTestId('fullscreen-backdrop')).toBe(backdrop)
    }

    // Season and episode never reach the request key, so stepping through a season asks for nothing new
    const keys = new Set(mockUseSWR.mock.calls.map(([key]) => JSON.stringify(key)))
    expect([...keys]).toEqual([JSON.stringify(['tv-layout-media', 'tv', 'Current Show'])])
  })

  it('still clears the backdrop when the show changes', () => {
    mockUseSWR.mockReturnValue({ data: { originalTitle: 'Current Show', backdrop: 'https://cdn.example.com/a.jpg' } })
    const { rerender } = render(<TVLayout />)
    expect(screen.getByTestId('fullscreen-backdrop')).toHaveTextContent('Current Show')

    // SWR still holds the outgoing show's data while the new key is in flight
    mockUsePathname.mockReturnValue('/list/tv/Other%20Show')
    mockUseParams.mockReturnValue({ title: 'Other%20Show' })
    rerender(<TVLayout />)
    expect(screen.queryByTestId('fullscreen-backdrop')).not.toBeInTheDocument()
  })
})