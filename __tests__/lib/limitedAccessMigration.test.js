/**
 * @jest-environment node
 *
 * The startup migration from the retired limitedAccess flag to the Preview
 * role (src/lib/roles/limitedAccessMigration.ts): every flagged user gets the
 * role, which carries an empty library scope; the flag goes from every user;
 * a second run changes nothing.
 */

const mockUsers = { countDocuments: jest.fn(), updateMany: jest.fn() }
const mockRoles = { findOne: jest.fn(), insertOne: jest.fn() }
jest.mock('@src/lib/userQueries', () => ({ userQueries: { collection: () => mockUsers } }))
jest.mock('@src/lib/mongodb', () => ({
  __esModule: true,
  default: Promise.resolve({ db: () => ({ collection: () => mockRoles }) }),
}))
jest.mock('@src/lib/logger', () => ({ createLogger: () => ({ info: jest.fn(), error: jest.fn() }) }))

const { migrateLimitedAccess, migrateLimitedAccessOnce } = require('@src/lib/roles/limitedAccessMigration')

const ROLE_ID = '64b7f0c2a1b2c3d4e5f60718'
const roleDoc = { _id: { toString: () => ROLE_ID } }

beforeEach(() => {
  jest.clearAllMocks()
  mockUsers.updateMany.mockResolvedValue({ modifiedCount: 0 })
})

it('moves each flagged user onto a new Preview role with an empty scope, and clears every flag', async () => {
  mockUsers.countDocuments.mockResolvedValue(1)
  mockRoles.findOne.mockResolvedValue(null)
  mockRoles.insertOne.mockResolvedValue({ insertedId: { toString: () => ROLE_ID } })
  mockUsers.updateMany.mockResolvedValueOnce({ modifiedCount: 3 }).mockResolvedValueOnce({ modifiedCount: 5 })

  expect(await migrateLimitedAccess()).toEqual({ moved: 3, cleared: 5, roleCreated: true })

  expect(mockRoles.findOne).toHaveBeenNthCalledWith(1, { migratedFrom: 'limitedAccess' }, { projection: { _id: 1 } })
  expect(mockRoles.insertOne).toHaveBeenCalledWith(
    expect.objectContaining({
      name: 'Preview',
      grants: {},
      scope: { movieRatingCap: null, tvRatingCap: null, titles: [] },
      migratedFrom: 'limitedAccess',
    })
  )
  // One write per user: the role added to what they hold, and the flag removed
  expect(mockUsers.updateMany).toHaveBeenNthCalledWith(1, { limitedAccess: true }, [
    { $set: { roles: { $setUnion: [{ $ifNull: ['$roles', []] }, [ROLE_ID]] } } },
    { $unset: 'limitedAccess' },
  ])
  expect(mockUsers.updateMany).toHaveBeenNthCalledWith(2, { limitedAccess: { $exists: true } }, { $unset: { limitedAccess: '' } })
})

it('reuses the role it made before, even renamed', async () => {
  mockUsers.countDocuments.mockResolvedValue(1)
  mockRoles.findOne.mockResolvedValue(roleDoc)
  expect((await migrateLimitedAccess()).roleCreated).toBe(false)
  expect(mockRoles.insertOne).not.toHaveBeenCalled()
  expect(mockUsers.updateMany.mock.calls[0][1][0].$set.roles.$setUnion[1]).toEqual([ROLE_ID])
})

it('takes the next name when an admin already made a role called Preview, and says so when both are taken', async () => {
  mockUsers.countDocuments.mockResolvedValue(1)
  mockRoles.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(roleDoc).mockResolvedValueOnce(null)
  mockRoles.insertOne.mockResolvedValue({ insertedId: { toString: () => ROLE_ID } })
  await migrateLimitedAccess()
  expect(mockRoles.insertOne).toHaveBeenCalledWith(expect.objectContaining({ name: 'Preview (limited access)' }))

  mockRoles.findOne.mockReset().mockResolvedValueOnce(null).mockResolvedValue(roleDoc)
  await expect(migrateLimitedAccess()).rejects.toThrow('both exist')
})

it('with nobody flagged, makes no role and only clears leftover flags: a second run changes nothing', async () => {
  mockUsers.countDocuments.mockResolvedValue(0)
  expect(await migrateLimitedAccess()).toEqual({ moved: 0, cleared: 0, roleCreated: false })
  expect(mockRoles.findOne).not.toHaveBeenCalled()
  expect(mockUsers.updateMany).toHaveBeenCalledTimes(1)
})

it('runs once per process and retries until it succeeds', async () => {
  const retries = []
  const run = jest.fn().mockRejectedValueOnce(new Error('mongo starting')).mockResolvedValue({})
  migrateLimitedAccessOnce(run, (retry) => retries.push(retry))
  migrateLimitedAccessOnce(run, (retry) => retries.push(retry))
  await new Promise((resolve) => setImmediate(resolve))
  expect(run).toHaveBeenCalledTimes(1)
  retries.shift()()
  await new Promise((resolve) => setImmediate(resolve))
  expect(run).toHaveBeenCalledTimes(2)
  expect(retries).toHaveLength(0)
})
