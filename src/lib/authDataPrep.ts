import type { Db } from 'mongodb'
import { mongoClient } from '@src/lib/mongodb'
import { createLogger } from '@src/lib/logger'
import { runStartupTaskOnce, type Schedule } from '@src/lib/startupTask'

/**
 * The auth database as better-auth 1.7 needs it, brought there as the server
 * starts (instrumentation.ts). Idempotent: a second run changes nothing.
 *
 * Before every deviceCode write, 1.7's Mongo adapter creates the unique
 * indexes the device plugin declares, and fails the write when it can't: a
 * duplicate code, or an index on the same field under another name. On a
 * database from 1.6, which declared none, either would stop every TV sign-in
 * at /device/code. So expired codes go, a duplicate keeps only its newest
 * row, and a conflicting index is replaced by better-auth's own, under its
 * name, which the adapter then finds in place.
 *
 * 1.7 also refuses to sign in a user whose (providerId, accountId) pair is on
 * more than one account row. Those are counted and logged, never changed:
 * which row is right is a person's decision.
 */

const log = createLogger('Auth.DataPrep')

/**
 * The unique indexes better-auth 1.7's deviceAuthorization plugin declares,
 * named as its Mongo adapter names them (`${table}_${field}_uidx`).
 */
export const DEVICE_CODE_INDEXES = [
  { field: 'deviceCode', name: 'deviceCode_deviceCode_uidx' },
  { field: 'userCode', name: 'deviceCode_userCode_uidx' },
] as const

const authDb = (): Db => mongoClient.db(process.env.MONGODB_AUTH_DB || 'Users')

/** Deletes device codes past their expiry: none can ever be redeemed. */
export async function deleteExpiredDeviceCodes(db: Db): Promise<number> {
  const { deletedCount } = await db.collection('deviceCode').deleteMany({ expiresAt: { $lt: new Date() } })
  return deletedCount
}

/**
 * @removeAtVersion 2026.10.0 Device-code index preparation for auth databases from better-auth 1.6 (deduplicate, replace a same-field index under another name); 1.7 creates its own indexes after that.
 */
export async function prepareDeviceCodeIndexes(db: Db) {
  const codes = db.collection('deviceCode')
  const result = { removedDuplicates: 0, droppedIndexes: 0, createdIndexes: 0 }
  let existing: Array<{ name?: string; key: Record<string, unknown>; unique?: boolean }>
  try {
    existing = await codes.indexes()
  } catch (error) {
    // No collection yet: nothing to deduplicate or replace
    if ((error as { codeName?: string })?.codeName !== 'NamespaceNotFound') throw error
    existing = []
  }

  for (const { field, name } of DEVICE_CODE_INDEXES) {
    // Newest first, so ids[0] of each duplicated value is the row to keep: an
    // older duplicate is a pending sign-in nobody can finish anyway
    const duplicates = await codes
      .aggregate<{ ids: unknown[] }>([
        { $match: { [field]: { $type: 'string' } } },
        { $sort: { _id: -1 } },
        { $group: { _id: `$${field}`, ids: { $push: '$_id' }, count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
      ])
      .toArray()
    for (const { ids } of duplicates) {
      const { deletedCount } = await codes.deleteMany({ _id: { $in: ids.slice(1) as never[] } })
      result.removedDuplicates += deletedCount
    }

    const sameField = existing.filter((index) => {
      const keys = Object.keys(index.key)
      return keys.length === 1 && keys[0] === field
    })
    for (const index of sameField) {
      if (index.name === name && index.unique) continue
      await codes.dropIndex(index.name as string)
      result.droppedIndexes += 1
    }
    if (!sameField.some((index) => index.name === name && index.unique)) {
      await codes.createIndex({ [field]: 1 }, { name, unique: true })
      result.createdIndexes += 1
    }
  }
  return result
}

/**
 * @removeAtVersion 2026.10.0 Duplicate-account count for auth databases from better-auth 1.6, which accepted them; 1.7 refuses to create one.
 */
export async function countDuplicateAccounts(db: Db): Promise<number> {
  const [row] = await db
    .collection('account')
    .aggregate<{ duplicates: number }>([
      { $group: { _id: { providerId: '$providerId', accountId: '$accountId' }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $count: 'duplicates' },
    ])
    .toArray()
  return row?.duplicates ?? 0
}

export async function prepareAuthData(db: Db = authDb()) {
  const expiredDeviceCodes = await deleteExpiredDeviceCodes(db)
  const indexes = await prepareDeviceCodeIndexes(db)
  const duplicateAccounts = await countDuplicateAccounts(db)

  if (duplicateAccounts > 0) {
    log.error(
      { duplicateAccounts },
      'Account rows share a (providerId, accountId) pair; better-auth 1.7 refuses to sign those users in. Resolve them by hand.'
    )
  }
  const result = { expiredDeviceCodes, ...indexes, duplicateAccounts }
  if (expiredDeviceCodes || indexes.removedDuplicates || indexes.droppedIndexes || indexes.createdIndexes) {
    log.info(result, 'Auth data prepared for better-auth 1.7')
  }
  return result
}

const STARTED = Symbol.for('nextjs_stream.authDataPrepStarted')

/** Once per process, retried until it succeeds (startupTask.ts). Never throws. */
export function prepareAuthDataOnce(run: () => Promise<unknown> = prepareAuthData, schedule?: Schedule): void {
  runStartupTaskOnce(
    STARTED,
    run,
    (error, retryInMs) => log.error({ error: (error as Error)?.message, retryInMs }, 'Preparing the auth data failed'),
    schedule
  )
}
