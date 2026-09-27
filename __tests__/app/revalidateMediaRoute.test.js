/**
 * @jest-environment node
 *
 * The sync (and its background cleanup) revalidates through POST
 * /api/authenticated/admin/revalidate-media. The /list banner is a cached list
 * of movies: this route must expire it outright when movies changed or were
 * removed, and leave it alone for the TV-only changes most syncs make.
 */

const mockRevalidateTag = jest.fn()
jest.mock('next/cache', () => ({
  revalidateTag: (...args) => mockRevalidateTag(...args),
  updateTag: jest.fn(),
}))

jest.mock('@src/utils/routeAuth', () => ({
  isAdmin: jest.fn(),
  isAdminOrWebhook: jest.fn(async () => true),
}))

// The route's other dependencies play no part in revalidate-media.
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
jest.mock('@src/lib/logger', () => ({
  createLogger: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })),
}))

const { POST } = require('@src/app/api/authenticated/[...admin]/route')

const revalidate = (body) =>
  POST(
    new Request('http://127.0.0.1:3000/api/authenticated/admin/revalidate-media', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Webhook-ID': 'internal-hook' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ admin: ['admin', 'revalidate-media'] }) }
  )

beforeEach(() => {
  mockRevalidateTag.mockReset()
  jest.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  console.log.mockRestore()
})

it('expires the banner when movies changed', async () => {
  const response = await revalidate({ movies: ['Heat'], shows: [], seasons: [], episodes: [] })

  expect(response.status).toBe(200)
  await expect(response.json()).resolves.toMatchObject({ bannerExpired: true })
  expect(mockRevalidateTag).toHaveBeenCalledWith('banner', { expire: 0 })
  // Everything else keeps stale-while-revalidate
  expect(mockRevalidateTag).toHaveBeenCalledWith('movies', 'max')
  expect(mockRevalidateTag).not.toHaveBeenCalledWith('movies', { expire: 0 })
})

it('leaves the banner alone when only TV changed', async () => {
  const response = await revalidate({
    movies: [],
    shows: ['Severance'],
    seasons: [{ title: 'Severance', season: 2 }],
    episodes: [{ title: 'Severance', season: 2, episode: 1 }],
  })

  await expect(response.json()).resolves.toMatchObject({ bannerExpired: false })
  expect(mockRevalidateTag).not.toHaveBeenCalledWith('banner', expect.anything())
})
