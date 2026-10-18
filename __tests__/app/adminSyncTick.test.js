/**
 * @jest-environment node
 *
 * POST /api/authenticated/admin/sync starts a sync tick and answers 202; the
 * tick runs in the background. A tick whose payloads are unchanged ends at the
 * conditional fetch (fetchSyncTick): no fieldAvailability, no pass, and no
 * admin "sync complete" notification. Any other tick hands the run the tick
 * itself: its payloads, which servers did not answer and the ETags to record
 * when the pass completes.
 */

const mockFetchSyncTick = jest.fn()
const mockSyncAllServers = jest.fn()
const mockNotify = jest.fn(async () => [])
const mockCreateDatabaseAdapter = jest.fn(async () => ({}))
const mockCollectFieldAvailability = jest.fn()

jest.mock('@src/utils/routeAuth', () => ({
  isAdmin: jest.fn(async () => ({ id: 'admin-1' })),
  isAdminOrWebhook: jest.fn(async () => true),
}))
jest.mock('@src/utils/sync/run/syncAllServers', () => ({
  fetchSyncTick: (...args) => mockFetchSyncTick(...args),
  syncAllServers: (...args) => mockSyncAllServers(...args),
}))
jest.mock('@src/utils/notifications/NotificationManager.js', () => ({
  NotificationManager: { createSyncCompleteForAdmins: (...args) => mockNotify(...args) },
}))
jest.mock('@src/utils/sync/infrastructure', () => ({
  createDatabaseAdapter: (...args) => mockCreateDatabaseAdapter(...args),
}))
jest.mock('@src/utils/sync/run/availability', () => ({
  buildFieldAvailability: async (...args) => {
    mockCollectFieldAvailability(...args)
    return { movies: {}, tv: {} }
  },
}))
jest.mock('@src/utils/sync/core/events', () => ({ syncEventBus: { subscribe: () => () => {} } }))
jest.mock('@src/utils/sync/core/types', () => ({ SyncEventType: {} }))
jest.mock('@src/utils/sync_db', () => ({ getFileServerImportSettings: jest.fn(async () => ({})) }))
jest.mock('@src/utils/cache/postSyncRevalidation', () => ({
  countChangedMedia: () => 0,
  requestMediaRevalidation: jest.fn(),
}))
jest.mock('@src/utils/sync/run/appliedPayloads', () => ({ forgetAppliedPayloads: jest.fn() }))

// The route's other dependencies play no part in a sync tick.
jest.mock('next/cache', () => ({ revalidateTag: jest.fn(), updateTag: jest.fn() }))
jest.mock('@src/lib/mongodb', () => ({ __esModule: true, default: Promise.resolve({}) }))
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
jest.mock('@src/utils/config', () => ({}))
jest.mock('@src/utils/monitor_server_load', () => ({ monitorConfig: {} }))
jest.mock('@src/utils/server_track_processes', () => ({}))
jest.mock('@src/utils/backendAuth', () => ({ getBackendAuthHeaders: jest.fn(async () => ({})) }))
jest.mock('@src/utils/sync_verification', () => ({}))
jest.mock('@src/utils/auth_utils', () => ({}))
jest.mock('@src/lib/logger', () => ({
  createLogger: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })),
}))

const { POST, GET } = require('@src/app/api/authenticated/[...admin]/route')

const startSync = ({ webhook = true, body = { forceSync: false } } = {}) =>
  POST(
    new Request('http://127.0.0.1:3000/api/authenticated/admin/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(webhook ? { 'X-Webhook-ID': 'sync-webhook' } : {}),
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ admin: ['admin', 'sync'] }) }
  )

/** Wait until the background tick has settled (sync-status no longer active). */
async function untilIdle() {
  for (let i = 0; i < 100; i++) {
    await new Promise((resolve) => setImmediate(resolve))
    const status = await GET(
      new Request('http://127.0.0.1:3000/api/authenticated/admin/sync-status'),
      { params: Promise.resolve({ admin: ['admin', 'sync-status'] }) }
    )
    if (!(await status.json()).active) return
  }
  throw new Error('the sync tick never settled')
}

