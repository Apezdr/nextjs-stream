/**
 * @jest-environment node
 *
 * The list pages' reads: GET /api/authenticated/media-list/{movie,tv,season-episodes}.
 * They were Server Actions, which the "View as" guard refuses (it can't tell
 * a read from a write by action id), so paging, filtering and an empty
 * season's retry failed while viewing as. As GETs they keep the actions'
 * answers and checks: the caller as the pages' SessionGate checks it
 * (approvedGate), their library scope and watch history from their session,
 * never from the request, and the cached fetch called with the page's own
 * arguments in the page's order, so the two share cache entries.
 */

const mockGetSession = jest.fn()
jest.mock('@src/lib/cachedAuth', () => ({ getSession: (...args) => mockGetSession(...args) }))
const mockMovieList = jest.fn(async () => ({ items: [] }))
const mockTVList = jest.fn(async () => ({ items: [] }))
jest.mock('@src/utils/cache/mediaListData', () => ({
  getCachedMovieListData: (...args) => mockMovieList(...args),
  getCachedTVListData: (...args) => mockTVList(...args),
}))
const mockSeason = jest.fn()
jest.mock('@src/utils/flatDatabaseUtils', () => ({ getFlatTVSeasonWithEpisodes: (...args) => mockSeason(...args) }))
const mockLogError = jest.fn()
jest.mock('@src/lib/logger', () => ({
  createLogger: () => ({ error: (...args) => mockLogError(...args), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }),
}))
// The caller's library access, as libraryAccessFor resolves it from their roles
const FULL = { id: 'all', scope: null, showIds: null }
const SCOPED = { id: 'scope-kids', scope: { movieRatingCap: 'PG', tvRatingCap: null, titles: [] }, showIds: [] }
const mockAccessFor = jest.fn((user) => (user.roles?.length ? SCOPED : FULL))
jest.mock('@src/lib/roles/libraryAccess', () => ({ libraryAccessFor: (...args) => mockAccessFor(...args) }))

const fs = require('fs')
const path = require('path')
const movieRoute = require('@src/app/api/authenticated/media-list/movie/route')
const tvRoute = require('@src/app/api/authenticated/media-list/tv/route')
const seasonRoute = require('@src/app/api/authenticated/media-list/season-episodes/route')
const { listSearchParams, listRequestOptions, listOptions } = require('@src/utils/mediaListUtils/listRequest')
const { parseSearchParamsToFilters } = require('@src/utils/mediaListUtils/shared')

const ROOT = path.join(__dirname, '..', '..')
const get = (route, pathAndQuery) => route.GET(new Request(`https://app.example/api/authenticated/media-list/${pathAndQuery}`))

beforeEach(() => {
  jest.clearAllMocks()
  mockGetSession.mockReset()
})

describe.each([
  ['movie', movieRoute, mockMovieList],
  ['tv', tvRoute, mockTVList],
])('GET /api/authenticated/media-list/%s', (kind, route, cached) => {
  it('answers a signed-out caller 401, and reads nothing', async () => {
    mockGetSession.mockResolvedValue(null)
    const response = await get(route, `${kind}?page=1`)
    expect(response.status).toBe(401)
    expect((await response.json()).code).toBe('AUTH_REQUIRED')
    expect(cached).not.toHaveBeenCalled()
  })

  it('answers an account awaiting approval 403 APPROVAL_PENDING, as the page turns it away', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'u1', approved: false } })
    const response = await get(route, `${kind}?page=1`)
    expect(response.status).toBe(403)
    expect((await response.json()).code).toBe('APPROVAL_PENDING')
    expect(cached).not.toHaveBeenCalled()
  })

  it('answers what the cached fetch returns', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'me' } })
    cached.mockResolvedValueOnce({ items: [{ title: 'x' }], totalCount: 1, totalPages: 1, currentPage: 1 })
    const response = await get(route, `${kind}?page=1`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ items: [{ title: 'x' }], totalCount: 1, totalPages: 1, currentPage: 1 })
  })

  it("lists only the caller's library scope, from their session, never from the request", async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'me', roles: ['kids'] } })
    await get(route, `${kind}?scopeId=all&access=all`)
    expect(mockAccessFor).toHaveBeenCalledWith(expect.objectContaining({ id: 'me', roles: ['kids'] }))
    // Keyed by the scope's id alone: the cached fetch resolves the access inside
    expect(cached).toHaveBeenCalledWith(expect.objectContaining({ userId: 'me', scopeId: 'scope-kids' }))
  })

  it("reads the signed-in user's own watch history, whatever userId the request carries", async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'me', approved: true } })
    await get(route, `${kind}?page=2&sortOrder=title&genres=Drama&userId=someone-else`)
    expect(cached).toHaveBeenCalledWith({
      page: 2,
      sortOrder: 'title',
      genres: ['Drama'],
      hdrTypes: [],
      resolutions: [],
      userId: 'me',
      scopeId: 'all',
    })
  })

  it('passes only the filter fields to the cached fetch', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'me' } })
    await get(route, `${kind}?page=x&hdrTypes=HDR10&hdrTypes=Dolby%20Vision&extra=ignored`)
    expect(cached.mock.calls[0][0]).toEqual({
      page: undefined,
      sortOrder: undefined,
      genres: [],
      hdrTypes: ['HDR10', 'Dolby Vision'],
      resolutions: [],
      userId: 'me',
      scopeId: 'all',
    })
  })

  it('calls the cached fetch with the page’s own arguments, in its order, so they share cache entries', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'me' } })
    // What the page renders from its URL, and what the client sends back for it
    const initialFilters = parseSearchParamsToFilters({ page: '3', sort: 'title', genres: 'Drama,Comedy', hdr: 'HDR10', res: '4K' })
    await get(route, `${kind}?${listSearchParams(initialFilters)}`)
    const pagesOwn = { ...initialFilters, userId: 'me', scopeId: 'all' }
    expect(cached.mock.calls[0][0]).toEqual(pagesOwn)
    expect(Object.keys(cached.mock.calls[0][0])).toEqual(Object.keys(pagesOwn))
  })

  it('answers 500 when the read fails, with no detail for the client', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'me' } })
    cached.mockRejectedValueOnce(new Error('connection to db-host:27017 refused'))
    const response = await get(route, `${kind}?page=1`)
    expect(response.status).toBe(500)
    expect(JSON.stringify(await response.json())).not.toMatch(/db-host/)
    expect(mockLogError).toHaveBeenCalled()
  })
})

