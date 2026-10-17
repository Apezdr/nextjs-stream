/**
 * @jest-environment node
 *
 * The Notifications indexes were declared only in the deleted
 * flatSync/initializeDatabase.js. notificationDatabase.js now ensures the two
 * that prod uses, once per process, under prod's existing names. A conflict
 * (the same keys under another name) must be logged, never thrown into the
 * user's request.
 */

let mockCollection
const mockLog = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }

jest.mock('@src/lib/mongodb', () => ({
  __esModule: true,
  default: Promise.resolve({ db: () => ({ collection: () => mockCollection }) }),
}))
jest.mock('@src/lib/logger', () => ({ createLogger: () => mockLog }))
jest.mock('@src/lib/userQueries', () => ({ userQueries: { find: jest.fn() } }))
jest.mock('@src/utils/watchHistory/database', () => ({ getAllWatchHistoryUserIds: jest.fn() }))

const USER_ID = '64b7f0c2a1b2c3d4e5f60718'

const EXPECTED_SPECS = [
  [{ userId: 1, read: 1 }, { name: 'userId_read_index' }],
  [{ userId: 1, createdAt: -1 }, { name: 'userId_createdAt_index' }],
]

function freshModule() {
  let mod
  jest.isolateModules(() => {
    mod = require('@src/utils/notifications/notificationDatabase')
  })
  return mod
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCollection = {
    createIndex: jest.fn(async (_key, { name }) => name),
    countDocuments: jest.fn(async () => 3),
    insertOne: jest.fn(async () => ({ insertedId: 'n1' })),
  }
})

it('creates exactly the two prod indexes, once per process', async () => {
  const db = freshModule()

  await Promise.all([db.getUnreadNotificationCount(USER_ID), db.getUnreadNotificationCount(USER_ID)])
  await db.createNotification({ userId: USER_ID, title: 'New episode' })
  await db.getUnreadNotificationCount(USER_ID)

  expect(mockCollection.createIndex).toHaveBeenCalledTimes(2)
  expect(mockCollection.createIndex.mock.calls).toEqual(EXPECTED_SPECS)
  expect(mockLog.error).not.toHaveBeenCalled()
})

it('logs a conflict, answers the request and does not retry', async () => {
  const conflict = Object.assign(new Error('Index already exists with a different name: legacy_name'), {
    code: 85,
    codeName: 'IndexOptionsConflict',
  })
  mockCollection.createIndex = jest.fn(async (_key, { name }) => {
    if (name === 'userId_read_index') throw conflict
    return name
  })
  const db = freshModule()

  await expect(db.getUnreadNotificationCount(USER_ID)).resolves.toBe(3)
  await expect(db.getUnreadNotificationCount(USER_ID)).resolves.toBe(3)

  expect(mockCollection.createIndex).toHaveBeenCalledTimes(2)
  expect(mockLog.error).toHaveBeenCalledTimes(1)
  expect(mockLog.error).toHaveBeenCalledWith(
    expect.objectContaining({ err: conflict, indexName: 'userId_read_index' }),
    expect.any(String)
  )
})
