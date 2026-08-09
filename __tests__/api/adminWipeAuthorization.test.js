jest.mock('@src/utils', () => ({ buildURL: jest.fn() }))
jest.mock('@src/utils/routeAuth', () => ({
  isAdmin: jest.fn(),
  isAdminOrWebhook: jest.fn(),
}))
jest.mock('@src/utils/admin_database', () => ({}))
jest.mock('@src/utils/flatDatabaseUtils', () => ({}))
jest.mock('@src/utils/playbackPresence/database', () => ({}))
jest.mock('mongodb', () => ({ ObjectId: jest.fn((value) => value) }))
jest.mock('@src/lib/userQueries', () => ({ userQueries: {} }))
jest.mock('@src/utils/admin_utils', () => ({}))
jest.mock('axios', () => ({ __esModule: true, default: {} }))
jest.mock('chalk', () => ({ __esModule: true, default: {} }))
jest.mock('@src/utils/sync_db', () => ({}))
jest.mock('@src/utils/config', () => ({}))
jest.mock('@src/utils/monitor_server_load', () => ({
  getCpuUsage: jest.fn(() => 12.5),
  getCpuInfo: jest.fn(() => ({
    state: 'partial',
    model: 'Test CPU',
    logicalThreads: 16,
    clockMHz: 3200,
    temperatureC: null,
  })),
  getMemoryUsed: jest.fn(() => 8),
  getMemoryTotal: jest.fn(() => 32),
  getMemoryUsage: jest.fn(() => 25),
  getMemoryInfo: jest.fn(() => ({
    state: 'available',
    scope: 'container',
    cachedBytes: 1024,
    committedBytes: 2048,
    commitLimitBytes: 4096,
    hardware: { speedMTs: 5600, slotsUsed: 2, totalSlots: 4 },
  })),
  getDiskStats: jest.fn(() => []),
  getDiskSummary: jest.fn(() => ({
    state: 'available',
    scope: 'container',
    capacity: { percent: 25, totalGiB: 100, usedGiB: 25, availableGiB: 75 },
    io: { state: 'available', readBytesPerSecond: 1000, writeBytesPerSecond: 2000 },
  })),
  getNetworkStats: jest.fn(() => ({
    state: 'available',
    scope: 'container',
    total: { rxMbps: 5, txMbps: 2, totalMbps: 7 },
  })),
  getGpuStats: jest.fn(() => ({
    state: 'available',
    status: 'normal',
    devices: [{ index: 0, name: 'NVIDIA RTX 4090', utilizationPct: 20, temperatureC: 50 }],
  })),
  getTelemetryHistory: jest.fn(() => [
    { timestamp: '2026-08-08T00:00:00.000Z', cpuPct: 12.5, memoryPct: 25 },
  ]),
  monitorConfig: {
    cpuEnabled: true,
    memoryEnabled: true,
    diskEnabled: true,
    networkEnabled: true,
    gpuEnabled: true,
  },
}))
jest.mock('@src/utils/server_track_processes', () => ({}))
jest.mock('@src/utils/sync', () => ({}))
jest.mock('@src/utils/sync/core/events', () => ({ syncEventBus: {} }))
jest.mock('@src/utils/sync/core/types', () => ({ SyncEventType: {} }))
jest.mock('@src/utils/sync/infrastructure', () => ({}))
jest.mock('@src/utils/sync_verification', () => ({}))
jest.mock('@src/utils/auth_utils', () => ({}))
jest.mock('@src/utils/notifications/NotificationManager.js', () => ({
  NotificationManager: {},
}))
jest.mock('@src/utils/fileServerDataService', () => ({}))
jest.mock('next/cache', () => ({ revalidateTag: jest.fn() }))
jest.mock('@src/utils/cache/mediaPagesTags', () => ({}))
jest.mock('@src/lib/logger', () => ({
  createLogger: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })),
}))
jest.mock('@src/lib/mongodb', () => {
  const deleteMany = jest.fn().mockResolvedValue({ deletedCount: 1 })
  const collection = jest.fn(() => ({ deleteMany }))
  return {
    __esModule: true,
    default: Promise.resolve({ db: () => ({ collection }) }),
    __mockDeleteMany: deleteMany,
    __mockCollection: collection,
  }
})

global.Response = class Response {
  constructor(body, init = {}) {
    this.body = body
    this.status = init.status || 200
    this.headers = init.headers || {}
  }

  async json() {
    return JSON.parse(this.body)
  }
}

const { DELETE, GET } = require('@src/app/api/authenticated/[...admin]/route')
const { isAdmin, isAdminOrWebhook } = require('@src/utils/routeAuth')
const { __mockDeleteMany, __mockCollection } = require('@src/lib/mongodb')

const request = {
  headers: new Headers({ 'X-Webhook-ID': 'valid-sync-webhook' }),
}
const props = { params: Promise.resolve({ admin: ['admin', 'wipe-db'] }) }

beforeEach(() => {
  jest.clearAllMocks()
  isAdminOrWebhook.mockResolvedValue(true)
})

describe('DELETE /api/authenticated/admin/wipe-db', () => {
  it('does not grant destructive authority to a sync webhook', async () => {
    isAdmin.mockResolvedValue(new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401 }
    ))

    const response = await DELETE(request, props)

    expect(response.status).toBe(401)
    expect(isAdmin).toHaveBeenCalledWith(request)
    expect(isAdminOrWebhook).not.toHaveBeenCalled()
    expect(__mockCollection).not.toHaveBeenCalled()
    expect(__mockDeleteMany).not.toHaveBeenCalled()
  })

  it('allows an authenticated admin to clear the four flat collections', async () => {
    isAdmin.mockResolvedValue({ id: 'admin-id', role: 'admin' })

    const response = await DELETE(request, props)

    expect(response.status).toBe(200)
    expect(__mockDeleteMany).toHaveBeenCalledTimes(4)
    expect(__mockCollection.mock.calls.map(([name]) => name)).toEqual([
      'FlatMovies',
      'FlatTVShows',
      'FlatSeasons',
      'FlatEpisodes',
    ])
  })
})

describe('GET /api/authenticated/admin/server-load', () => {
  it('returns network and GPU snapshots only to an authenticated admin', async () => {
    isAdmin.mockResolvedValue({ id: 'admin-id', role: 'admin' })

    const response = await GET(
      { headers: new Headers() },
      { params: Promise.resolve({ admin: ['admin', 'server-load'] }) }
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      cpu: 12.5,
      cpuInfo: { model: 'Test CPU', logicalThreads: 16, clockMHz: 3200 },
      memoryInfo: { state: 'available', hardware: { speedMTs: 5600 } },
      disk: { state: 'available', capacity: { percent: 25 } },
      history: [expect.objectContaining({ cpuPct: 12.5 })],
      network: { state: 'available', scope: 'container' },
      gpus: {
        state: 'available',
        devices: [expect.objectContaining({ name: 'NVIDIA RTX 4090' })],
      },
      config: { networkEnabled: true, gpuEnabled: true },
    })
    expect(response.headers).toMatchObject({
      'Cache-Control': 'private, no-store',
      'Vary': 'Cookie, Authorization',
    })
  })
})