describe('the list query (listRequest.js)', () => {
  it('carries the filters through unchanged: one key per value, so none is split', () => {
    const filters = { page: 4, sortOrder: 'newest', genres: ['Action, Adventure', 'Sci-Fi & Fantasy'], hdrTypes: [], resolutions: ['4K'] }
    const read = listRequestOptions(new URLSearchParams(listSearchParams(filters).toString()))
    expect(listOptions(read, 'me', 'all')).toEqual(listOptions(filters, 'me', 'all'))
    expect(read.genres).toEqual(['Action, Adventure', 'Sci-Fi & Fantasy'])
  })

  it('sends only strings in the arrays, and leaves out what is absent', () => {
    expect(listSearchParams({ genres: ['Drama', { $gt: '' }, 3] }).toString()).toBe('genres=Drama')
    expect(listSearchParams({}).toString()).toBe('')
  })
})

describe('GET /api/authenticated/media-list/season-episodes', () => {
  const season = (query) => get(seasonRoute, `season-episodes?${query}`)

  it('answers a signed-out caller 401, and reads nothing', async () => {
    mockGetSession.mockResolvedValue(null)
    expect((await season('showTitle=A%20Show&seasonNumber=1')).status).toBe(401)
    expect(mockSeason).not.toHaveBeenCalled()
  })

  it('answers whether the season has episodes now, and returns no episode documents', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'me' } })
    mockSeason.mockResolvedValue({ episodes: [{ videoURL: 'https://files.test/e1.mp4' }] })

    const response = await season(`showTitle=${encodeURIComponent('100% Wolf')}&seasonNumber=2`)

    // The title as given: decoded once, by the query parser
    expect(mockSeason).toHaveBeenCalledWith({ access: FULL, showTitle: '100% Wolf', seasonNumber: 2 })
    expect(await response.json()).toEqual({ success: true, hasEpisodes: true })

    mockSeason.mockResolvedValue({ episodes: [] })
    expect(await (await season('showTitle=A%20Show&seasonNumber=1')).json()).toEqual({ success: true, hasEpisodes: false })
  })

  it("checks the caller's library scope", async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'me', roles: ['kids'] } })
    mockSeason.mockResolvedValue(null)
    expect(await (await season('showTitle=A%20Show&seasonNumber=1')).json()).toEqual({ success: true, hasEpisodes: false })
    expect(mockSeason).toHaveBeenCalledWith(expect.objectContaining({ access: SCOPED }))
  })

  it('refuses a title or season that is not a plain value, before any query', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'me' } })
    for (const query of [
      'seasonNumber=1',
      'showTitle=&seasonNumber=1',
      'showTitle=A%20Show',
      'showTitle=A%20Show&seasonNumber=%7B%22%24gt%22%3A0%7D',
      'showTitle=A%20Show&seasonNumber=1%3B%20drop',
      'showTitle=A%20Show&seasonNumber=12345',
    ]) {
      expect([query, await (await season(query)).json()]).toEqual([query, { success: false, hasEpisodes: false }])
    }
    expect(mockSeason).not.toHaveBeenCalled()
  })

  it('answers no on a failure, with no error detail for the client', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'me' } })
    mockSeason.mockRejectedValue(new Error('connection to db-host:27017 refused'))
    const response = await season('showTitle=A%20Show&seasonNumber=1')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: false, hasEpisodes: false })
  })
})

describe('the move off Server Actions', () => {
  it('the actions are gone, and nothing in src imports them', () => {
    expect(fs.existsSync(path.join(ROOT, 'src', 'utils', 'actions', 'mediaListActions.js'))).toBe(false)
    expect(fs.existsSync(path.join(ROOT, 'src', 'utils', 'actions', 'refreshEpisodes.js'))).toBe(false)
    const offenders = []
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (/\.(js|jsx|ts|tsx)$/.test(entry.name) && /mediaListActions|actions\/refreshEpisodes/.test(fs.readFileSync(full, 'utf8'))) {
          offenders.push(path.relative(ROOT, full))
        }
      }
    }
    walk(path.join(ROOT, 'src'))
    expect(offenders).toEqual([])
  })

  it('the list clients load a filter, sort or page change through the GET, applying only the latest answer', () => {
    for (const [file, fetcher] of [
      ['MovieListClient.js', 'fetchMovieListData'],
      ['TVListClient.js', 'fetchTVListData'],
    ]) {
      const source = fs.readFileSync(path.join(ROOT, 'src', 'components', 'MediaPages', file), 'utf8')
      expect(source).toContain(`import { ${fetcher} } from '@components/MediaPages/mediaListApi'`)
      expect(source).toMatch(new RegExp(`const nextData = await ${fetcher}\\(\\{\\s+\\.\\.\\.filters,\\s+page\\s+\\}\\);`))
      expect(source).toMatch(/if \(nextData && requestId === requestIdRef\.current\) \{\s+setData\(nextData\);/)
    }
  })
})
