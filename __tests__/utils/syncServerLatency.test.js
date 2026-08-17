jest.mock('@src/utils/config', () => ({
  getAllServers: jest.fn(),
  getWebhookIdForServer: jest.fn(async (serverId) => `webhook-${serverId}`),
}))
jest.mock('@src/utils/serverDisplayNames', () => ({ getServersWithDisplayNames: jest.fn() }))

import {
  getRemoteSyncServerLatencies,
  measureRemoteSyncServerLatencies,
  resetRemoteSyncServerLatencyCache,
} from '@src/utils/syncServerLatency'
import { getAllServers } from '@src/utils/config'
import { getServersWithDisplayNames } from '@src/utils/serverDisplayNames'

describe('remote sync-server latency', () => {
  beforeEach(() => resetRemoteSyncServerLatencyCache())
  test('excludes the default server and probes remote servers concurrently', async () => {
    const pending = []
    const fetchImpl = jest.fn((url, options) => new Promise((resolve) => {
      pending.push({ url, options, resolve })
    }))
    const promise = measureRemoteSyncServerLatencies([
      { id: 'default', displayName: 'Local', isDefault: true, internalEndpoint: 'http://local' },
      { id: 'server2', displayName: 'Remote A', isDefault: false, internalEndpoint: 'https://a.test/node' },
      { id: 'server3', displayName: 'Remote B', isDefault: false, syncEndpoint: 'https://b.test/node' },
    ], { fetchImpl, now: () => 100 })

    await Promise.resolve()
    await Promise.resolve()
    expect(pending).toHaveLength(2)
    for (const request of pending) {
      request.resolve({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) })
    }

    const result = await promise
    expect(result.servers.map((server) => server.serverId)).toEqual(['server2', 'server3'])
    expect(pending[0].url).toBe('https://a.test/node/api/system-status')
    expect(pending[0].options.headers).toEqual({ 'X-Webhook-ID': 'webhook-server2' })
    expect(result.servers[0]).not.toHaveProperty('endpoint')
  })

  test('reports nullable latency when a remote server cannot be reached', async () => {
    const result = await measureRemoteSyncServerLatencies([
      { id: 'server2', displayName: 'Remote', isDefault: false, syncEndpoint: 'https://remote.test' },
    ], {
      fetchImpl: jest.fn().mockRejectedValue(Object.assign(new Error('offline'), { name: 'TypeError' })),
      now: () => 100,
    })

    expect(result.servers[0]).toMatchObject({
      state: 'unavailable',
      latencyMs: null,
      reason: 'network-error',
    })
  })

  test('serves cached probes normally and bypasses them for Check now', async () => {
    getAllServers.mockReturnValue([
      { id: 'default', isDefault: true, syncEndpoint: 'https://local.test' },
      { id: 'server2', isDefault: false, syncEndpoint: 'https://remote.test' },
    ])
    getServersWithDisplayNames.mockResolvedValue([
      { id: 'default', displayName: 'Local' },
      { id: 'server2', displayName: 'Remote' },
    ])
    const originalFetch = global.fetch
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(0),
    })
    try {
      await getRemoteSyncServerLatencies()
      await getRemoteSyncServerLatencies()
      expect(global.fetch).toHaveBeenCalledTimes(1)

      await getRemoteSyncServerLatencies({ force: true })
      expect(global.fetch).toHaveBeenCalledTimes(2)
    } finally {
      global.fetch = originalFetch
    }
  })
})