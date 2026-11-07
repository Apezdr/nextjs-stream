/**
 * "View as" in the web app: the Users page button (offered on every row but
 * admins' and the viewer's own, pending users included), and the banner that
 * every page shows while the session is a view-as one, from the server's
 * session, with Stop.
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import UserListRecords from '@src/components/Admin/Users/UserListRecords'
import ViewAsBanner from '@src/components/ViewAs/ViewAsBanner'
import ViewAsBannerClient, { viewAsBarPlacement } from '@src/components/ViewAs/ViewAsBannerClient'

jest.mock('@src/utils/actions/admin_users', () => ({ updateUserApprovedFlag: jest.fn() }))
jest.mock('@src/utils/actions/roles', () => ({ setUserRolesAction: jest.fn() }))
const mockStartViewAs = jest.fn()
const mockStopViewAs = jest.fn()
const mockSignOut = jest.fn()
const mockSetWrites = jest.fn()
const mockUnsubscribe = jest.fn()
const mockReloadOnSwitch = jest.fn(() => mockUnsubscribe)
jest.mock('@src/components/ViewAs/viewAsClient', () => ({
  startViewAs: (...args) => mockStartViewAs(...args),
  stopViewAs: (...args) => mockStopViewAs(...args),
  signOutOfViewAs: (...args) => mockSignOut(...args),
  setViewAsWrites: (...args) => mockSetWrites(...args),
  reloadOnViewAsSwitch: (...args) => mockReloadOnSwitch(...args),
}))
let mockPathname = '/list'
jest.mock('next/navigation', () => ({ usePathname: () => mockPathname, useRouter: () => ({ refresh: jest.fn() }) }))
jest.mock('react-toastify', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))
jest.mock('next/server', () => ({ connection: jest.fn(async () => {}) }))
const mockGetSession = jest.fn()
jest.mock('@src/lib/cachedAuth', () => ({ getSession: (...args) => mockGetSession(...args) }))
const { toast } = require('react-toastify')

const click = (element) => act(async () => fireEvent.click(element))

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

beforeEach(() => {
  jest.clearAllMocks()
  mockPathname = '/list'
})

describe('the Users page button', () => {
  const rows = [
    { id: 'a1', name: 'Me', email: 'me@example.com', approved: 'true', role: 'admin', roles: [] },
    { id: 'a2', name: 'Other Admin', email: 'a2@example.com', approved: 'true', role: 'admin', roles: [] },
    { id: 'u1', name: 'Member', email: 'u1@example.com', approved: 'true', role: 'user', roles: [] },
    { id: 'p1', name: 'Pending', email: 'p1@example.com', approved: 'false', role: 'user', roles: [] },
  ]
  const renderRows = () =>
    render(<UserListRecords title="Users" data={rows} updateProcessedData={jest.fn()} roleOptions={[]} viewerId="a1" />)
  // Found by email: a name like "Pending" is also the status pill's text
  const viewAsIn = (name) =>
    screen
      .getByText(rows.find((row) => row.name === name).email)
      .closest('tr')
      .querySelector('button[title^="See the app as"]')

  it('is on members’ and pending users’ rows, not on admins’ or the viewer’s own', () => {
    renderRows()
    expect(viewAsIn('Member')).not.toBeNull()
    expect(viewAsIn('Pending')).not.toBeNull()
    expect(viewAsIn('Other Admin')).toBeNull()
    expect(viewAsIn('Me')).toBeNull()
    expect(screen.getAllByRole('button', { name: 'View as' })).toHaveLength(2)
  })

  it('starts viewing as the row’s user; the page leaves, so the row stays busy', async () => {
    mockStartViewAs.mockResolvedValue({ ok: true })
    renderRows()
    await click(viewAsIn('Member'))
    expect(mockStartViewAs).toHaveBeenCalledWith('u1')
    expect(viewAsIn('Member')).toBeDisabled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('says why when the server refuses, and frees the row', async () => {
    mockStartViewAs.mockResolvedValue({ ok: false, error: 'You cannot impersonate admins' })
    renderRows()
    await click(viewAsIn('Pending'))
    expect(toast.error).toHaveBeenCalledWith('Couldn’t view as Pending: You cannot impersonate admins')
    expect(viewAsIn('Pending')).not.toBeDisabled()
  })
})

describe('the banner', () => {
  const VIEW_AS = {
    session: { token: 't', userId: 'u1', impersonatedBy: 'a1' },
    user: { id: 'u1', name: 'Member', email: 'u1@example.com', role: 'user' },
  }

  it('comes from the live session: shown while viewing as, with the user’s name', async () => {
    mockGetSession.mockResolvedValue(VIEW_AS)
    render(await ViewAsBanner())
    expect(screen.getByRole('status')).toHaveTextContent(/^Viewing as Member\s*·\s*Read-only\s*·\s*Writes on\s*Stop$/)
    // Read-only: every view starts so
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  })

  it('turns red, “Writing as”, while the session has writes on', async () => {
    mockGetSession.mockResolvedValue({ ...VIEW_AS, session: { ...VIEW_AS.session, viewAsWrites: true } })
    render(await ViewAsBanner())
    const bar = screen.getByRole('status')
    expect(bar).toHaveTextContent(/^Writing as Member/)
    expect(bar.className).toMatch(/bg-red-600/)
    expect(bar.className).not.toMatch(/bg-amber-400/)
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
  })

  it('falls back to the email when the user has no name', async () => {
    mockGetSession.mockResolvedValue({ ...VIEW_AS, user: { ...VIEW_AS.user, name: '' } })
    render(await ViewAsBanner())
    expect(screen.getByRole('status')).toHaveTextContent('Viewing as u1@example.com')
  })

  it('is absent for the admin’s own session, which only listens for another tab', async () => {
    mockGetSession.mockResolvedValue({ session: { token: 't' }, user: { id: 'a1', role: 'admin' } })
    const { container, unmount } = render(await ViewAsBanner())
    expect(container).toBeEmptyDOMElement()
    expect(mockReloadOnSwitch).toHaveBeenCalledTimes(1)
    unmount()
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1)
  })

  it('renders nothing at all for a member’s own session or no session', async () => {
    mockGetSession.mockResolvedValue({ session: { token: 't' }, user: { id: 'u1', role: 'user' } })
    expect(await ViewAsBanner()).toBeNull()
    mockGetSession.mockResolvedValue(null)
    expect(await ViewAsBanner()).toBeNull()
  })

  it('Stop goes back to the admin’s session (viewAsClient navigates the page away)', async () => {
    mockStopViewAs.mockResolvedValue({ ok: true })
    render(<ViewAsBannerClient viewingAs="Member" />)
    await click(screen.getByRole('button', { name: 'Stop' }))
    expect(mockStopViewAs).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('when Stop fails, says why and offers to sign out', async () => {
    mockStopViewAs.mockResolvedValue({ ok: false, error: 'Unauthorized', status: 401 })
    mockSignOut.mockResolvedValue({ ok: true })
    render(<ViewAsBannerClient viewingAs="Member" />)
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()
    await click(screen.getByRole('button', { name: 'Stop' }))
    expect(toast.error).toHaveBeenCalledWith('This view-as session has already ended.')
    await click(screen.getByRole('button', { name: 'Sign out' }))
    expect(mockSignOut).toHaveBeenCalledTimes(1)
  })

  it('turning writes on asks first, in the page (never window.confirm), and only then switches', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockImplementation(() => true)
    mockSetWrites.mockResolvedValue({ ok: true })
    render(<ViewAsBannerClient viewingAs="Member" />)
    await click(screen.getByRole('switch'))
    expect(mockSetWrites).not.toHaveBeenCalled()
    expect(confirmSpy).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Write as Member?')
    expect(dialog).toHaveTextContent(/Sign-in, account and device changes stay blocked/)

    await click(screen.getByRole('button', { name: 'Allow writes' }))
    expect(mockSetWrites).toHaveBeenCalledWith(true)
    // The page reloads with the session's new setting; until then the switch waits
    expect(screen.getByRole('switch')).toBeDisabled()
    confirmSpy.mockRestore()
  })

  it('cancelling leaves it read-only', async () => {
    render(<ViewAsBannerClient viewingAs="Member" />)
    await click(screen.getByRole('switch'))
    await click(screen.getByRole('button', { name: 'Cancel' }))
    expect(mockSetWrites).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  })

  it('turning writes off needs no asking, and a refusal is said', async () => {
    mockSetWrites.mockResolvedValue({ ok: false, error: 'The admin viewing as this user is no longer an admin.', status: 403 })
    render(<ViewAsBannerClient viewingAs="Member" writesOn />)
    await click(screen.getByRole('switch'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mockSetWrites).toHaveBeenCalledWith(false)
    expect(toast.error).toHaveBeenCalledWith('Couldn’t turn writes off: The admin viewing as this user is no longer an admin.')
    expect(screen.getByRole('switch')).not.toBeDisabled()
  })

  it('follows another tab’s start or stop (viewAsClient reloads this one)', () => {
    render(<ViewAsBannerClient viewingAs="Member" />)
    expect(mockReloadOnSwitch).toHaveBeenCalledTimes(1)
  })

  it('sits at the bottom, and on a watch page shrinks to a chip at the top, clear of the controls', () => {
    expect(viewAsBarPlacement('/list')).toEqual({ compact: false, style: { bottom: '1rem' } })
    expect(viewAsBarPlacement('/list/movie/Some%20Title')).toMatchObject({ compact: false })
    for (const watchPage of ['/list/movie/Some%20Title/play', '/list/tv/Some%20Show/1/2/play']) {
      expect(viewAsBarPlacement(watchPage)).toEqual({
        compact: true,
        style: { top: 'calc(var(--system-banner-bottom, 0px) + 0.75rem)' },
      })
    }
    mockPathname = '/list/movie/Some%20Title/play'
    render(<ViewAsBannerClient viewingAs="Member" />)
    expect(screen.getByRole('status').className).toMatch(/text-xs/)
  })
})
