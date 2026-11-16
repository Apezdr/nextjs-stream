/**
 * @jest-environment node
 *
 * Which deletion requests a lookup returns.
 *
 * getDeletionRequests used to apply three filters (status, requestType, email)
 * and drop any other without a word. Callers passed `_id` and `userId`, got
 * the newest request of anyone's, and acted on it: an admin's cancel emailed
 * the wrong person, and a user's status check showed, and could cancel,
 * someone else's request.
 */

const aggregated = []
const counted = []
const found = []
const mockCollection = {
  countDocuments: jest.fn(async (query) => {
    counted.push(query)
    return 0
  }),
  aggregate: jest.fn((pipeline) => {
    aggregated.push(pipeline)
    return { toArray: async () => [] }
  }),
  findOne: jest.fn(async (query) => {
    found.push(query)
    return { _id: query._id, status: 'pending' }
  }),
}
const mockClient = { db: () => ({ collection: () => mockCollection }) }
jest.mock('@src/lib/mongodb', () => ({ __esModule: true, default: Promise.resolve(mockClient), mongoClient: mockClient }))
jest.mock('@src/lib/authSessionStore', () => ({ forgetUserSessions: jest.fn() }))
jest.mock('@src/lib/logger', () => ({
  __esModule: true,
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}))

const { ObjectId } = require('mongodb')
const { getDeletionRequests, getDeletionRequestById } = require('@src/utils/accountDeletion')

const REQUEST = '64b7f0c2a1b2c3d4e5f60001'
const USER = '507f1f77bcf86cd799439011'

const lastMatch = () => aggregated.at(-1)[0].$match

beforeEach(() => {
  aggregated.length = 0
  counted.length = 0
  found.length = 0
  jest.clearAllMocks()
})

describe('getDeletionRequests', () => {
  test('a request id becomes a match on that id', async () => {
    await getDeletionRequests({ _id: REQUEST }, { page: 0, limit: 1 })

    expect(lastMatch()).toEqual({ _id: new ObjectId(REQUEST) })
    expect(counted.at(-1)).toEqual({ _id: new ObjectId(REQUEST) })
  })

  test('a user id becomes a match on that user, as the ObjectId the requests store', async () => {
    await getDeletionRequests({ userId: USER }, { page: 0, limit: 10 })

    expect(lastMatch()).toEqual({ userId: new ObjectId(USER) })
    expect(lastMatch().userId).toBeInstanceOf(ObjectId)
  })

  test('both together match one user’s one request', async () => {
    await getDeletionRequests({ _id: REQUEST, userId: USER }, { page: 0, limit: 1 })

    expect(lastMatch()).toEqual({ _id: new ObjectId(REQUEST), userId: new ObjectId(USER) })
  })

  test('an id filter that is set but missing or malformed is refused before the database is read', async () => {
    for (const filters of [{ userId: undefined }, { userId: null }, { userId: '' }, { userId: 'not-an-id' }, { _id: undefined }, { _id: 'abc' }, { _id: {} }]) {
      await expect(getDeletionRequests(filters, { page: 0, limit: 1 })).rejects.toThrow(/needs a valid id/)
    }
    expect(mockCollection.countDocuments).not.toHaveBeenCalled()
    expect(mockCollection.aggregate).not.toHaveBeenCalled()
  })

  test('a filter it does not know is refused, not dropped', async () => {
    await expect(getDeletionRequests({ requestId: REQUEST }, { page: 0, limit: 1 })).rejects.toThrow('no "requestId" filter')
    await expect(getDeletionRequests({ constructor: 'x' }, { page: 0, limit: 1 })).rejects.toThrow('no "constructor" filter')
    expect(mockCollection.aggregate).not.toHaveBeenCalled()
  })

  test('the admin list’s own filters still apply, and an empty one is left out', async () => {
    await getDeletionRequests({ status: 'pending', requestType: '', email: 'ada' }, { page: 0, limit: 20 })

    expect(lastMatch()).toEqual({ status: 'pending', email: { $regex: 'ada', $options: 'i' } })
  })

  test('no filters lists everything', async () => {
    await getDeletionRequests()

    expect(lastMatch()).toEqual({})
  })
})

describe('getDeletionRequestById', () => {
  test('reads the one request with that id', async () => {
    const request = await getDeletionRequestById(REQUEST)

    expect(found).toEqual([{ _id: new ObjectId(REQUEST) }])
    expect(String(request._id)).toBe(REQUEST)
  })

  test('something that is not an id is no request, and the database is not asked', async () => {
    for (const id of [undefined, null, '', 'abc', 42, {}]) {
      await expect(getDeletionRequestById(id)).resolves.toBeNull()
    }
    expect(mockCollection.findOne).not.toHaveBeenCalled()
  })
})
