/**
 * @jest-environment node
 *
 * The page chrome (nav bar, TV apps notice, footer) reads the session through
 * getChromeSession(): a 'use cache: private' read that partial prefetching may
 * prerender, unlike getSession(), whose expiry check reads the current time.
 * A cached result has to serialize, so it returns plain fields only.
 */

jest.mock('next/headers', () => ({ headers: jest.fn(async () => new Headers({ cookie: 'session=1' })) }))
jest.mock('next/cache', () => ({ cacheLife: jest.fn() }))
const mockGetSession = jest.fn()
jest.mock('@src/lib/auth', () => ({ auth: { api: { getSession: (...args) => mockGetSession(...args) } } }))

const { getChromeSession } = require('@src/lib/cachedAuth')
const { cacheLife } = require('next/cache')

beforeEach(() => jest.clearAllMocks())

it('returns the plain fields the chrome reads, with a 30 s browser lifetime', async () => {
  mockGetSession.mockResolvedValue({
    session: { expiresAt: new Date() },
    user: {
      id: 'u1',
      email: 'viewer@example.com',
      image: 'https://img.example/u1.png',
      role: 'admin',
      approved: true,
      preferences: { tvAppsNotificationDismissed: true },
      createdAt: new Date(),
    },
  })

  expect(await getChromeSession()).toEqual({
    id: 'u1',
    email: 'viewer@example.com',
    image: 'https://img.example/u1.png',
    isAdmin: true,
    approved: true,
    tvAppsNotificationDismissed: true,
  })
  expect(cacheLife).toHaveBeenCalledWith({ stale: 30 })
})

it('treats a missing approval flag as approved and missing fields as absent', async () => {
  mockGetSession.mockResolvedValue({ user: { id: 'u2', role: 'user' } })

  expect(await getChromeSession()).toEqual({
    id: 'u2',
    email: null,
    image: null,
    isAdmin: false,
    approved: true,
    tvAppsNotificationDismissed: false,
  })
})

it('returns null when signed out', async () => {
  mockGetSession.mockResolvedValue(null)

  expect(await getChromeSession()).toBeNull()
})
