/**
 * @jest-environment node
 *
 * The admin proxy for the processor's identity endpoints
 * (src/app/api/authenticated/admin/identity/[endpoint]/route.js). The
 * processor holds its reconcile report in memory and answers 202 until one
 * has run; that status has to reach the page unchanged so it can offer a run.
 */

const mockIsAdmin = jest.fn()
jest.mock('@src/utils/routeAuth', () => ({ isAdmin: (req) => mockIsAdmin(req) }))

const mockAuthHeaders = jest.fn()
jest.mock('@src/utils/backendAuth', () => ({ getBackendAuthHeaders: (req) => mockAuthHeaders(req) }))

// The catalog join for unmanaged folders: rows per collection, set by tests.
const mockRows = { FlatMovies: [], FlatTVShows: [] }
jest.mock('@src/lib/mongodb', () => ({
  __esModule: true,
  default: Promise.resolve({
    db: () => ({
      collection: (name) => ({
        find: (filter) => ({
          toArray: async () => (mockRows[name] || []).filter((r) => filter.originalTitle.$in.includes(r.originalTitle)),
        }),
      }),
    }),
  }),
}))

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body, init = {}) => ({ status: init.status ?? 200, json: async () => body }),
  },
}))

const { GET, POST } = require('@src/app/api/authenticated/admin/identity/[endpoint]/route')

const request = { headers: new Headers() }
const params = (endpoint) => ({ params: Promise.resolve({ endpoint }) })

function upstream(status, body, { json = true } = {}) {
  return {
    status,
    json: json ? async () => body : async () => { throw new Error('not json') },
  }
}

beforeEach(() => {
  mockIsAdmin.mockReset().mockResolvedValue({ id: 'admin' })
  mockAuthHeaders.mockReset().mockResolvedValue({ Authorization: 'Bearer t0k' })
  global.fetch = jest.fn()
})

describe('GET /api/authenticated/admin/identity/[endpoint]', () => {
  it('proxies the report with the admin bearer token and no caching', async () => {
    global.fetch.mockResolvedValue(upstream(200, { totals: { claimed: 3 } }))

    const res = await GET(request, params('report'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ totals: { claimed: 3 } })
    const [url, init] = global.fetch.mock.calls[0]
    expect(url).toMatch(/\/api\/identity\/report$/)
    expect(init.method).toBe('GET')
    expect(init.headers.Authorization).toBe('Bearer t0k')
    expect(init.cache).toBe('no-store')
  })

  it('joins unmanaged folders to the catalog so the page can pair them by TMDB id', async () => {
    mockRows.FlatMovies = [
      { _id: { toString: () => '6a4fa5575bd6dc41316ddacd' }, originalTitle: 'The End?', title: 'The End?', metadata: { id: 464737 } },
      { _id: { toString: () => 'other' }, originalTitle: 'Unrelated', title: 'Unrelated', metadata: { id: 1 } },
    ]
    mockRows.FlatTVShows = [{ _id: { toString: () => 'tv1' }, originalTitle: 'Local Show', title: 'Local Show', metadata: {} }]
    global.fetch.mockResolvedValue(
      upstream(200, {
        totals: {},
        unmanaged: { items: ['movies/The End?', 'tv/Local Show'], total: 2, truncated: 0 },
      })
    )

    const body = await (await GET(request, params('report'))).json()

    expect(body.unmanaged.items).toEqual(['movies/The End?', 'tv/Local Show'])
    expect(body.unmanaged.catalog).toEqual({
      'movies/The End?': { tmdbId: 464737, title: 'The End?', id: '6a4fa5575bd6dc41316ddacd' },
      'tv/Local Show': { tmdbId: null, title: 'Local Show', id: 'tv1' },
    })
  })

  it('passes a 202 "no reconcile yet" through unchanged', async () => {
    global.fetch.mockResolvedValue(upstream(202, { enabled: true, pending: true }))

    const res = await GET(request, params('report'))

    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ enabled: true, pending: true })
  })

  it('refuses a non-admin before touching the processor', async () => {
    const denied = new Response('no', { status: 401 })
    mockIsAdmin.mockResolvedValue(denied)

    const res = await GET(request, params('report'))

    expect(res).toBe(denied)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('knows only status and report', async () => {
    const res = await GET(request, params('reconcile'))
    expect(res.status).toBe(404)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('reports an unreachable processor as 502, not as a crash', async () => {
    global.fetch.mockRejectedValue(new Error('ECONNREFUSED'))

    const res = await GET(request, params('status'))

    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/unreachable.*ECONNREFUSED/)
  })

  it('reports a non-JSON upstream answer as 502 with its status', async () => {
    global.fetch.mockResolvedValue(upstream(500, null, { json: false }))

    const res = await GET(request, params('status'))

    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/500/)
  })
})

describe('POST /api/authenticated/admin/identity/[endpoint]', () => {
  it('runs a reconcile and returns the fresh report', async () => {
    global.fetch.mockResolvedValue(upstream(200, { totals: { write: 2 } }))

    const res = await POST(request, params('reconcile'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ totals: { write: 2 } })
    expect(global.fetch.mock.calls[0][1].method).toBe('POST')
  })

  it('does not let a POST reach a read-only endpoint', async () => {
    const res = await POST(request, params('report'))
    expect(res.status).toBe(404)
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
