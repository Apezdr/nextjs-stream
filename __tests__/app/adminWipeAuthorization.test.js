/**
 * @jest-environment node
 *
 * DELETE /api/authenticated/admin/wipe-db empties the four Flat* collections.
 * Sync webhooks may POST (sync runs, status notices), but a webhook ID is a
 * shared secret every file server holds, so it must never be enough to erase
 * the catalog.
 */

const mockIsAdmin = jest.fn()
const mockIsAdminOrWebhook = jest.fn()
jest.mock('@src/utils/routeAuth', () => ({
  isAdmin: (...args) => mockIsAdmin(...args),
  isAdminOrWebhook: (...args) => mockIsAdminOrWebhook(...args),
}))

const mockDeleteMany = jest.fn()
const mockCollection = jest.fn(() => ({ deleteMany: mockDeleteMany }))
jest.mock('@src/lib/mongodb', () => ({
  __esModule: true,
  default: Promise.resolve({ db: () => ({ collection: (...args) => mockCollection(...args) }) }),
}))

// The route's other dependencies play no part in DELETE.
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
jest.mock('@src/utils/monitor_server_load', () => ({ monitorConfig: {} }))
jest.mock('@src/utils/server_track_processes', () => ({}))
jest.mock('@src/utils/sync', () => ({}))
jest.mock('@src/utils/sync/core/events', () => ({ syncEventBus: {} }))
jest.mock('@src/utils/sync/core/types', () => ({ SyncEventType: {} }))
jest.mock('@src/utils/sync/infrastructure', () => ({}))
jest.mock('@src/utils/sync_verification', () => ({}))
jest.mock('@src/utils/auth_utils', () => ({}))
jest.mock('@src/utils/notifications/NotificationManager.js', () => ({ NotificationManager: {} }))
jest.mock('@src/utils/fileServerDataService', () => ({}))
jest.mock('next/cache', () => ({ revalidateTag: jest.fn() }))
jest.mock('@src/utils/cache/mediaPagesTags', () => ({}))
jest.mock('@src/lib/logger', () => ({
  createLogger: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })),
}))

const { DELETE } = require('@src/app/api/authenticated/[...admin]/route')

const wipe = () =>
  DELETE(
    { headers: new Headers({ 'X-Webhook-ID': 'valid-sync-webhook' }) },
    { params: Promise.resolve({ admin: ['admin', 'wipe-db'] }) }
  )

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'log').mockImplementation(() => {})
  mockDeleteMany.mockResolvedValue({ deletedCount: 1 })
  // A valid webhook ID: enough for POST, never for DELETE.
  mockIsAdminOrWebhook.mockResolvedValue(true)
})

afterEach(() => {
  console.log.mockRestore()
})

describe('DELETE /api/authenticated/admin/wipe-db', () => {
  test('refuses a caller whose only credential is a sync webhook ID', async () => {
    mockIsAdmin.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    )

    const response = await wipe()

    expect(response.status).toBe(401)
    expect(mockIsAdminOrWebhook).not.toHaveBeenCalled()
    expect(mockCollection).not.toHaveBeenCalled()
    expect(mockDeleteMany).not.toHaveBeenCalled()
  })

  test('lets a signed-in admin clear the four flat collections', async () => {
    mockIsAdmin.mockResolvedValue({ id: 'admin-1', role: 'admin' })

    const response = await wipe()

    expect(response.status).toBe(200)
    expect(mockCollection.mock.calls.map(([name]) => name)).toEqual([
      'FlatMovies',
      'FlatTVShows',
      'FlatSeasons',
      'FlatEpisodes',
    ])
    expect(mockDeleteMany).toHaveBeenCalledTimes(4)
  })
})