const ETAGS = { default: { tv: 'W/"tv-2"', movies: '"movies-1"' } }

beforeEach(() => {
  mockFetchSyncTick.mockReset()
  mockSyncAllServers.mockReset()
  mockSyncAllServers.mockResolvedValue({ errors: [], changedMedia: { movies: [], shows: [], seasons: [], episodes: [] } })
  mockNotify.mockClear()
  mockCreateDatabaseAdapter.mockClear()
  mockCollectFieldAvailability.mockClear()
  for (const method of ['log', 'info', 'warn', 'error']) jest.spyOn(console, method).mockImplementation(() => {})
})

afterEach(() => {
  jest.restoreAllMocks()
})

it('ends a skipped tick before the pass, with no admin notification', async () => {
  mockFetchSyncTick.mockResolvedValue({ skipped: true, result: { skipped: true, reason: 'payloads_unchanged' } })

  const response = await startSync()
  expect(response.status).toBe(202)
  await untilIdle()

  expect(mockFetchSyncTick).toHaveBeenCalledTimes(1)
  expect(mockFetchSyncTick).toHaveBeenCalledWith({ forceSync: false, allowSkip: true })
  expect(mockCollectFieldAvailability).not.toHaveBeenCalled()
  expect(mockCreateDatabaseAdapter).not.toHaveBeenCalled()
  expect(mockSyncAllServers).not.toHaveBeenCalled()
  expect(mockNotify).not.toHaveBeenCalled()
  // Ended by returning the skip, not by failing on the way
  expect(console.error).not.toHaveBeenCalledWith('Sync operation failed:', expect.anything())
})

it('runs the pass on a tick that is not skipped, with the ETags of the payloads it fetched', async () => {
  const fileServers = { default: { config: { priority: 1 }, movies: { 'Movie A': {} }, tv: {} } }
  mockFetchSyncTick.mockResolvedValue({ skipped: false, fileServers, errors: undefined, etags: ETAGS })

  await startSync()
  await untilIdle()

  expect(mockSyncAllServers).toHaveBeenCalledTimes(1)
  // The run builds fieldAvailability and the every-server flag from the tick, under its lock
  expect(mockSyncAllServers).toHaveBeenCalledWith(
    expect.objectContaining({ fileServers, errors: undefined, etags: ETAGS }),
    { forceSync: false }
  )
  expect(mockNotify).toHaveBeenCalledTimes(1)
  expect(console.error).not.toHaveBeenCalledWith('Sync operation failed:', expect.anything())
})

it('tells the admins what the run added: the documents its passes created, per kind', async () => {
  const fileServers = { default: { config: { priority: 1 }, movies: { 'Movie A': {} }, tv: {} } }
  mockFetchSyncTick.mockResolvedValue({ skipped: false, fileServers, errors: undefined, etags: ETAGS })
  mockSyncAllServers.mockResolvedValue({
    errors: [],
    changedMedia: { movies: ['Movie A', 'Movie B'], shows: ['Show A'], seasons: [], episodes: [] },
    added: { movies: 1, shows: 1, episodes: 4 },
  })

  await startSync()
  await untilIdle()

  expect(mockNotify).toHaveBeenCalledWith('default', {
    moviesAdded: 1,
    showsAdded: 1,
    episodesAdded: 4,
    duration: expect.stringMatching(/ minutes$/),
  })
})

it('never lets a sync started from the admin UI skip; the per-title gates still apply', async () => {
  // A UI request carries no X-Webhook-ID: it was authenticated as an admin
  const fileServers = { default: { config: { priority: 1 }, movies: {}, tv: { 'Show A': {} } } }
  mockFetchSyncTick.mockResolvedValue({ skipped: false, fileServers, errors: undefined, etags: ETAGS })

  await startSync({ webhook: false })
  await untilIdle()

  expect(mockFetchSyncTick).toHaveBeenCalledWith({ forceSync: false, allowSkip: false })
  // Not forced: titles whose gates match are still skipped inside the pass
  expect(mockSyncAllServers).toHaveBeenCalledWith(expect.objectContaining({ fileServers }), { forceSync: false })
})
