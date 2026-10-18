/**
 * @jest-environment node
 *
 * The Notifications indexes were declared only in the deleted
 * flatSync/initializeDatabase.js. notificationDatabase.js now ensures the two
 * that prod uses, once per process, under prod's existing names, and the TTL
 * index that deletes a read notification 30 days after it was read. A
 * conflict (the same keys under another name) must be logged, never thrown
 * into the user's request.
 *
 * Before the TTL index is built, every read notification gets readAt = now,
 * once per database: they all carry a readAt already, most older than a
 * month, and the index would otherwise delete them the moment it exists.
 */

let mockCollection
let mockMigrations
const mockLog = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }
const mockOrder = []

jest.mock('@src/lib/mongodb', () => ({
  __esModule: true,
  default: Promise.resolve({
    db: (dbName) => ({
      collection: (name) => (dbName === 'app_config' && name === 'migrations' ? mockMigrations : mockCollection),
    }),
  }),
}))
jest.mock('@src/lib/logger', () => ({ createLogger: () => mockLog }))
jest.mock('@src/lib/userQueries', () => ({ userQueries: { find: jest.fn() } }))
jest.mock('@src/utils/watchHistory/database', () => ({ getAllWatchHistoryUserIds: jest.fn() }))

const USER_ID = '64b7f0c2a1b2c3d4e5f60718'

const EXPECTED_SPECS = [
  [{ userId: 1, read: 1 }, { name: 'userId_read_index' }],
  [{ userId: 1, createdAt: -1 }, { name: 'userId_createdAt_index' }],
  [
    { readAt: 1 },
    { name: 'readAt_ttl_read', expireAfterSeconds: 2592000, partialFilterExpression: { read: true } },
  ],
]

function freshModule() {
  let mod
  jest.isolateModules(() => {
    mod = require('@src/utils/notifications/notificationDatabase')
  })
  return mod
}

/** A new process: nothing is known to be done until it reads the flags. */
function newProcess() {
  delete globalThis.__dataMigrations
  return freshModule()
}

beforeEach(() => {
  jest.clearAllMocks()
  mockOrder.length = 0
  delete globalThis.__dataMigrations
  mockCollection = {
    createIndex: jest.fn(async (_key, { name }) => {
      mockOrder.push(`index ${name}`)
      return name
    }),
    updateMany: jest.fn(async () => {
      mockOrder.push('backfill')
      return { modifiedCount: 12 }
    }),
    updateOne: jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
    countDocuments: jest.fn(async () => 3),
    insertOne: jest.fn(async () => ({ insertedId: 'n1' })),
  }
  const flags = []
  mockMigrations = {
    flags,
    findOne: jest.fn(async ({ _id }) => flags.find((f) => f._id === _id) ?? null),
    updateOne: jest.fn(async ({ _id }, { $set }) => {
      flags.push({ _id, ...$set })
    }),
  }
})

it('creates exactly the three indexes, once per process', async () => {
  const db = freshModule()

  await Promise.all([db.getUnreadNotificationCount(USER_ID), db.getUnreadNotificationCount(USER_ID)])
  await db.createNotification({ userId: USER_ID, title: 'New episode' })
  await db.getUnreadNotificationCount(USER_ID)

  expect(mockCollection.createIndex).toHaveBeenCalledTimes(3)
  expect(mockCollection.createIndex.mock.calls).toEqual(EXPECTED_SPECS)
  // toEqual ignores key order, but an index's key order is part of its
  // identity: { read: 1, userId: 1 } would be a different index in prod.
  expect(mockCollection.createIndex.mock.calls.map(([key]) => Object.keys(key))).toEqual([
    ['userId', 'read'],
    ['userId', 'createdAt'],
    ['readAt'],
  ])
  expect(mockLog.error).not.toHaveBeenCalled()
})

it('gives every read notification readAt = now before the TTL index exists, once per database', async () => {
  const before = Date.now()
  const db = freshModule()

  await db.getUnreadNotificationCount(USER_ID)

  expect(mockCollection.updateMany).toHaveBeenCalledTimes(1)
  const [filter, update] = mockCollection.updateMany.mock.calls[0]
  // Every read one, not only those without a readAt: they all have one
  expect(filter).toEqual({ read: true })
  expect(update.$set.readAt).toBeInstanceOf(Date)
  expect(update.$set.readAt.getTime()).toBeGreaterThanOrEqual(before)
  expect(mockOrder.indexOf('backfill')).toBeLessThan(mockOrder.indexOf('index readAt_ttl_read'))
  expect(mockMigrations.flags).toEqual([
    expect.objectContaining({ _id: 'notifications-readAt-restamp', result: { readNotifications: 12 } }),
  ])

  // The next process finds the flag: no second backfill, the index is still ensured
  await newProcess().getUnreadNotificationCount(USER_ID)
  expect(mockCollection.updateMany).toHaveBeenCalledTimes(1)
  expect(mockCollection.createIndex.mock.calls.filter(([key]) => 'readAt' in key)).toHaveLength(2)
})

