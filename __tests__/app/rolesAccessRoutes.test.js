/**
 * @jest-environment node
 *
 * The two doors roles open: GET /api/authenticated/permissions (what the
 * browser may offer) and requireArrAccess() (who may use the arr routes at
 * all, and with what).
 */

const mockCurrentPermissions = jest.fn()
jest.mock('@src/lib/roles/session', () => ({ currentPermissions: () => mockCurrentPermissions() }))

const permissionsRoute = require('@src/app/api/authenticated/permissions/route')
const { requireArrAccess } = require('@src/lib/arr/access')

const ADMIN = {
  userId: 'a',
  userName: 'Adam',
  admin: true,
  grants: { 'arr.request': { radarr: 'all', sonarr: 'all', manual: true, anyTitle: true }, 'arr.manage': {} },
}
const REQUESTER = {
  userId: 'u',
  userName: 'Robin',
  admin: false,
  grants: { 'arr.request': { radarr: [4], sonarr: [], manual: false, anyTitle: false } },
}

beforeEach(() => mockCurrentPermissions.mockReset())

test('permissions: 401 when signed out; otherwise what the user holds', async () => {
  mockCurrentPermissions.mockResolvedValue(null)
  expect((await permissionsRoute.GET()).status).toBe(401)

  mockCurrentPermissions.mockResolvedValue(REQUESTER)
  const response = await permissionsRoute.GET()
  await expect(response.json()).resolves.toEqual({ admin: false, grants: REQUESTER.grants })
})

test('requireArrAccess: signed out 401, no arr grant 403, otherwise the actor', async () => {
  mockCurrentPermissions.mockResolvedValue(null)
  expect((await requireArrAccess()).status).toBe(401)

  mockCurrentPermissions.mockResolvedValue({ userId: 'v', userName: 'Viewer', admin: false, grants: {} })
  const refused = await requireArrAccess()
  expect(refused.status).toBe(403)
  await expect(refused.json()).resolves.toMatchObject({ error: 'forbidden' })

  mockCurrentPermissions.mockResolvedValue(REQUESTER)
  await expect(requireArrAccess()).resolves.toEqual({
    userId: 'u',
    userName: 'Robin',
    permissions: { profiles: { radarr: [4], sonarr: [] }, manual: false, anyTitle: false, manage: false },
  })

  mockCurrentPermissions.mockResolvedValue(ADMIN)
  await expect(requireArrAccess()).resolves.toMatchObject({ permissions: { manage: true, profiles: { radarr: 'all' } } })
})
