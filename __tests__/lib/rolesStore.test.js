/**
 * @jest-environment node
 *
 * The role store: every grant is checked by its own capability on the way in
 * and on the way out, names are unique, a role someone holds can't be
 * deleted, and a user can only be given roles that exist. A role may carry a
 * library scope instead of (or beside) its grants.
 */
import { ObjectId } from 'mongodb'

const mockRoles = []
const mockCollection = {
  createIndex: jest.fn(async () => {}),
  find: () => ({ sort: () => ({ collation: () => ({ toArray: async () => mockRoles }) }) }),
  insertOne: jest.fn(async () => ({ insertedId: new ObjectId('64b7f0c2a1b2c3d4e5f60718') })),
  updateOne: jest.fn(async () => ({ matchedCount: 1 })),
  deleteOne: jest.fn(async () => ({ deletedCount: 1 })),
}
jest.mock('@src/lib/mongodb', () => ({
  __esModule: true,
  default: Promise.resolve({ db: () => ({ collection: () => mockCollection }) }),
}))
const mockUsers = { find: jest.fn(async () => []), updateById: jest.fn(async () => ({ matchedCount: 1 })) }
jest.mock('@src/lib/userQueries', () => ({ userQueries: mockUsers }))

const store = require('@src/lib/roles/store')
const { RoleInputError } = require('@src/lib/roles/capability')

const REQUEST = { radarr: [4], sonarr: 'all', manual: false, anyTitle: false }
const failure = (promise) => promise.then(() => null, (error) => error)

beforeEach(() => {
  jest.clearAllMocks()
  mockRoles.length = 0
  store.forgetRoles()
})

test('a role is saved with its grants checked by their capability', async () => {
  const role = await store.saveRole({ name: '  HD requester ', description: 'Friends', grants: { 'arr.request': REQUEST } })
  expect(role).toEqual({ id: '64b7f0c2a1b2c3d4e5f60718', name: 'HD requester', description: 'Friends', grants: { 'arr.request': REQUEST }, scope: null })
  expect(mockCollection.insertOne.mock.calls[0][0]).toMatchObject({ name: 'HD requester', grants: { 'arr.request': REQUEST } })
})

test.each([
  [{ name: '', grants: { 'arr.manage': {} } }, 'Give the role a name'],
  [{ name: 'x'.repeat(61), grants: { 'arr.manage': {} } }, 'Give the role a name'],
  [{ name: 'Empty', grants: {} }, 'at least one capability, or limit its library'],
  [{ name: 'Bad scope', grants: {}, scope: { movieRatingCap: 'TV-MA' } }, 'movie rating cap'],
  [{ name: 'Typo', grants: { 'arr.requests': {} } }, 'no capability called "arr.requests"'],
  [{ name: 'Bad', grants: { 'arr.request': { radarr: 'some' } } }, 'Radarr quality profiles'],
])('refused: %j', async (input, message) => {
  const error = await failure(store.saveRole(input))
  expect(error).toBeInstanceOf(RoleInputError)
  expect(error.message).toContain(message)
  expect(mockCollection.insertOne).not.toHaveBeenCalled()
})

test('a name already taken (any case) is refused in words', async () => {
  mockCollection.insertOne.mockRejectedValueOnce(Object.assign(new Error('E11000'), { code: 11000 }))
  expect((await failure(store.saveRole({ name: 'hd requester', grants: { 'arr.manage': {} } }))).message).toBe(
    'A role with that name already exists.'
  )
})

test('editing a role that was deleted meanwhile says so', async () => {
  mockCollection.updateOne.mockResolvedValueOnce({ matchedCount: 0 })
  const error = await failure(store.saveRole({ id: '64b7f0c2a1b2c3d4e5f60718', name: 'X', grants: { 'arr.manage': {} } }))
  expect(error.message).toBe('That role no longer exists.')
})

test('a stored grant that no longer parses, or names a capability that is gone, grants nothing', async () => {
  mockRoles.push({
    _id: new ObjectId('64b7f0c2a1b2c3d4e5f60718'),
    name: 'Old',
    grants: { 'arr.request': { radarr: 'nonsense' }, 'old.thing': {}, 'arr.manage': {} },
  })
  expect((await store.listRoles())[0].grants).toEqual({ 'arr.manage': {} })
})

test('a role someone holds can’t be deleted; one nobody holds can', async () => {
  const id = '64b7f0c2a1b2c3d4e5f60718'
  mockUsers.find.mockResolvedValueOnce([{ roles: [id] }, { roles: [id, 'other'] }])
  expect((await failure(store.deleteRole(id))).message).toBe('2 users hold this role. Take it off them first.')
  expect(mockCollection.deleteOne).not.toHaveBeenCalled()

  await store.deleteRole(id)
  expect(mockCollection.deleteOne).toHaveBeenCalledWith({ _id: new ObjectId(id) })
})

test('a user can only be given roles that exist, each once', async () => {
  mockRoles.push({ _id: new ObjectId('64b7f0c2a1b2c3d4e5f60718'), name: 'HD', grants: { 'arr.manage': {} } })
  await expect(store.setUserRoles('user-1', ['64b7f0c2a1b2c3d4e5f60718', '64b7f0c2a1b2c3d4e5f60718'])).resolves.toEqual([
    '64b7f0c2a1b2c3d4e5f60718',
  ])
  expect(mockUsers.updateById).toHaveBeenCalledWith('user-1', { roles: ['64b7f0c2a1b2c3d4e5f60718'] })

  expect((await failure(store.setUserRoles('user-1', ['64b7f0c2a1b2c3d4e5f60719']))).message).toBe(
    'One of those roles no longer exists.'
  )
  expect((await failure(store.setUserRoles('user-1', 'admin'))).message).toBe('Roles must be a list of role ids.')
})

test('a role may only limit the library: an empty scope, its holders seeing nothing yet', async () => {
  const role = await store.saveRole({ name: 'Preview', grants: {}, scope: { titles: [] } })
  expect(role.scope).toEqual({ movieRatingCap: null, tvRatingCap: null, titles: [] })
  expect(mockCollection.insertOne.mock.calls[0][0]).toMatchObject({ grants: {}, scope: role.scope })
})

test('a scope is checked on the way in, and stored normalized', async () => {
  const titles = [
    { mediaType: 'tv', originalTitle: 'B', access: 'play' },
    { mediaType: 'movie', originalTitle: 'A', access: 'play' },
  ]
  const role = await store.saveRole({ name: 'Kids', grants: { 'arr.manage': {} }, scope: { movieRatingCap: 'PG', titles } })
  expect(role.scope).toEqual({ movieRatingCap: 'PG', tvRatingCap: null, titles: [titles[1], titles[0]] })
  await store.saveRole({ id: '64b7f0c2a1b2c3d4e5f60718', name: 'Kids', grants: { 'arr.manage': {} }, scope: null })
  expect(mockCollection.updateOne.mock.calls[0][1].$set.scope).toBeNull()
})

test('a stored scope that no longer parses holds nothing: a broken scope never opens the library', async () => {
  mockRoles.push(
    { _id: new ObjectId(), name: 'Broken', grants: {}, scope: { movieRatingCap: 'XXX' } },
    { _id: new ObjectId(), name: 'Plain', grants: { 'arr.manage': {} } }
  )
  const [broken, plain] = await store.listRoles()
  expect(broken.scope).toEqual({ movieRatingCap: null, tvRatingCap: null, titles: [] })
  expect(plain.scope).toBeNull()
})
