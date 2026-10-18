/**
 * A new-content digest (one notice for a run that added many titles) opens
 * the list of its titles in place when it is clicked, each title linking to
 * its media page, with "+N more" for what the list leaves out.
 */
import { act, fireEvent, render, screen } from '@testing-library/react'

const mockMarkAsRead = jest.fn(async () => {})
const mockPush = jest.fn()
jest.mock('@src/hooks/useNotifications', () => ({
  useNotifications: () => ({ markAsRead: mockMarkAsRead, dismissNotification: jest.fn() }),
}))
jest.mock('@src/lib/auth-client', () => ({ authClient: { useSession: () => ({ data: null }) } }))
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }))
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))
jest.mock('next/image', () => ({
  __esModule: true,
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: ({ fill: _fill, ...props }) => <img {...props} />,
}))

const NotificationItem = require('@src/components/notifications/NotificationItem').default
const NewContentDigest = require('@src/components/notifications/NewContentDigest').default
const { isNewContentDigest } = require('@src/components/notifications/NewContentDigest')

const digest = (extra = {}) => ({
  _id: 'n1',
  type: 'new_content',
  subtype: 'new_content_digest',
  title: 'New in Your Library',
  message: '2 new movies and 3 new episodes of 1 show have been added to your library.',
  read: false,
  createdAt: new Date().toISOString(),
  actionUrl: '/list',
  data: {
    contentType: 'digest',
    movieCount: 2,
    episodeCount: 3,
    showCount: 1,
    items: [
      { kind: 'movie', title: 'Alpha', originalTitle: 'Alpha (2020)', href: '/list/movie/Alpha%20(2020)', posterURL: 'https://files.example/alpha.jpg' },
      { kind: 'movie', title: 'Beta', originalTitle: 'Beta (2021)', href: '/list/movie/Beta%20(2021)', posterURL: null },
      { kind: 'show', title: 'Gamma', originalTitle: 'Gamma (2019)', href: '/list/tv/Gamma%20(2019)', posterURL: null, newEpisodes: 3 },
    ],
    moreCount: 0,
    ...extra,
  },
})

beforeEach(() => {
  mockMarkAsRead.mockClear()
  mockPush.mockClear()
})

describe('NewContentDigest', () => {
  it('lists every title with a link to its media page', () => {
    render(<NewContentDigest data={digest().data} />)

    const list = screen.getByRole('list', { name: 'Titles added' })
    const links = Array.from(list.querySelectorAll('a'))
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/list/movie/Alpha%20(2020)',
      '/list/movie/Beta%20(2021)',
      '/list/tv/Gamma%20(2019)',
    ])
    expect(screen.getByText('3 new episodes')).toBeInTheDocument()
    // A poster where there is one; the title's initial where there is none
    expect(list.querySelectorAll('img')).toHaveLength(1)
    expect(screen.getByText('B')).toBeInTheDocument()
    expect(screen.queryByText(/more$/)).toBeNull()
  })

  it('counts what the list leaves out', () => {
    render(<NewContentDigest data={digest({ moreCount: 41 }).data} />)

    expect(screen.getByText('+41 more')).toBeInTheDocument()
  })

  it('tells the menu it can close when a title is opened', () => {
    const onNavigate = jest.fn()
    render(<NewContentDigest data={digest().data} onNavigate={onNavigate} />)

    fireEvent.click(screen.getByText('Gamma'))

    expect(onNavigate).toHaveBeenCalledTimes(1)
  })
})

describe('a digest in the notification list', () => {
  it('opens its titles in place instead of navigating, and is marked read', async () => {
    const onClose = jest.fn()
    render(<NotificationItem notification={digest()} onClose={onClose} />)
    const toggle = screen.getByRole('button', { name: 'Show 3 titles' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('list', { name: 'Titles added' })).toBeNull()

    await act(async () => {
      fireEvent.click(toggle)
    })

    expect(screen.getByRole('list', { name: 'Titles added' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide titles' })).toHaveAttribute('aria-expanded', 'true')
    expect(mockMarkAsRead).toHaveBeenCalledWith('n1')
    expect(mockPush).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('counts the titles it leaves out in its button', () => {
    render(<NotificationItem notification={digest({ moreCount: 21 })} onClose={jest.fn()} />)

    expect(screen.getByRole('button', { name: 'Show 24 titles' })).toBeInTheDocument()
  })

  it('leaves every other notification as it was: a click follows its link', async () => {
    const onClose = jest.fn()
    const movie = { ...digest(), subtype: 'new_movie', data: { contentType: 'movie' }, actionUrl: '/list/movie/Alpha%20(2020)' }
    render(<NotificationItem notification={movie} onClose={onClose} />)

    expect(isNewContentDigest(movie)).toBe(false)
    expect(screen.queryByRole('button', { name: /titles/ })).toBeNull()
    await act(async () => {
      fireEvent.click(screen.getByText('New in Your Library'))
    })

    expect(mockPush).toHaveBeenCalledWith('/list/movie/Alpha%20(2020)')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
