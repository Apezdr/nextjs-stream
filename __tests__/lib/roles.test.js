/**
 * @jest-environment node
 *
 * Roles: capabilities a feature declares (here arr.request and arr.manage),
 * grouped into roles an admin makes, merged per user. Admins hold everything;
 * an account waiting for approval holds nothing.
 */

const mockListRoles = jest.fn()
jest.mock('@src/lib/roles/store', () => ({ listRoles: () => mockListRoles() }))

const { RoleInputError, defineCapability } = require('@src/lib/roles/capability')
const { permissionsFor, grantOf } = require('@src/lib/roles/resolve')
const {
  allowsProfile,
  allowsService,
  arrManage,
  arrPermissionsFrom,
  arrRequest,
  unionProfiles,
} = require('@src/lib/arr/capabilities')

beforeEach(() => mockListRoles.mockReset())

describe('arr capabilities', () => {
  test('parse: "all", a list of profile ids, or nothing for a service', () => {
    expect(arrRequest.parse({ radarr: 'all', sonarr: [8, 4, 8], manual: true })).toEqual({
      radarr: 'all',
      sonarr: [4, 8],
      manual: true,
      anyTitle: false,
    })
    expect(arrRequest.parse({})).toEqual({ radarr: [], sonarr: [], manual: false, anyTitle: false })
    expect(() => arrRequest.parse({ radarr: [0] })).toThrow(RoleInputError)
    expect(() => arrRequest.parse({ radarr: 'some' })).toThrow('Radarr quality profiles')
    expect(() => arrRequest.parse(null)).toThrow('Request settings are missing.')
  })

  test('two grants merge to the wider of each', () => {
    expect(unionProfiles([4], [5, 4])).toEqual([4, 5])
    expect(unionProfiles([4], 'all')).toBe('all')
    expect(
      arrRequest.merge(
        { radarr: [4], sonarr: [], manual: false, anyTitle: true },
        { radarr: [5], sonarr: 'all', manual: true, anyTitle: false }
      )
    ).toEqual({ radarr: [4, 5], sonarr: 'all', manual: true, anyTitle: true })
  })

  test('management lifts every limit; a request that names no service allows nothing', () => {
    expect(arrPermissionsFrom(null, true)).toEqual({
      profiles: { radarr: 'all', sonarr: 'all' },
      manual: true,
      anyTitle: true,
      manage: true,
    })
    expect(arrPermissionsFrom(arrRequest.empty, false)).toBeNull()
    expect(arrPermissionsFrom(null, false)).toBeNull()

    const hdMovies = arrPermissionsFrom({ radarr: [4], sonarr: [], manual: false, anyTitle: false }, false)
    expect(allowsService(hdMovies, 'radarr')).toBe(true)
    expect(allowsService(hdMovies, 'sonarr')).toBe(false)
    expect(allowsProfile(hdMovies, 'radarr', 4)).toBe(true)
    expect(allowsProfile(hdMovies, 'radarr', 5)).toBe(false)
  })

  test('a capability key must look like feature.action', () => {
    const shape = { label: 'x', description: 'x', empty: {}, full: {}, merge: () => ({}), parse: () => ({}) }
    expect(() => defineCapability({ ...shape, key: 'Bad Key' })).toThrow('feature.action')
    expect(defineCapability({ ...shape, key: 'subtitles.edit' }).key).toBe('subtitles.edit')
  })
})

describe('permissionsFor', () => {
  const HD = { id: 'r1', name: 'HD requester', grants: { 'arr.request': { radarr: [4], sonarr: [], manual: false, anyTitle: false } } }
  const PICKER = { id: 'r2', name: 'Picker', grants: { 'arr.request': { radarr: [5], sonarr: [8], manual: true, anyTitle: false } } }
  const MANAGER = { id: 'r3', name: 'Media manager', grants: { 'arr.manage': {} } }

  test('an admin holds every capability at full strength, with no roles', async () => {
    const permissions = await permissionsFor({ id: 'a', name: 'Adam', role: 'admin' })
    expect(permissions.admin).toBe(true)
    expect(grantOf(permissions, arrRequest)).toEqual(arrRequest.full)
    expect(grantOf(permissions, arrManage)).toEqual({})
    expect(mockListRoles).not.toHaveBeenCalled()
  })

  test('a user’s roles merge per capability; unknown role ids are ignored', async () => {
    mockListRoles.mockResolvedValue([HD, PICKER, MANAGER])
    const permissions = await permissionsFor({ id: 'u', name: 'Robin', role: 'user', approved: true, roles: ['r1', 'r2', 'gone'] })
    expect(permissions).toEqual({
      userId: 'u',
      userName: 'Robin',
      admin: false,
      grants: { 'arr.request': { radarr: [4, 5], sonarr: [8], manual: true, anyTitle: false } },
    })
    expect(grantOf(permissions, arrManage)).toBeNull()
  })

  test('an account waiting for approval holds nothing, whatever it was given', async () => {
    mockListRoles.mockResolvedValue([MANAGER])
    const permissions = await permissionsFor({ id: 'u', email: 'r@x.test', role: 'user', approved: false, roles: ['r3'] })
    expect(permissions).toMatchObject({ userName: 'r@x.test', admin: false, grants: {} })
  })
})
