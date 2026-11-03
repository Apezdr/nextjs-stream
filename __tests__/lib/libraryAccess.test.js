/**
 * @jest-environment node
 *
 * libraryAccessFor (src/lib/roles/libraryAccess.ts): a user's library access
 * from their roles. The common case (an admin, a user with no scoped role)
 * must cost nothing: no role read for a user with no roles, no show read for
 * anyone with the whole library, and the one shared 'all' id. A scoped user
 * gets the union of their roles' scopes under one id per scope, so users with
 * the same scope share cache entries, and the shows in scope are read once
 * per scope while they're fresh, not per request.
 */

const mockListRoles = jest.fn()
const mockForgetRoles = jest.fn()
jest.mock('@src/lib/roles/store', () => ({
  listRoles: (...args) => mockListRoles(...args),
  forgetRoles: (...args) => mockForgetRoles(...args),
}))
const mockShowFind = jest.fn()
jest.mock('@src/lib/mongodb', () => ({
  __esModule: true,
  default: Promise.resolve({
    db: () => ({ collection: () => ({ find: (...args) => ({ toArray: () => mockShowFind(...args) }) }) }),
  }),
}))

const { libraryAccessFor, scopeIdOf } = require('@src/lib/roles/libraryAccess')
const { FULL_LIBRARY } = require('@src/lib/roles/libraryScope')

const id = (hex) => ({ toString: () => hex })
const KIDS = { id: 'r-kids', name: 'Kids', grants: {}, scope: { movieRatingCap: 'PG', tvRatingCap: 'TV-Y7', titles: [] } }
const PICKS = {
  id: 'r-picks',
  name: 'Picks',
  grants: {},
  scope: { movieRatingCap: null, tvRatingCap: null, titles: [{ mediaType: 'tv', originalTitle: 'Picked', access: 'play' }] },
}
const REQUESTER = { id: 'r-req', name: 'Requester', grants: { 'arr.manage': {} }, scope: null }

let roles
beforeEach(() => {
  roles = [KIDS, PICKS, REQUESTER]
  mockListRoles.mockReset().mockImplementation(async () => roles)
  mockForgetRoles.mockReset()
  mockShowFind.mockReset().mockResolvedValue([{ _id: id('b2') }, { _id: id('a1') }])
})

describe('the whole library costs nothing', () => {
  it('an admin, whatever roles they hold: no role read, no show read', async () => {
    expect(await libraryAccessFor({ role: 'admin', roles: ['r-kids'] })).toBe(FULL_LIBRARY)
    expect(mockListRoles).not.toHaveBeenCalled()
    expect(mockShowFind).not.toHaveBeenCalled()
  })

  it('a user with no roles: no role read', async () => {
    expect(await libraryAccessFor({ role: 'user' })).toBe(FULL_LIBRARY)
    expect(await libraryAccessFor({ role: 'user', roles: [] })).toBe(FULL_LIBRARY)
    expect(mockListRoles).not.toHaveBeenCalled()
  })

  it('a user whose roles carry no scope: the process copy of the roles, no show read', async () => {
    expect(await libraryAccessFor({ role: 'user', roles: ['r-req'] })).toBe(FULL_LIBRARY)
    expect(mockShowFind).not.toHaveBeenCalled()
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
    // The shows in scope, sorted: what seasons and episodes follow
    expect(access.showIds).toEqual(['a1', 'b2'])
  })

  it('shares one id, and one show read, with every user of the same scope', async () => {
    const first = await libraryAccessFor({ role: 'user', roles: ['r-kids'] })
    const second = await libraryAccessFor({ role: 'user', roles: ['r-kids', 'r-req'] })
    const third = await libraryAccessFor({ role: 'user', roles: ['r-kids'] })
    expect(second.id).toBe(first.id)
    expect(third).toEqual(first)
    expect(mockShowFind).toHaveBeenCalledTimes(1)
    // The shows are found by the scope's own fragment: bounded $in lists
    expect(mockShowFind.mock.calls[0][0]).toEqual({
      $or: [{ 'metadata.rating': { $in: ['TV-Y', 'TV-Y7'] } }, { originalTitle: { $in: [] } }],
    })
  })

  it('an empty scope (the migrated Preview role) is a scope: nothing in it', async () => {
    roles = [{ id: 'r-preview', name: 'Preview', grants: {}, scope: { movieRatingCap: null, tvRatingCap: null, titles: [] } }]
    mockShowFind.mockResolvedValue([])
    const access = await libraryAccessFor({ role: 'user', roles: ['r-preview'] })
    expect(access.id).not.toBe('all')
    expect(access.showIds).toEqual([])
  })

  it('a role this process has not seen yet is read again rather than ignored', async () => {
    const preview = { id: 'r-new', name: 'Preview', grants: {}, scope: { movieRatingCap: null, tvRatingCap: null, titles: [] } }
    mockListRoles.mockImplementationOnce(async () => roles).mockImplementation(async () => [...roles, preview])
    const access = await libraryAccessFor({ role: 'user', roles: ['r-new'] })
    expect(mockForgetRoles).toHaveBeenCalledTimes(1)
    expect(access.scope).toEqual(preview.scope)
  })
})
