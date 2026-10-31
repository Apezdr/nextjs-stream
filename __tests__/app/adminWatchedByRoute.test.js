/**
 * @jest-environment node
 *
 * GET /api/authenticated/admin/watched-by: admin only, and the watch history
 * is never read for a caller who is not one.
 */

const mockIsAdmin = jest.fn()
jest.mock('@src/utils/routeAuth', () => ({ isAdmin: (...args) => mockIsAdmin(...args) }))

const mockListViewers = jest.fn()
jest.mock('@src/utils/flatDatabaseUtils', () => ({
  listViewersByNormalizedId: (...args) => mockListViewers(...args),
}))

const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
jest.mock('@src/lib/logger', () => ({ createLogger: () => mockLog }))

const { GET } = require('@src/app/api/authenticated/admin/watched-by/route')

const URL_BASE = 'http://localhost/api/authenticated/admin/watched-by'
const get = (query = '') => GET(new Request(`${URL_BASE}${query}`))

beforeEach(() => {
  mockIsAdmin.mockReset()
  mockListViewers.mockReset()
  mockLog.error.mockReset()
})

test('a non-admin gets the auth response and the watch history is not read', async () => {
  const denied = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  mockIsAdmin.mockResolvedValue(denied)

  const response = await get('?normalizedVideoId=abc123')

  expect(response).toBe(denied)
  expect(mockListViewers).not.toHaveBeenCalled()
})

test('the title is required', async () => {
  mockIsAdmin.mockResolvedValue({ id: 'a1', role: 'admin' })

  const response = await get()

  expect(response.status).toBe(400)
  expect(mockListViewers).not.toHaveBeenCalled()
})

test('an admin gets the viewers for both identities', async () => {
  const viewers = [{ userId: 'u1', name: 'Ada', image: null, playbackTime: 120, lastUpdated: '2026-10-29T21:14:00.000Z', deviceType: 'tv' }]
  mockIsAdmin.mockResolvedValue({ id: 'a1', role: 'admin' })
  mockListViewers.mockResolvedValue(viewers)

  const response = await get('?normalizedVideoId=abc123&mediaId=mid%3A0123456789abcdef')

  expect(mockListViewers).toHaveBeenCalledWith('abc123', 'mid:0123456789abcdef')
  expect(response.status).toBe(200)
  await expect(response.json()).resolves.toEqual({ viewers })
})

test('without a mediaId the list resolves it from the nid', async () => {
  mockIsAdmin.mockResolvedValue({ id: 'a1', role: 'admin' })
  mockListViewers.mockResolvedValue([])

  await get('?normalizedVideoId=abc123')

  expect(mockListViewers).toHaveBeenCalledWith('abc123', null)
})

test('a database failure is a generic 500', async () => {
  mockIsAdmin.mockResolvedValue({ id: 'a1', role: 'admin' })
  mockListViewers.mockRejectedValue(new Error('connection reset'))

  const response = await get('?normalizedVideoId=abc123')

  expect(response.status).toBe(500)
  await expect(response.json()).resolves.toEqual({ error: 'Failed to list viewers' })
  expect(mockLog.error).toHaveBeenCalled()
})
