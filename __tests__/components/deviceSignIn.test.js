/**
 * Device sign-in approval: the /device page and the account menu's Link your
 * device dialog. Each claims the code with GET /device first (better-auth
 * 1.7 refuses approve/deny for an unclaimed code, GHSA-cq3f-vc6p-68fh), shows
 * which app is asking from the server's record, and only then offers Approve
 * (GHSA-q84f-53jg-9ppm).
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { authClient } from '@src/lib/auth-client'
import { getSession } from '@src/lib/cachedAuth'
import DevicePage from '@src/app/(styled)/device/page'
import DeviceAuthClient from '@src/app/(styled)/device/device-auth-client'
import DeviceLinkModal from '@components/Navigation/DeviceLinkModal'

jest.mock('next/server', () => ({ connection: jest.fn() }))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))
jest.mock('@src/lib/cachedAuth', () => ({ getSession: jest.fn() }))
jest.mock('@src/lib/auth-client', () => {
  // authClient.device() is GET /device; .approve and .deny are the POSTs
  const device = jest.fn()
  device.approve = jest.fn()
  device.deny = jest.fn()
  return { authClient: { device, signIn: { social: jest.fn() } } }
})

const user = { name: 'Test User', email: 'user@example.com', image: '' }
const knownClients = [
  ['mobile-app', 'The TV and mobile app'],
  ['nextjs-stream-windows', 'The Windows app'],
]
const originalResizeObserver = global.ResizeObserver
const pending = (overrides = {}) => ({
  data: { user_code: 'ABCDEFGH', status: 'pending', client_id: 'mobile-app', ...overrides },
  error: null,
})

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

afterAll(() => {
  global.ResizeObserver = originalResizeObserver
})

beforeEach(() => {
  jest.clearAllMocks()
  getSession.mockResolvedValue({ user: { ...user, approved: true } })
  authClient.device.mockResolvedValue(pending())
  authClient.device.approve.mockResolvedValue({ error: null })
  authClient.device.deny.mockResolvedValue({ error: null })
})

test.each(knownClients)('QR sign-in claims the code, names %s, then approves', async (clientId, name) => {
  authClient.device.mockResolvedValue(pending({ client_id: clientId }))
  render(await DevicePage({ searchParams: Promise.resolve({ user_code: 'ABCDEFGH' }) }))

  expect(screen.getByRole('heading', { name: 'Sign in to your device' })).toBeInTheDocument()
  // Nothing to approve until the server has said what the request is
  expect(screen.queryByRole('button', { name: 'Approve Device' })).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

  expect(await screen.findByText(name)).toBeInTheDocument()
  expect(screen.getByText(/is asking to sign in to your account/)).toBeInTheDocument()
  expect(screen.getByText(/Approve only if this code is showing right now on a device you have/)).toBeInTheDocument()
  expect(authClient.device).toHaveBeenCalledWith({ query: { user_code: 'ABCDEFGH' } })
  expect(authClient.device.approve).not.toHaveBeenCalled()

  fireEvent.click(screen.getByRole('button', { name: 'Approve Device' }))

  expect(await screen.findByText('Your device is now signed in. This page can be closed.')).toBeInTheDocument()
  expect(authClient.device.approve).toHaveBeenCalledWith({ userCode: 'ABCDEFGH' })
})

test('signed-out QR visitors still see the sign-in options under a device-neutral heading', async () => {
  getSession.mockResolvedValue(null)
  render(await DevicePage({ searchParams: Promise.resolve({ user_code: 'ABCDEFGH' }) }))

  expect(screen.getByRole('heading', { name: 'Sign in to your device' })).toBeInTheDocument()
  expect(screen.getByText('Sign in to approve this device:')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Sign in with Discord' })).toBeInTheDocument()
  expect(authClient.device).not.toHaveBeenCalled()
})

test('manual code entry refers to any device and preserves code validation', () => {
  render(<DeviceAuthClient isAuthenticated user={user} />)

  expect(screen.getByText('Enter the code shown on your device')).toBeInTheDocument()
  const next = screen.getByRole('button', { name: 'Continue' })
  expect(next).toBeDisabled()

  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'abc' } })
  expect(next).toBeDisabled()

  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'abcdefgh' } })
  expect(screen.getByRole('textbox')).toHaveValue('ABCDEFGH')
  expect(next).toBeEnabled()
})

test('a code another account has claimed offers no approval', async () => {
  // GET /device returns client_id only to the account that claimed the request
  authClient.device.mockResolvedValue({ data: { user_code: 'ABCDEFGH', status: 'pending' }, error: null })
  render(<DeviceAuthClient userCode="ABCDEFGH" isAuthenticated user={user} />)

  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

  expect(await screen.findByText('Another account is already approving this code.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Approve Device' })).not.toBeInTheDocument()
})

test('a request from an app this server does not know cannot be approved, only denied', async () => {
  authClient.device.mockResolvedValue(pending({ client_id: 'someone-elses-app' }))
  render(<DeviceAuthClient userCode="ABCDEFGH" isAuthenticated user={user} />)

  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

  expect(await screen.findByText(/An app this server doesn't recognize \(someone-elses-app\)/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Approve Device' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Deny' })).toBeEnabled()
})

test('an expired code says so and offers a new one', async () => {
  authClient.device.mockResolvedValue({ data: null, error: { error_description: 'User code has expired' } })
  render(<DeviceAuthClient userCode="ABCDEFGH" isAuthenticated user={user} />)

  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

  expect(await screen.findByText('Device code has expired')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Enter New Code' })).toBeInTheDocument()
})

test.each(knownClients)('the device-link dialog claims the code, names %s, then links the device', async (clientId, name) => {
  authClient.device.mockResolvedValue(pending({ client_id: clientId }))
  render(<DeviceLinkModal isOpen onClose={jest.fn()} />)

  expect(screen.getByRole('heading', { name: 'Link your device' })).toBeInTheDocument()
  expect(screen.getByText('Enter the code shown on your device')).toBeInTheDocument()

  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'abcdefgh' } })
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

  expect(await screen.findByText(name)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

  expect(await screen.findByText('Your device has been linked to your account.')).toBeInTheDocument()
  expect(authClient.device).toHaveBeenCalledWith({ query: { user_code: 'ABCDEFGH' } })
  expect(authClient.device.approve).toHaveBeenCalledWith({ userCode: 'ABCDEFGH' })
})

test("the device-link dialog's Deny reports a refusal instead of claiming success", async () => {
  authClient.device.deny.mockResolvedValue({
    error: { error_description: 'You are not authorized to deny this device authorization' },
  })
  render(<DeviceLinkModal isOpen onClose={jest.fn()} />)

  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'abcdefgh' } })
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Deny' }))

  expect(await screen.findByText('Another account is already approving this code.')).toBeInTheDocument()
  expect(screen.queryByText('The device request was denied.')).not.toBeInTheDocument()
})
