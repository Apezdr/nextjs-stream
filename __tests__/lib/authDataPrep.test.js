/**
 * @jest-environment node
 *
 * src/lib/authDataPrep.ts: the auth database as better-auth 1.7 needs it,
 * as the server starts. 1.7's Mongo adapter creates the device plugin's
 * unique indexes before every deviceCode write and fails the write when it
 * can't, so a 1.6 database with a duplicate code, or an index on the same
 * field under another name, would stop every TV sign-in.
 */

const { readFileSync } = require('node:fs')
const { join } = require('node:path')

jest.mock('@src/lib/mongodb', () => ({ mongoClient: { db: jest.fn() } }))
const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
jest.mock('@src/lib/logger', () => ({ createLogger: () => mockLog }))

const {
  DEVICE_CODE_INDEXES,
  countDuplicateAccounts,
  deleteExpiredDeviceCodes,
  prepareAuthData,
  prepareDeviceCodeIndexes,
} = require('@src/lib/authDataPrep')

/** A fake Db: collection(name) answers from the given behaviour per collection. */
function fakeDb({ indexes = [], duplicates = {}, accountDuplicates = 0, expired = 0, missing = false } = {}) {
  const deviceCode = {
    deleteMany: jest.fn(async (filter) => ({ deletedCount: filter.expiresAt ? expired : filter._id.$in.length })),
    indexes: jest.fn(async () => {
      if (missing) throw Object.assign(new Error('ns does not exist'), { codeName: 'NamespaceNotFound' })
      return indexes
    }),
    aggregate: jest.fn((pipeline) => {
      const field = Object.keys(pipeline[0].$match)[0]
      return { toArray: async () => duplicates[field] ?? [] }
    }),
    dropIndex: jest.fn(async () => {}),
    createIndex: jest.fn(async () => {}),
  }
  const account = {
    aggregate: jest.fn(() => ({ toArray: async () => (accountDuplicates ? [{ duplicates: accountDuplicates }] : []) })),
  }
  return { collection: (name) => ({ deviceCode, account })[name], deviceCode, account }
}

beforeEach(() => Object.values(mockLog).forEach((fn) => fn.mockClear()))

describe('the device-code collection', () => {
  it('drops codes past their expiry', async () => {
    const db = fakeDb({ expired: 4 })

    await expect(deleteExpiredDeviceCodes(db)).resolves.toBe(4)
    expect(db.deviceCode.deleteMany).toHaveBeenCalledWith({ expiresAt: { $lt: expect.any(Date) } })
  })

  it("creates better-auth's two unique indexes, under its names, on a 1.6 database", async () => {
    const db = fakeDb({ indexes: [{ name: '_id_', key: { _id: 1 } }] })

    await expect(prepareDeviceCodeIndexes(db)).resolves.toEqual({ removedDuplicates: 0, droppedIndexes: 0, createdIndexes: 2 })
    expect(db.deviceCode.createIndex).toHaveBeenCalledWith({ deviceCode: 1 }, { name: 'deviceCode_deviceCode_uidx', unique: true })
    expect(db.deviceCode.createIndex).toHaveBeenCalledWith({ userCode: 1 }, { name: 'deviceCode_userCode_uidx', unique: true })
  })

  it('replaces an index on the same field under another name, or not unique', async () => {
    const db = fakeDb({
      indexes: [
        { name: 'userCode_1', key: { userCode: 1 } },
        { name: 'deviceCode_deviceCode_uidx', key: { deviceCode: 1 } }, // right name, not unique
      ],
    })

    await expect(prepareDeviceCodeIndexes(db)).resolves.toEqual({ removedDuplicates: 0, droppedIndexes: 2, createdIndexes: 2 })
    expect(db.deviceCode.dropIndex).toHaveBeenCalledWith('userCode_1')
    expect(db.deviceCode.dropIndex).toHaveBeenCalledWith('deviceCode_deviceCode_uidx')
  })

  it('changes nothing once the indexes are in place', async () => {
    const db = fakeDb({
      indexes: DEVICE_CODE_INDEXES.map(({ field, name }) => ({ name, key: { [field]: 1 }, unique: true })),
    })

    await expect(prepareDeviceCodeIndexes(db)).resolves.toEqual({ removedDuplicates: 0, droppedIndexes: 0, createdIndexes: 0 })
    expect(db.deviceCode.dropIndex).not.toHaveBeenCalled()
    expect(db.deviceCode.createIndex).not.toHaveBeenCalled()
  })

  it('keeps only the newest row of a duplicated code', async () => {
    // The pipeline sorts newest first, so ids[0] is the one to keep
    const db = fakeDb({ duplicates: { userCode: [{ ids: ['newest', 'older', 'oldest'] }] } })

    const result = await prepareDeviceCodeIndexes(db)

    expect(result.removedDuplicates).toBe(2)
    expect(db.deviceCode.deleteMany).toHaveBeenCalledWith({ _id: { $in: ['older', 'oldest'] } })
    const [pipeline] = db.deviceCode.aggregate.mock.calls.find(([p]) => p[0].$match.userCode)
    expect(pipeline[1]).toEqual({ $sort: { _id: -1 } })
  })

  it('handles a database that has no device-code collection yet', async () => {
    const db = fakeDb({ missing: true })

    await expect(prepareDeviceCodeIndexes(db)).resolves.toEqual({ removedDuplicates: 0, droppedIndexes: 0, createdIndexes: 2 })
  })
})

describe('duplicate accounts', () => {
  it('are counted and logged by count only, never changed', async () => {
    const db = fakeDb({ accountDuplicates: 3 })

    await expect(countDuplicateAccounts(db)).resolves.toBe(3)
    await prepareAuthData(db)

    expect(mockLog.error).toHaveBeenCalledWith({ duplicateAccounts: 3 }, expect.stringContaining('refuses to sign those users in'))
    expect(db.account.deleteMany).toBeUndefined()
  })
})

describe("better-auth's own definitions, as installed", () => {
  // An upgrade that renames the indexes or stops declaring them fails here
  const dist = (...path) => readFileSync(join(__dirname, '..', '..', 'node_modules', ...path), 'utf8')

  it('the device plugin declares unique indexes on deviceCode and userCode', () => {
    const schema = dist('better-auth', 'dist', 'plugins', 'device-authorization', 'schema.mjs')
    expect(schema).toMatch(/indexes: \[\{\s+fields: \["deviceCode"\],\s+unique: true\s+\}, \{\s+fields: \["userCode"\],\s+unique: true/)
  })

  it('the adapter names them ${table}_${field}_uidx and creates them before each write', () => {
    expect(dist('@better-auth', 'core', 'dist', 'db', 'database-index.mjs')).toContain(
      'const generatedName = `${tableName}_${index.fields.join("_")}_${indexKind}`;'
    )
    expect(dist('@better-auth', 'mongo-adapter', 'dist', 'index.mjs')).toMatch(
      /async create\(\{ model, modelKey = model, data: values \}\) \{\s+await ensureModelIndexes\(model, modelKey\);/
    )
  })
})
