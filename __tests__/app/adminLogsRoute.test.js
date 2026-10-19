/**
 * @jest-environment node
 *
 * The admin proxy for a processor's own log
 * (src/app/api/authenticated/admin/logs/route.ts). The Logs page used to call
 * the processor's /api/logs straight from the browser, and that endpoint
 * answered anyone; the processor now wants an admin session, which only this
 * route forwards.
 */

const mockIsAdmin = jest.fn()
jest.mock('@src/utils/routeAuth', () => ({ isAdmin: (req) => mockIsAdmin(req) }))

const mockAuthHeaders = jest.fn()
jest.mock('@src/utils/backendAuth', () => ({ getBackendAuthHeaders: (req) => mockAuthHeaders(req) }))

jest.mock('@src/utils/config', () => ({
  getAllServers: () => [
    { id: 'default', syncEndpoint: 'https://public.example/nodejs', internalEndpoint: 'http://processor:3000/' },
    { id: 'server2', syncEndpoint: 'https://two.example/nodejs' },
  ],
}))

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body, init = {}) => ({ status: init.status ?? 200, json: async () => body }),
  },
}))

const { GET } = require('@src/app/api/authenticated/admin/logs/route')

const request = (query) => ({ url: `http://app.example/api/authenticated/admin/logs?${query}`, headers: new Headers() })

function upstream(status, body, { json = true } = {}) {
  return { status, json: json ? async () => body : async () => { throw new Error('not json') } }
}

beforeEach(() => {
  mockIsAdmin.mockReset().mockResolvedValue({ id: 'admin' })
  mockAuthHeaders.mockReset().mockResolvedValue({ Authorization: 'Bearer t0k' })
  global.fetch = jest.fn()
})

describe('GET /api/authenticated/admin/logs', () => {
  it('turns away a non-admin before calling the processor', async () => {
    const denied = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    mockIsAdmin.mockResolvedValue(denied)

    expect(await GET(request('server=default'))).toBe(denied)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('asks the processor on its internal URL with the admin token, forwarding only the log parameters', async () => {
    const page = { entries: [{ id: '2026-10-19.22:0', message: 'scan started' }], older: null, newer: '2026-10-19.22:120' }
    global.fetch.mockResolvedValue(upstream(200, page))

    const res = await GET(
      request('server=default&limit=500&hide=area%3Ascan&level=warn&q=tmdb%20404&from=2026-10-19T21%3A00%3A00.000Z&after=2026-10-19.22%3A0&evil=1')
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(page)
    const [url, init] = global.fetch.mock.calls[0]
    expect(url).toBe(
      'http://processor:3000/api/logs?limit=500&hide=area%3Ascan&level=warn&q=tmdb+404&from=2026-10-19T21%3A00%3A00.000Z&after=2026-10-19.22%3A0'
    )
    expect(init.headers.Authorization).toBe('Bearer t0k')
    expect(init.cache).toBe('no-store')
  })

  it('keeps the path prefix of a server reached on its public URL', async () => {
    global.fetch.mockResolvedValue(upstream(200, { entries: [] }))

    await GET(request('server=server2'))

    expect(global.fetch.mock.calls[0][0]).toBe('https://two.example/nodejs/api/logs?')
  })

  it('rejects an unknown server without calling anything', async () => {
    const res = await GET(request('server=nope'))

    expect(res.status).toBe(400)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('passes a processor 400 through, and reports a refused token as an upstream failure, not a lost session', async () => {
    global.fetch.mockResolvedValueOnce(upstream(400, { error: 'limit must be a whole number from 1 to 2000' }))
    const bad = await GET(request('server=default&limit=0'))
    expect(bad.status).toBe(400)
    expect((await bad.json()).error).toContain('limit')

    global.fetch.mockResolvedValueOnce(upstream(403, { error: 'Admin privileges required' }))
    const refused = await GET(request('server=default'))
    expect(refused.status).toBe(502)
    expect((await refused.json()).error).toBe('The media processor refused the request (403): Admin privileges required')
  })

  it('answers 502 when the processor is down or answers without JSON', async () => {
    global.fetch.mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
    const down = await GET(request('server=default'))
    expect(down.status).toBe(502)
    expect((await down.json()).error).toContain('ECONNREFUSED')

    global.fetch.mockResolvedValueOnce(upstream(504, null, { json: false }))
    expect((await GET(request('server=default'))).status).toBe(502)
  })
})
