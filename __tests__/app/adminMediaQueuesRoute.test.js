/**
 * @jest-environment node
 *
 * GET /api/authenticated/admin/media-queues: admin only, and the services are
 * never contacted for a caller who is not one.
 */

const mockIsAdmin = jest.fn()
jest.mock('@src/utils/routeAuth', () => ({ isAdmin: (...args) => mockIsAdmin(...args) }))

const mockGetMediaQueues = jest.fn()
const mockRefreshMediaQueue = jest.fn()
jest.mock('@src/lib/mediaQueues/getMediaQueues', () => ({
  getMediaQueues: (...args) => mockGetMediaQueues(...args),
  refreshMediaQueue: (...args) => mockRefreshMediaQueue(...args),
}))

const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
jest.mock('@src/lib/logger', () => ({ createLogger: () => mockLog }))

const { GET } = require('@src/app/api/authenticated/admin/media-queues/route')

const URL_BASE = 'http://localhost/api/authenticated/admin/media-queues'
const get = (query = '') => GET(new Request(`${URL_BASE}${query}`))

beforeEach(() => {
  mockIsAdmin.mockReset()
  mockGetMediaQueues.mockReset()
  mockRefreshMediaQueue.mockReset()
  mockLog.error.mockReset()
})

test('a non-admin gets the auth response and no upstream request is made', async () => {
  const denied = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  mockIsAdmin.mockResolvedValue(denied)

  const response = await get()

  expect(response).toBe(denied)
  expect(mockGetMediaQueues).not.toHaveBeenCalled()
})

test('an admin gets the normalized queues', async () => {
  const payload = { queues: [{ service: 'tdarr', state: 'not_configured', missing: ['TDARR_URL'] }] }
  mockIsAdmin.mockResolvedValue({ id: 'u1', role: 'admin' })
  mockGetMediaQueues.mockResolvedValue(payload)

  const response = await get()

  expect(response.status).toBe(200)
  await expect(response.json()).resolves.toEqual(payload)
})

test('an unexpected failure is a generic 500', async () => {
  mockIsAdmin.mockResolvedValue({ id: 'u1', role: 'admin' })
  mockGetMediaQueues.mockRejectedValue(new Error('boom at http://radarr.test?apikey=secret'))

  const response = await get()

  expect(response.status).toBe(500)
  await expect(response.json()).resolves.toEqual({ error: 'Failed to load media queues' })
  expect(mockLog.error).toHaveBeenCalledTimes(1)
})

describe('?refresh=<service> (a card refresh button)', () => {
  test('asks that one service again', async () => {
    const payload = { queues: [{ service: 'radarr', state: 'unreachable', reason: 'timeout', httpStatus: null }] }
    mockIsAdmin.mockResolvedValue({ id: 'u1', role: 'admin' })
    mockRefreshMediaQueue.mockResolvedValue(payload)

    const response = await get('?refresh=radarr')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(payload)
    expect(mockRefreshMediaQueue).toHaveBeenCalledWith('radarr')
    expect(mockGetMediaQueues).not.toHaveBeenCalled()
  })

  test('an unknown service is a 400, and nothing is requested', async () => {
    mockIsAdmin.mockResolvedValue({ id: 'u1', role: 'admin' })

    const response = await get('?refresh=plex')

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Unknown media queue' })
    expect(mockRefreshMediaQueue).not.toHaveBeenCalled()
    expect(mockGetMediaQueues).not.toHaveBeenCalled()
  })

  test('a non-admin is refused before the parameter is even read', async () => {
    const denied = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    mockIsAdmin.mockResolvedValue(denied)

    expect(await get('?refresh=radarr')).toBe(denied)
    expect(mockRefreshMediaQueue).not.toHaveBeenCalled()
  })
})
