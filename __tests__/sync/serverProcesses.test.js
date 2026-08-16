const mockGetAllServers = jest.fn()
const mockGetWebhookIdForServer = jest.fn()

jest.mock('@src/utils/config', () => ({
  getAllServers: () => mockGetAllServers(),
}))

jest.mock('@src/utils/webhookServer', () => ({
  getWebhookIdForServer: (serverId) => mockGetWebhookIdForServer(serverId),
}))

import { fetchProcesses } from '@src/utils/server_track_processes'

describe('fetchProcesses', () => {
  let consoleErrorSpy

  beforeEach(() => {
    jest.clearAllMocks()
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    mockGetAllServers.mockReturnValue([
      { id: 'server1', internalEndpoint: 'http://server-one' },
      { id: 'server2', internalEndpoint: 'http://server-two' },
    ])
    mockGetWebhookIdForServer.mockImplementation(async (serverId) => `webhook-${serverId}`)
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('queries every server concurrently with webhook authentication and a timeout', async () => {
    const pending = new Map()
    global.fetch = jest.fn((url, options) => new Promise((resolve) => {
      pending.set(url, { options, resolve })
    }))

    const resultPromise = fetchProcesses()
    await Promise.resolve()
    await Promise.resolve()

    expect(global.fetch).toHaveBeenCalledTimes(2)

    pending.get('http://server-one/processes').resolve({
      ok: true,
      json: async () => ({ data: [{ id: 'one', status: 'running' }] }),
    })
    pending.get('http://server-two/processes').resolve({
      ok: true,
      json: async () => ({ data: [{ id: 'two', status: 'running' }] }),
    })

    await expect(resultPromise).resolves.toEqual([
      { server: 'server1', processes: [{ id: 'one', status: 'running' }] },
      { server: 'server2', processes: [{ id: 'two', status: 'running' }] },
    ])

    expect(pending.get('http://server-one/processes').options).toEqual(expect.objectContaining({
      headers: { 'x-webhook-id': 'webhook-server1' },
      signal: expect.anything(),
    }))
    expect(pending.get('http://server-two/processes').options).toEqual(expect.objectContaining({
      headers: { 'x-webhook-id': 'webhook-server2' },
      signal: expect.anything(),
    }))
  })

  it('keeps healthy server results when another server fails or returns invalid data', async () => {
    global.fetch = jest.fn(async (url) => {
      if (url.includes('server-one')) {
        return {
          ok: true,
          json: async () => ({ data: [{ id: 'one', status: 'running' }] }),
        }
      }

      return {
        ok: false,
        status: 401,
        json: async () => ({ error: 'Unauthorized' }),
      }
    })

    await expect(fetchProcesses()).resolves.toEqual([
      { server: 'server1', processes: [{ id: 'one', status: 'running' }] },
    ])
  })
})
