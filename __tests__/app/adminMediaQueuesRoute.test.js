/**
 * @jest-environment node
 *
 * GET /api/authenticated/admin/media-queues: admin only, and the services are
 * never contacted for a caller who is not one.
 */

const mockIsAdmin = jest.fn()
jest.mock('@src/utils/routeAuth', () => ({ isAdmin: (...args) => mockIsAdmin(...args) }))

const mockGetMediaQueues = jest.fn()
jest.mock('@src/lib/mediaQueues/getMediaQueues', () => ({ getMediaQueues: (...args) => mockGetMediaQueues(...args) }))

const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
jest.mock('@src/lib/logger', () => ({ createLogger: () => mockLog }))

const { GET } = require('@src/app/api/authenticated/admin/media-queues/route')

beforeEach(() => {
  mockIsAdmin.mockReset()
  mockGetMediaQueues.mockReset()
  mockLog.error.mockReset()
})

test('a non-admin gets the auth response and no upstream request is made', async () => {
  const denied = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  mockIsAdmin.mockResolvedValue(denied)

  const response = await GET()

  expect(response).toBe(denied)
  expect(mockGetMediaQueues).not.toHaveBeenCalled()
})

test('an admin gets the normalized queues', async () => {
  const payload = { queues: [{ service: 'tdarr', state: 'not_configured', missing: ['TDARR_URL'] }] }
  mockIsAdmin.mockResolvedValue({ id: 'u1', role: 'admin' })
  mockGetMediaQueues.mockResolvedValue(payload)

  const response = await GET()

  expect(response.status).toBe(200)
  await expect(response.json()).resolves.toEqual(payload)
})

test('an unexpected failure is a generic 500', async () => {
  mockIsAdmin.mockResolvedValue({ id: 'u1', role: 'admin' })
  mockGetMediaQueues.mockRejectedValue(new Error('boom at http://radarr.test?apikey=secret'))

  const response = await GET()

  expect(response.status).toBe(500)
  await expect(response.json()).resolves.toEqual({ error: 'Failed to load media queues' })
  expect(mockLog.error).toHaveBeenCalledTimes(1)
})