it('builds no TTL index in a process whose backfill failed, answers the request, and backfills in the next', async () => {
  mockCollection.updateMany.mockRejectedValueOnce(new Error('not primary'))
  const db = freshModule()

  await expect(db.getUnreadNotificationCount(USER_ID)).resolves.toBe(3)

  expect(mockCollection.createIndex.mock.calls.map(([, { name }]) => name)).toEqual([
    'userId_read_index',
    'userId_createdAt_index',
  ])
  expect(mockMigrations.flags).toEqual([])
  expect(mockLog.error).toHaveBeenCalledWith(
    expect.objectContaining({ indexName: 'readAt_ttl_read' }),
    expect.any(String)
  )

  await newProcess().getUnreadNotificationCount(USER_ID)
  expect(mockCollection.updateMany).toHaveBeenCalledTimes(2)
  expect(mockCollection.createIndex.mock.calls.map(([, { name }]) => name)).toContain('readAt_ttl_read')
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

  expect(mockCollection.createIndex).toHaveBeenCalledTimes(3)
  expect(mockLog.error).toHaveBeenCalledTimes(1)
  expect(mockLog.error).toHaveBeenCalledWith(
    expect.objectContaining({ err: conflict, indexName: 'userId_read_index' }),
    expect.any(String)
  )
})

describe('every path that marks a notification read sets readAt (the TTL counts from it)', () => {
  const NOTIFICATION_ID = '64b7f0c2a1b2c3d4e5f60719'

  it.each([
    ['one', (db) => db.markNotificationAsRead(NOTIFICATION_ID, USER_ID), 'updateOne'],
    ['several', (db) => db.markNotificationsAsRead([NOTIFICATION_ID], USER_ID), 'updateMany'],
    ['all', (db) => db.markAllNotificationsAsRead(USER_ID), 'updateMany'],
  ])('marking %s read', async (_label, mark, method) => {
    const db = freshModule()
    await db.getUnreadNotificationCount(USER_ID) // the ensure, out of the way
    mockCollection.updateMany.mockClear()

    await mark(db)

    const [, update] = mockCollection[method].mock.calls.at(-1)
    expect(update.$set).toMatchObject({ read: true, readAt: expect.any(Date) })
  })
})

describe('insertNotificationsOnce (the new-content notices’ delivery)', () => {
  const { ObjectId } = require('mongodb')
  const doc = (n) => ({ _id: new ObjectId(), userId: USER_ID, title: `Notice ${n}` })
  const duplicate = (count) =>
    Object.assign(new Error('E11000 duplicate key error'), {
      code: 11000,
      writeErrors: Array.from({ length: count }, () => ({ code: 11000 })),
    })

  it('inserts every notification unread, stamped now', async () => {
    mockCollection.insertMany = jest.fn(async (docs) => ({ insertedCount: docs.length }))
    const db = freshModule()

    await expect(db.insertNotificationsOnce([doc(1), doc(2)])).resolves.toEqual({ inserted: 2, alreadyThere: 0 })

    const [docs, options] = mockCollection.insertMany.mock.calls[0]
    expect(options).toEqual({ ordered: false })
    expect(docs[0]).toMatchObject({ read: false, createdAt: expect.any(Date), updatedAt: expect.any(Date) })
    // An ObjectId (from the module's own copy of the driver)
    expect(docs[0].userId.toHexString()).toBe(USER_ID)
  })

  it('counts a notification that is already there (same _id) as delivered', async () => {
    mockCollection.insertMany = jest.fn(async () => {
      throw duplicate(1)
    })
    const db = freshModule()

    await expect(db.insertNotificationsOnce([doc(1), doc(2)])).resolves.toEqual({ inserted: 1, alreadyThere: 1 })
  })

  it('throws any other failure, so the delivery is tried again', async () => {
    mockCollection.insertMany = jest.fn(async () => {
      throw Object.assign(new Error('not primary'), { writeErrors: [{ code: 11000 }, { code: 10107 }] })
    })
    const db = freshModule()

    await expect(db.insertNotificationsOnce([doc(1), doc(2)])).rejects.toThrow('not primary')
  })
})
