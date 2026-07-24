/**
 * Client Error Reports Database Operations
 *
 * Append-only storage for error reports submitted by external client apps
 * (TV/mobile/web) via POST /api/authenticated/client-error.
 * See docs/react-native-app/client-error-reporting-contract.md.
 */

import clientPromise from '@src/lib/mongodb'
import { ObjectId } from 'mongodb'
import { createLogger } from '@src/lib/logger'

const log = createLogger('ClientErrorReports.Database')

const COLLECTION = 'ClientErrorReports'

// Contract recommends 30-90 day retention; reports have no long-term value.
export const CLIENT_ERROR_RETENTION_DAYS = 60

// Memoized per process so writes don't pay an index round trip; only set on
// success so a transient failure retries on the next write.
let indexesEnsured = false

async function ensureClientErrorIndexes(db) {
  if (indexesEnsured) return

  const collection = db.collection(COLLECTION)
  const indexes = [
    {
      key: { receivedAt: 1 },
      name: 'receivedAt_ttl',
      expireAfterSeconds: CLIENT_ERROR_RETENTION_DAYS * 86400,
    },
    { key: { dedupeKey: 1, receivedAt: -1 }, name: 'dedupeKey_receivedAt' },
    { key: { userId: 1, receivedAt: -1 }, name: 'userId_receivedAt' },
    { key: { severity: 1, receivedAt: -1 }, name: 'severity_receivedAt' },
  ]

  try {
    for (const indexSpec of indexes) {
      try {
        await collection.createIndex(indexSpec.key, {
          name: indexSpec.name,
          ...(indexSpec.expireAfterSeconds !== undefined && {
            expireAfterSeconds: indexSpec.expireAfterSeconds,
          }),
        })
      } catch (error) {
        // Index already exists with different options - safe to ignore (code 85/86)
        if (error.code !== 85 && error.code !== 86) {
          throw error
        }
      }
    }
    indexesEnsured = true
  } catch (error) {
    log.warn({ error }, 'Failed to ensure client error report indexes')
  }
}

/**
 * Insert a validated client error report. The server stamps receivedAt —
 * the client-supplied occurredAt is an untrusted device clock.
 *
 * @param {Object} options
 * @param {string|ObjectId} options.userId - Derived from the session, never the payload
 * @param {string|null} options.userEmail - Snapshot for the admin UI (avoids a cross-db join)
 * @param {Object} options.report - Output of validateClientErrorReport
 * @returns {Promise<Object>} The inserted document
 */
export async function insertClientErrorReport({ userId, userEmail = null, report }) {
  const client = await clientPromise
  const db = client.db('Media')
  await ensureClientErrorIndexes(db)

  const doc = {
    userId: typeof userId === 'string' ? new ObjectId(userId) : userId,
    userEmail,
    receivedAt: new Date(),
    schemaVersion: report.schemaVersion,
    category: report.category,
    severity: report.severity,
    message: report.message,
    ...(report.messageTruncated && { messageTruncated: true }),
    dedupeKey: report.dedupeKey,
    occurredAt: report.occurredAt,
    occurredAtDate: report.occurredAtDate,
    app: report.app,
    device: report.device,
    details: report.details,
  }

  const result = await db.collection(COLLECTION).insertOne(doc)
  return { ...doc, _id: result.insertedId }
}

/**
 * List error groups (grouped by dedupeKey) for the admin UI, newest activity
 * first. Each group carries the latest report's envelope for display plus
 * aggregate counts ("12 users x BRAVIA 4K VH2 x same error").
 */
export async function getClientErrorGroups({
  severity = null,
  category = null,
  platform = null,
  page = 1,
  limit = 25,
} = {}) {
  const client = await clientPromise
  const db = client.db('Media')
  const collection = db.collection(COLLECTION)

  const match = {}
  if (severity) match.severity = severity
  if (category) match.category = category
  if (platform) match['app.platform'] = platform

  const skip = (page - 1) * limit

  const [result] = await collection
    .aggregate([
      { $match: match },
      { $sort: { receivedAt: -1 } },
      {
        $group: {
          _id: '$dedupeKey',
          count: { $sum: 1 },
          userIds: { $addToSet: '$userId' },
          deviceModels: { $addToSet: '$device.model' },
          platforms: { $addToSet: '$app.platform' },
          appVersions: { $addToSet: '$app.version' },
          firstSeen: { $min: '$receivedAt' },
          lastSeen: { $max: '$receivedAt' },
          latest: { $first: '$$ROOT' },
        },
      },
      {
        $project: {
          _id: 0,
          dedupeKey: '$_id',
          count: 1,
          userCount: { $size: '$userIds' },
          deviceModels: 1,
          platforms: 1,
          appVersions: 1,
          firstSeen: 1,
          lastSeen: 1,
          severity: '$latest.severity',
          category: '$latest.category',
          message: '$latest.message',
          latestApp: '$latest.app',
          latestDevice: '$latest.device',
        },
      },
      { $sort: { lastSeen: -1 } },
      {
        $facet: {
          groups: [{ $skip: skip }, { $limit: limit }],
          totalCount: [{ $count: 'count' }],
        },
      },
    ])
    .toArray()

  const totalCount = result?.totalCount?.[0]?.count || 0

  return {
    groups: result?.groups || [],
    pagination: {
      page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    },
  }
}

/**
 * List raw reports for one dedupeKey group, newest first.
 */
export async function getClientErrorReports({ dedupeKey, page = 1, limit = 20 }) {
  const client = await clientPromise
  const db = client.db('Media')
  const collection = db.collection(COLLECTION)

  const query = { dedupeKey }
  const skip = (page - 1) * limit

  const [reports, totalCount] = await Promise.all([
    collection.find(query).sort({ receivedAt: -1 }).skip(skip).limit(limit).toArray(),
    collection.countDocuments(query),
  ])

  return {
    reports,
    pagination: {
      page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    },
  }
}

/**
 * Overall counts for the admin UI filter tabs.
 */
export async function getClientErrorStats() {
  const client = await clientPromise
  const db = client.db('Media')
  const collection = db.collection(COLLECTION)

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const [severityAgg, categoryAgg, last24h] = await Promise.all([
    collection.aggregate([{ $group: { _id: '$severity', count: { $sum: 1 } } }]).toArray(),
    collection.aggregate([{ $group: { _id: '$category', count: { $sum: 1 } } }]).toArray(),
    collection.countDocuments({ receivedAt: { $gte: dayAgo } }),
  ])

  const severity = Object.fromEntries(severityAgg.map((s) => [s._id, s.count]))
  const category = Object.fromEntries(categoryAgg.map((c) => [c._id, c.count]))
  const total = severityAgg.reduce((sum, s) => sum + s.count, 0)

  return { total, last24h, severity, category }
}

/**
 * Admin cleanup: delete one dedupeKey group, or everything.
 * @returns {Promise<number>} Deleted document count
 */
export async function deleteClientErrorReports({ dedupeKey = null, all = false } = {}) {
  const client = await clientPromise
  const db = client.db('Media')
  const collection = db.collection(COLLECTION)

  let query
  if (dedupeKey) {
    query = { dedupeKey }
  } else if (all) {
    query = {}
  } else {
    return 0
  }

  const result = await collection.deleteMany(query)
  log.info({ dedupeKey, all, deletedCount: result.deletedCount }, 'Deleted client error reports')
  return result.deletedCount
}
