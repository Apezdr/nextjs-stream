/**
 * @jest-environment node
 *
 * GET /api/authenticated/admin/server-load is polled every 3 s by every open
 * admin page. Each poll keeps the on-demand disk sampling alive, then returns
 * the sampler's snapshot, with no database work.
 */

const mockIsAdmin = jest.fn()
jest.mock('@src/utils/routeAuth', () => ({
  isAdmin: (...args) => mockIsAdmin(...args),
  isAdminOrWebhook: jest.fn(),
}))

const mockDb = jest.fn()
jest.mock('@src/lib/mongodb', () => ({
  __esModule: true,
  default: Promise.resolve({ db: (...args) => mockDb(...args) }),
}))

const mockSnapshot = {
  config: { cpuEnabled: true, memoryEnabled: true, diskEnabled: true, thresholds: {} },
  history: [{ t: 1, cpu: 12.5, memory: 40 }],
  cpu: { percent: 12.5, logicalCpus: 72, model: 'Test CPU' },
  memory: { percent: 40, usedBytes: 4, totalBytes: 10 },
  diskIo: { state: 'starting' },
}
const mockNoteDemand = jest.fn()
const mockGetSnapshot = jest.fn(() => mockSnapshot)
jest.mock('@src/utils/monitor_server_load', () => ({
  noteServerLoadDemand: (...args) => mockNoteDemand(...args),
  getServerLoadSnapshot: (...args) => mockGetSnapshot(...args),
}))

// The route's other dependencies play no part in server-load.
jest.mock('@src/utils', () => ({ buildURL: jest.fn() }))
jest.mock('@src/utils/admin_database', () => ({}))
jest.mock('@src/utils/flatDatabaseUtils', () => ({}))
jest.mock('@src/utils/playbackPresence/database', () => ({}))
jest.mock('@src/utils/playbackPresence/attach', () => ({}))
jest.mock('mongodb', () => ({ ObjectId: jest.fn() }))
jest.mock('@src/lib/userQueries', () => ({ userQueries: {} }))
jest.mock('@src/utils/admin_utils', () => ({}))
jest.mock('axios', () => ({ __esModule: true, default: {} }))
jest.mock('chalk', () => ({ __esModule: true, default: {} }))
jest.mock('@src/utils/sync_db', () => ({}))
jest.mock('@src/utils/config', () => ({}))
jest.mock('@src/utils/server_track_processes', () => ({}))
jest.mock('@src/utils/backendAuth', () => ({ getBackendAuthHeaders: jest.fn(async () => ({})) }))
jest.mock('@src/utils/sync', () => ({}))
jest.mock('@src/utils/sync/core/events', () => ({ syncEventBus: {} }))
jest.mock('@src/utils/sync/core/types', () => ({ SyncEventType: {} }))
jest.mock('@src/utils/sync/infrastructure', () => ({}))
jest.mock('@src/utils/sync_verification', () => ({}))
jest.mock('@src/utils/auth_utils', () => ({}))
jest.mock('@src/utils/notifications/NotificationManager.js', () => ({ NotificationManager: {} }))
jest.mock('@src/utils/fileServerDataService', () => ({}))
jest.mock('@src/utils/cache/invalidation', () => ({}))
jest.mock('@src/utils/cache/postSyncRevalidation', () => ({}))
jest.mock('next/cache', () => ({ revalidateTag: jest.fn() }))
jest.mock('@src/utils/cache/mediaPagesTags', () => ({}))
jest.mock('@src/lib/logger', () => ({
  createLogger: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })),
}))

const { GET } = require('@src/app/api/authenticated/[...admin]/route')

const poll = () =>
  GET(
    { headers: new Headers(), url: 'http://localhost/api/authenticated/admin/server-load' },
    { params: Promise.resolve({ admin: ['admin', 'server-load'] }) }
  )

beforeEach(() => {
  jest.clearAllMocks()
})

test('records the poll as demand, then returns the snapshot without touching the database', async () => {
  mockIsAdmin.mockResolvedValue({ id: 'admin-1', role: 'admin' })

  const response = await poll()

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual(mockSnapshot)
  expect(mockNoteDemand).toHaveBeenCalledTimes(1)
  expect(mockNoteDemand.mock.invocationCallOrder[0]).toBeLessThan(mockGetSnapshot.mock.invocationCallOrder[0])
  expect(mockDb).not.toHaveBeenCalled()
})

test('refuses a non-admin before recording any demand', async () => {
  mockIsAdmin.mockResolvedValue(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }))

  const response = await poll()

  expect(response.status).toBe(401)
  expect(mockNoteDemand).not.toHaveBeenCalled()
  expect(mockGetSnapshot).not.toHaveBeenCalled()
})
