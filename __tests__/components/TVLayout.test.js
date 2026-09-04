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

    expect(mockUseSWR).toHaveBeenCalledWith(
      ['tv-layout-media', 'tv', 'Current Show', undefined, undefined],
      expect.any(Function)
    )
  })
})