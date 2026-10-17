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
jest.mock('@src/lib/auth-client', () => ({
  authClient: {
    device: { approve: jest.fn(), deny: jest.fn() },
    signIn: { social: jest.fn() },
  },
}))

const user = { name: 'Test User', email: 'user@example.com', image: '' }
const originalResizeObserver = global.ResizeObserver

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
  authClient.device.approve.mockResolvedValue({ error: null })
})

test('QR sign-in uses device-neutral wording through approval', async () => {
  render(await DevicePage({ searchParams: Promise.resolve({ user_code: 'ABCDEFGH' }) }))

  expect(screen.getByRole('heading', { name: 'Sign in to your device' })).toBeInTheDocument()
  expect(screen.getByText('Do you want to sign in to your device with this account?')).toBeInTheDocument()

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
})

test('manual code entry refers to any device and preserves code validation', () => {
  render(<DeviceAuthClient isAuthenticated user={user} />)

  expect(screen.getByText('Enter the code shown on your device')).toBeInTheDocument()
  const approve = screen.getByRole('button', { name: 'Approve Device' })
  expect(approve).toBeDisabled()

  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'abc' } })
  expect(approve).toBeDisabled()

  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'abcdefgh' } })
  expect(screen.getByRole('textbox')).toHaveValue('ABCDEFGH')
  expect(approve).toBeEnabled()
})

test('the device-link dialog uses device-neutral instructions and success text', async () => {
  render(<DeviceLinkModal isOpen onClose={jest.fn()} />)

  expect(screen.getByRole('heading', { name: 'Link your device' })).toBeInTheDocument()
  expect(screen.getByText('Enter the code shown on your device')).toBeInTheDocument()

  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'abcdefgh' } })
  fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

  expect(await screen.findByText('Your device has been linked to your account.')).toBeInTheDocument()
  expect(authClient.device.approve).toHaveBeenCalledWith({ userCode: 'ABCDEFGH' })
})
