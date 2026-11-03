/**
 * @jest-environment node
 *
 * libraryAccessFor (src/lib/roles/libraryAccess.ts): a user's library access
 * from their roles. The common case (an admin, a user with no scoped role)
 * must cost nothing: no role read for a user with no roles, no library read
 * for anyone with the whole library, and the one shared 'all' id. A scoped
 * user gets the union of their roles' scopes under one id per scope, so users
 * with the same scope share cache entries; what the scope holds comes from one
 * catalog of the library per process, shared by every scope, not a read per
 * request. A role this process can't find counts as an empty scope.
 */

const mockListRoles = jest.fn()
const mockForgetRoles = jest.fn()
jest.mock('@src/lib/roles/store', () => ({
  listRoles: (...args) => mockListRoles(...args),
  forgetRoles: (...args) => mockForgetRoles(...args),
}))
const mockCatalog = { FlatMovies: [], FlatTVShows: [] }
const mockFind = jest.fn((name) => mockCatalog[name])
jest.mock('@src/lib/mongodb', () => ({
  __esModule: true,
  default: Promise.resolve({
    db: () => ({ collection: (name) => ({ find: (...args) => ({ toArray: async () => mockFind(name, ...args) }) }) }),
  }),
}))

const { libraryAccessById, libraryAccessFor, libraryScopeIndex, scopeIdOf } = require('@src/lib/roles/libraryAccess')
const { FULL_LIBRARY } = require('@src/lib/roles/libraryScope')

const KIDS = { id: 'r-kids', name: 'Kids', grants: {}, scope: { movieRatingCap: 'PG', tvRatingCap: 'TV-Y7', titles: [] } }
const PICKS = {
  id: 'r-picks',
  name: 'Picks',
  grants: {},
  scope: { movieRatingCap: null, tvRatingCap: null, titles: [{ mediaType: 'tv', originalTitle: 'Picked', access: 'play' }] },
}
const REQUESTER = { id: 'r-req', name: 'Requester', grants: { 'arr.manage': {} }, scope: null }

const title = (id, originalTitle, rating, tmdbId) => ({ _id: { toString: () => id }, originalTitle, metadata: { rating, id: tmdbId } })

let roles
beforeEach(() => {
  roles = [KIDS, PICKS, REQUESTER]
  mockListRoles.mockReset().mockImplementation(async () => roles)
  mockForgetRoles.mockReset()
  mockFind.mockClear()
  mockCatalog.FlatMovies = [title('m1', 'Cartoon', 'G', 11), title('m2', 'Thriller', 'R', 12), title('m3', 'Thriller Cut', 'PG', 12)]
  mockCatalog.FlatTVShows = [title('b2', 'Puppets', 'TV-Y', 21), title('a1', 'Picked', 'TV-MA', 22), title('c3', 'Crime', 'TV-MA', 23)]
})

describe('the whole library costs nothing', () => {
  it('an admin, whatever roles they hold: no role read, no library read', async () => {
    expect(await libraryAccessFor({ role: 'admin', roles: ['r-kids'] })).toBe(FULL_LIBRARY)
    expect(mockListRoles).not.toHaveBeenCalled()
    expect(mockFind).not.toHaveBeenCalled()
  })

  it('a user with no roles: no role read', async () => {
    expect(await libraryAccessFor({ role: 'user' })).toBe(FULL_LIBRARY)
    expect(await libraryAccessFor({ role: 'user', roles: [] })).toBe(FULL_LIBRARY)
    expect(mockListRoles).not.toHaveBeenCalled()
  })

  it('a user whose roles carry no scope: the process copy of the roles, no library read', async () => {
    expect(await libraryAccessFor({ role: 'user', roles: ['r-req'] })).toBe(FULL_LIBRARY)
    expect(mockFind).not.toHaveBeenCalled()
  })

  it('the whole library has no index and resolves by its id with no read', async () => {
    expect(await libraryScopeIndex(FULL_LIBRARY)).toBeNull()
    expect(await libraryAccessById('all')).toBe(FULL_LIBRARY)
    expect(mockFind).not.toHaveBeenCalled()
  })
})

