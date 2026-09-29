/**
 * @jest-environment node
 */
/**
 * The home screen rows routes: your own rows for anyone signed in, someone
 * else's and the across-people changes for admins only, and the home page's
 * cached rows dropped for everyone a change touches.
 */

const mockUser = { current: null }
jest.mock('@src/utils/routeAuth', () => ({
  isAuthenticatedAndApproved: jest.fn(async () => mockUser.current),
}))

const mockRevalidateTag = jest.fn()
jest.mock('next/cache', () => ({ revalidateTag: (...args) => mockRevalidateTag(...args) }))

const mockHomeRows = {
  getHomeRows: jest.fn(async (userId) => ({ person: { id: userId }, rows: [], available: [] })),
  saveHomeRows: jest.fn(async (userId, rows) => ({ rows: rows.length })),
  listHomeRowPeople: jest.fn(async () => ({ people: [] })),
  listPeopleWithRowCounts: jest.fn(async () => []),
  addPlaylistToHomeScreens: jest.fn(async () => ({ added: ['u2', 'u3'], alreadyShowing: 0, skipped: 0 })),
  removePlaylistFromHomeScreens: jest.fn(async () => ({ removed: ['u2'] })),
}
jest.mock('@src/utils/watchlist/homeRows', () => {
  const actual = jest.requireActual('@src/utils/watchlist/homeRows')
  return {
    HomeRowsError: actual.HomeRowsError,
    isGlobalAdminUser: actual.isGlobalAdminUser,
    getHomeRows: (...args) => mockHomeRows.getHomeRows(...args),
    saveHomeRows: (...args) => mockHomeRows.saveHomeRows(...args),
    listHomeRowPeople: (...args) => mockHomeRows.listHomeRowPeople(...args),
    listPeopleWithRowCounts: (...args) => mockHomeRows.listPeopleWithRowCounts(...args),
    addPlaylistToHomeScreens: (...args) => mockHomeRows.addPlaylistToHomeScreens(...args),
    removePlaylistFromHomeScreens: (...args) => mockHomeRows.removePlaylistFromHomeScreens(...args),
  }
})
jest.mock('@src/lib/mongodb', () => ({ __esModule: true, default: Promise.resolve({}) }))
jest.mock('@src/lib/userQueries', () => ({ userQueries: {} }))

const rowsRoute = require('@src/app/api/authenticated/home-rows/route')
const peopleRoute = require('@src/app/api/authenticated/home-rows/people/route')
const { HomeRowsError } = jest.requireActual('@src/utils/watchlist/homeRows')

const BASE = 'https://cinema.example/api/authenticated/home-rows'
const MEMBER = { id: 'u1', role: 'user' }
const ADMIN = { id: 'a1', role: 'admin' }
const put = (body) => new Request(BASE, { method: 'PUT', body: JSON.stringify(body) })
const post = (body) => new Request(`${BASE}/people`, { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => {
  jest.clearAllMocks()
  mockUser.current = MEMBER
})

describe('/home-rows', () => {
  it('loads and saves your own rows', async () => {
    await rowsRoute.GET(new Request(BASE))
    expect(mockHomeRows.getHomeRows).toHaveBeenCalledWith('u1')

    const res = await rowsRoute.PUT(put({ rows: [{ playlistId: 'p1' }] }))
    expect(res.status).toBe(200)
    expect(mockHomeRows.saveHomeRows).toHaveBeenCalledWith('u1', [{ playlistId: 'p1' }])
    expect(mockRevalidateTag).toHaveBeenCalledWith('user-playlists-u1', { expire: 0 })
    expect(mockRevalidateTag).toHaveBeenCalledWith('user-data-u1', { expire: 0 })
  })

  it("won't show or change someone else's rows unless you're an admin", async () => {
    expect((await rowsRoute.GET(new Request(`${BASE}?userId=u2`))).status).toBe(403)
    expect((await rowsRoute.PUT(put({ rows: [], userId: 'u2' }))).status).toBe(403)
    expect(mockHomeRows.saveHomeRows).not.toHaveBeenCalled()

    mockUser.current = ADMIN
    await rowsRoute.GET(new Request(`${BASE}?userId=u2`))
    expect(mockHomeRows.getHomeRows).toHaveBeenCalledWith('u2')
    await rowsRoute.PUT(put({ rows: [], userId: 'u2' }))
    expect(mockHomeRows.saveHomeRows).toHaveBeenCalledWith('u2', [])
    expect(mockRevalidateTag).toHaveBeenCalledWith('user-playlists-u2', { expire: 0 })
  })

  it('answers a problem with the request with its own status', async () => {
    mockHomeRows.saveHomeRows.mockRejectedValueOnce(new HomeRowsError("Morgan can't open one of these playlists", 403))

    const res = await rowsRoute.PUT(put({ rows: [{ playlistId: 'p9' }] }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: "Morgan can't open one of these playlists" })
    expect(mockRevalidateTag).not.toHaveBeenCalled()
  })

  it('refuses a body that is not JSON', async () => {
    const res = await rowsRoute.PUT(new Request(BASE, { method: 'PUT', body: 'rows=1' }))
    expect(res.status).toBe(400)
  })
})

describe('/home-rows/people', () => {
  it('is for admins only', async () => {
    expect((await peopleRoute.GET(new Request(`${BASE}/people`))).status).toBe(403)
    expect((await peopleRoute.POST(post({ playlistId: 'p1', action: 'add', everyone: true }))).status).toBe(403)
  })

  it('lists people, for a playlist or with their row counts', async () => {
    mockUser.current = ADMIN
    await peopleRoute.GET(new Request(`${BASE}/people?playlistId=p1`))
    expect(mockHomeRows.listHomeRowPeople).toHaveBeenCalledWith('p1')

    await peopleRoute.GET(new Request(`${BASE}/people`))
    expect(mockHomeRows.listPeopleWithRowCounts).toHaveBeenCalled()
  })

  it('adds for the people named, and drops their cached rows', async () => {
    mockUser.current = ADMIN
    const res = await peopleRoute.POST(post({ playlistId: 'p1', action: 'add', userIds: ['u2', 'u3'], position: 'bottom' }))

    expect(res.status).toBe(200)
    expect(mockHomeRows.addPlaylistToHomeScreens).toHaveBeenCalledWith('p1', { userIds: ['u2', 'u3'], position: 'bottom' })
    expect(mockRevalidateTag.mock.calls.map(([tag]) => tag)).toEqual([
      'user-playlists-u2', 'user-data-u2', 'user-playlists-u3', 'user-data-u3',
    ])
  })

  it('needs everyone spelled out, so a request that forgets its list changes nobody', async () => {
    mockUser.current = ADMIN
    const res = await peopleRoute.POST(post({ playlistId: 'p1', action: 'remove' }))

    expect(res.status).toBe(400)
    expect(mockHomeRows.removePlaylistFromHomeScreens).not.toHaveBeenCalled()

    await peopleRoute.POST(post({ playlistId: 'p1', action: 'remove', everyone: true }))
    expect(mockHomeRows.removePlaylistFromHomeScreens).toHaveBeenCalledWith('p1', { userIds: null })
  })

  it('refuses an unknown action', async () => {
    mockUser.current = ADMIN
    expect((await peopleRoute.POST(post({ playlistId: 'p1', action: 'shuffle', everyone: true }))).status).toBe(400)
  })
})
