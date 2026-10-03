/**
 * fetchProcesses reads each processor's /processes. That route answers 401
 * without credentials, and an unauthenticated poll used to come back as an
 * empty list, so the Active Processes card said "No active processes" for
 * everything, library scans included.
 */
jest.mock('@src/utils/config', () => ({
  getAllServers: () => [{ id: 'default', internalEndpoint: 'http://processor:3000' }],
}))

const { fetchProcesses } = require('@src/utils/server_track_processes')

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  jest.restoreAllMocks()
  delete global.fetch
})

describe('fetchProcesses', () => {
  it('sends the admin session to the processor and asks only for active rows', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: [{ file_key: 'library_scan_tv', status: 'in-progress' }] }),
    }))

    const result = await fetchProcesses({ activeOnly: true, headers: { Authorization: 'Bearer abc' } })

    expect(global.fetch).toHaveBeenCalledWith('http://processor:3000/processes?active=true', {
      headers: { Authorization: 'Bearer abc' },
    })
    expect(result).toEqual([{ server: 'default', processes: [{ file_key: 'library_scan_tv', status: 'in-progress' }] }])
  })

  it('reports a refused request instead of passing it off as an empty list', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 401, json: async () => ({ error: 'Authentication required' }) }))

    const result = await fetchProcesses({ activeOnly: true })

    expect(result).toEqual([])
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('HTTP 401'))
  })
})