describe('a scoped user', () => {
  it('gets the union of their scoped roles, an unscoped role adding nothing', async () => {
    const access = await libraryAccessFor({ role: 'user', roles: ['r-req', 'r-picks', 'r-kids'] })
    expect(access.scope).toEqual({
      movieRatingCap: 'PG',
      tvRatingCap: 'TV-Y7',
      titles: [{ mediaType: 'tv', originalTitle: 'Picked', access: 'play' }],
    })
    expect(access.id).toBe(scopeIdOf(access.scope))
    expect(access.id).toMatch(/^scope-[0-9a-f]{20}$/)
    // The shows in scope, sorted: under the cap (b2), or picked (a1)
    expect(access.showIds).toEqual(['a1', 'b2'])
  })

  it('shares one id with every user of the same scope, and one catalog read with every scope', async () => {
    const first = await libraryAccessFor({ role: 'user', roles: ['r-kids'] })
    const second = await libraryAccessFor({ role: 'user', roles: ['r-kids', 'r-req'] })
    const other = await libraryAccessFor({ role: 'user', roles: ['r-picks'] })
    expect(second.id).toBe(first.id)
    expect(other.id).not.toBe(first.id)
    // Each collection read at most once for the process's catalog, whatever the scopes
    expect(mockFind.mock.calls.filter(([name]) => name === 'FlatTVShows').length).toBeLessThanOrEqual(1)
    expect(mockFind.mock.calls.filter(([name]) => name === 'FlatMovies').length).toBeLessThanOrEqual(1)
  })

  it('a scope’s index: its library keys, and the TMDB ids of library titles it leaves out', async () => {
    const access = await libraryAccessFor({ role: 'user', roles: ['r-kids'] })
    const index = await libraryScopeIndex(access)
    expect([...index.movieKeys].sort()).toEqual(['Cartoon', 'Thriller Cut'])
    expect([...index.showKeys]).toEqual(['Puppets'])
    // 12 stays: one of its two documents is in scope
    expect(index.hiddenTmdbIds).toEqual({ movie: [], tv: [22, 23] })
  })

  it('an empty scope (the migrated Preview role) is a scope: nothing in it', async () => {
    roles = [{ id: 'r-preview', name: 'Preview', grants: {}, scope: { movieRatingCap: null, tvRatingCap: null, titles: [] } }]
    const access = await libraryAccessFor({ role: 'user', roles: ['r-preview'] })
    expect(access.id).not.toBe('all')
    expect(access.showIds).toEqual([])
    expect((await libraryScopeIndex(access)).hiddenTmdbIds).toEqual({ movie: [11, 12], tv: [21, 22, 23] })
  })

  it('a role this process has not seen is read again once, and still unknown counts as an empty scope', async () => {
    const access = await libraryAccessFor({ role: 'user', roles: ['r-gone'] })
    expect(mockForgetRoles).toHaveBeenCalledTimes(1)
    expect(access.id).not.toBe('all')
    expect(access.scope).toEqual({ movieRatingCap: null, tvRatingCap: null, titles: [] })
    // Beside a known scoped role it adds nothing: the user sees what that role allows
    const withKids = await libraryAccessFor({ role: 'user', roles: ['r-gone', 'r-kids'] })
    expect(withKids.scope).toEqual(KIDS.scope)
  })

  it('a lone role id stored as a string still counts', async () => {
    const access = await libraryAccessFor({ role: 'user', roles: 'r-kids' })
    expect(access.scope).toEqual(KIDS.scope)
  })
})

describe('by scope id, for the cached functions', () => {
  it('resolves a scope this process resolved, as a new object each time', async () => {
    const access = await libraryAccessFor({ role: 'user', roles: ['r-kids'] })
    const again = await libraryAccessById(access.id)
    expect(again).toEqual(access)
    expect(again).not.toBe(await libraryAccessById(access.id))
  })

  it('refuses an id it never resolved: a cached read never widens to the whole library', async () => {
    await expect(libraryAccessById('scope-00000000000000000000')).rejects.toThrow('is not known here')
    await expect(libraryAccessById(undefined)).rejects.toThrow('is not known here')
  })
})
