import { render, screen } from '@testing-library/react'
import MovieLayout from '@components/HOC/MovieLayout'

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

describe('MovieLayout', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUseSession.mockReturnValue({
      data: { user: { id: 'user-1' } },
      isPending: false,
    })
    mockUsePathname.mockReturnValue('/list/movie/Current%20Movie')
    mockUseParams.mockReturnValue({ title: 'Current%20Movie' })
  })

  it('does not render a backdrop when SWR data belongs to a different movie', () => {
    mockUseSWR.mockReturnValue({
      data: {
        originalTitle: 'Older Movie',
        backdrop: 'https://cdn.example.com/older-backdrop.jpg',
      },
    })

    render(<MovieLayout />)

    expect(screen.queryByTestId('fullscreen-backdrop')).not.toBeInTheDocument()
  })

  it('renders a backdrop when SWR data matches the current movie route', () => {
    mockUseSWR.mockReturnValue({
      data: {
        originalTitle: 'Current Movie',
        backdrop: 'https://cdn.example.com/current-backdrop.jpg',
      },
    })

    render(<MovieLayout />)

    expect(screen.getByTestId('fullscreen-backdrop')).toHaveTextContent('Current Movie')
  })

  it('clears the backdrop when navigating away from a movie route to the list screen', () => {
    mockUseSWR.mockReturnValue({
      data: {
        originalTitle: 'Current Movie',
        backdrop: 'https://cdn.example.com/current-backdrop.jpg',
      },
    })

    const { rerender } = render(<MovieLayout />)

    expect(screen.getByTestId('fullscreen-backdrop')).toHaveTextContent('Current Movie')

    mockUsePathname.mockReturnValue('/list')
    mockUseParams.mockReturnValue({})
    mockUseSWR.mockReturnValue({ data: undefined })

    rerender(<MovieLayout />)

    expect(screen.queryByTestId('fullscreen-backdrop')).not.toBeInTheDocument()
  })

  it('requests SWR with the canonical movie originalTitle from the route', () => {
    mockUseSWR.mockReturnValue({ data: undefined })

    render(<MovieLayout />)

    expect(mockUseSWR).toHaveBeenCalledWith(
      ['movie-layout-media', 'movie', 'Current Movie'],
      expect.any(Function)
    )
  })
})