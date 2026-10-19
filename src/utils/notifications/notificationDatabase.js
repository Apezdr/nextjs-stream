import clientPromise from '@src/lib/mongodb';
import { ObjectId } from 'mongodb';
import { createLogger } from '@src/lib/logger';
import { userQueries } from '@src/lib/userQueries';
import { getAllWatchHistoryUserIds } from '@src/utils/watchHistory/database';
import { runMigrationOnce } from '@src/utils/migrations/runOnce';

/**
 * Database operations for notifications
 * All userId parameters are expected to be ObjectIds
 */

const log = createLogger('Notifications');

// The unread counts and the newest-first lists read through these two. Keys
// and names must match the indexes prod already has, so createIndex is a
// no-op there: the same keys under another name raise IndexOptionsConflict.
const NOTIFICATION_INDEXES = [
  { key: { userId: 1, read: 1 }, name: 'userId_read_index' },
  { key: { userId: 1, createdAt: -1 }, name: 'userId_createdAt_index' },
];

/**
 * RETENTION, per kind of notification (owner's decisions, 2026-10-17). MongoDB
 * TTL indexes do the deleting; NOTIFICATION_FRAMEWORK_DESIGN.md ("Retention")
 * says the same for readers who do not read code.
 *
 *  - Read, any type: deleted READ_NOTIFICATION_TTL_SECONDS (30 days) after
 *    `readAt` (READ_TTL_INDEX). The mark-read functions below are the only
 *    writers of `readAt`.
 *  - Unread new-content notices (`type: 'new_content'`, the digest included):
 *    deleted UNREAD_NEW_CONTENT_TTL_SECONDS (90 days) after `createdAt`
 *    (UNREAD_NEW_CONTENT_TTL_INDEX).
 *  - Every other unread notification: kept.
 *
 * Partial filters may use equality, `$exists: true`, `$gt`/`$gte`/`$lt`/`$lte`,
 * `$type` and `$and` (MongoDB 6.0 and later also allow `$or` and `$in`), never
 * `$ne`, `$nin` or `$not`; a TTL index is on one date field. Both indexes keep to
 * equality, which every supported MongoDB accepts.
 *
 * A CRITICAL TYPE (planned, not built: never expires, a user holds at most one)
 * fits like this. It is not `new_content`, so the unread index never matches it.
 * It must never carry `readAt`, so the read index never matches it either:
 * marking it read sets `read` and `updatedAt` only, which means the mark-read
 * functions below give its type a branch of their own, and it is the one
 * place to change. "At most one per user" is replaceNotificationByGroup with a
 * groupKey per critical type, replacing read notifications as well as unread
 * ones.
 */

/** How long a read notification is kept after it was read. */
export const READ_NOTIFICATION_TTL_SECONDS = 30 * 24 * 60 * 60;

/** How long an unread new-content notice is kept after it was created. */
export const UNREAD_NEW_CONTENT_TTL_SECONDS = 90 * 24 * 60 * 60;

/** The new-content notices' type (NOTIFICATION_TYPES.NEW_CONTENT), the digest included. */
const NEW_CONTENT_TYPE = 'new_content';

const READ_TTL_INDEX = {
  key: { readAt: 1 },
  name: 'readAt_ttl_read',
  expireAfterSeconds: READ_NOTIFICATION_TTL_SECONDS,
  partialFilterExpression: { read: true },
};

const UNREAD_NEW_CONTENT_TTL_INDEX = {
  key: { createdAt: 1 },
  name: 'createdAt_ttl_unread_new_content',
  expireAfterSeconds: UNREAD_NEW_CONTENT_TTL_SECONDS,
  partialFilterExpression: { read: false, type: NEW_CONTENT_TYPE },
};

const TTL_INDEXES = [READ_TTL_INDEX, UNREAD_NEW_CONTENT_TTL_INDEX];

/** The backfill's flag in app_config.migrations (migrations/runOnce). */
export const READ_AT_BACKFILL_MIGRATION = 'notifications-readAt-from-createdAt';

/** The unused-index drop's flag in app_config.migrations (migrations/runOnce). */
export const DROP_UNUSED_INDEXES_MIGRATION = 'notifications-drop-unused-category-priority-indexes';

// Older builds left these two on prod databases. No query uses them (0 uses
// since mongod's last start on 2026-10-17) and no code creates them.
const UNUSED_INDEX_NAMES = ['userId_category_index', 'userId_priority_index'];

// IndexNotFound, and NamespaceNotFound for a database whose collection does
// not exist yet: there is nothing to drop, which is the goal reached.
const NOTHING_TO_DROP_CODES = new Set([26, 27]);

let indexesEnsured = null;

/**
 * Drops the unused indexes by name, leaving every other index alone. Idempotent.
 *
 * @removeAtVersion 2026.10.0 Unused Notifications index drop for databases from
 *   older builds; delete this function, UNUSED_INDEX_NAMES, its runMigrationOnce
 *   call in ensureIndexes and its tests when the version reaches 2026.10.0.
 */
async function dropUnusedIndexes(collection) {
  const dropped = [];
  for (const name of UNUSED_INDEX_NAMES) {
    try {
      await collection.dropIndex(name);
      dropped.push(name);
    } catch (err) {
      if (!NOTHING_TO_DROP_CODES.has(err?.code)) throw err;
    }
  }
  return { dropped };
}

/**
 * Every read notification without a `readAt` gets its `createdAt` (now, when
 * it has none), once per database, so the read TTL index covers it too, and
 * one read long ago goes promptly. Read notifications that have a `readAt`
 * keep it: the owner chose to let the backlog read more than 30 days ago go
 * when the index is built. Idempotent.
 *
 * @removeAtVersion 2026.10.0 readAt backfill for read notifications from before
 *   the read TTL index; delete this function, its runMigrationOnce call in
 *   ensureIndexes and its tests when the version reaches 2026.10.0.
 */
async function backfillReadAt(collection) {
  const result = await collection.updateMany(
    { read: true, readAt: { $exists: false } },
    [{ $set: { readAt: { $ifNull: ['$createdAt', '$$NOW'] } } }]
  );
  return { readNotificationsWithoutReadAt: result?.modifiedCount ?? 0 };
}

/**
 * Creates the indexes once per process, after the readAt backfill. Never
 * throws into the request that triggered it: a failure is logged and the
 * request goes on without them; a failed backfill is tried again by the next
 * process.
 */
function ensureIndexes(client, collection) {
  indexesEnsured ??= (async () => {
    try {
      const backfill = await runMigrationOnce(client, READ_AT_BACKFILL_MIGRATION, () => backfillReadAt(collection));
      if (backfill.applied) log.info({ ...backfill.result }, 'Gave read notifications without a readAt their createdAt');
    } catch (err) {
      log.error({ err, migration: READ_AT_BACKFILL_MIGRATION }, 'Could not backfill readAt on read notifications');
    }

    try {
      const drop = await runMigrationOnce(client, DROP_UNUSED_INDEXES_MIGRATION, () => dropUnusedIndexes(collection));
      if (drop.applied) log.info({ ...drop.result }, 'Dropped the unused Notifications indexes');
    } catch (err) {
      log.error({ err, migration: DROP_UNUSED_INDEXES_MIGRATION }, 'Could not drop the unused Notifications indexes');
    }

    const specs = [...NOTIFICATION_INDEXES, ...TTL_INDEXES];
    const results = await Promise.allSettled(
      specs.map(({ key, ...options }) => collection.createIndex(key, options))
    );
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        log.error(
          { err: result.reason, indexName: specs[i].name },
          'Could not ensure a Notifications index'
        );
      }
    });
  })();
  return indexesEnsured;
}

async function notificationsCollection() {
  const client = await clientPromise;
  const collection = client.db('Media').collection('Notifications');
  await ensureIndexes(client, collection);
  return collection;
}

/**
 * Create a new notification
 * @param {Object} notificationData - The notification data
 * @returns {Promise<Object>} The created notification
 */
export async function createNotification(notificationData) {
  const collection = await notificationsCollection();

  // Add timestamps
  const notification = {
    ...notificationData,
    userId: new ObjectId(notificationData.userId),
    read: false,
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const result = await collection.insertOne(notification);
  return { ...notification, _id: result.insertedId };
}

/**
 * Create multiple notifications (for broadcast)
 * @param {Array} notifications - Array of notification data
 * @returns {Promise<Array>} The created notifications
 */
export async function createNotifications(notifications) {
  const collection = await notificationsCollection();

  const now = new Date();
  const notificationsWithTimestamps = notifications.map(notification => ({
    ...notification,
    userId: new ObjectId(notification.userId),
    read: false,
    createdAt: now,
    updatedAt: now
  }));

  const result = await collection.insertMany(notificationsWithTimestamps);
  return notificationsWithTimestamps.map((notification, index) => ({
    ...notification,
    _id: result.insertedIds[index]
  }));
}

/**
 * Insert notifications whose `_id`s the caller derived deterministically, so
 * that inserting the same batch again adds only what is missing: a duplicate
 * `_id` is a notification that is already there, not an error. Every other
 * failure throws, and the caller tries the whole batch again later.
 *
 * @param {Array<Object>} notifications - Each with `_id` (ObjectId) and `userId`
 * @returns {Promise<{inserted: number, alreadyThere: number}>}
 */
export async function insertNotificationsOnce(notifications) {
  if (notifications.length === 0) return { inserted: 0, alreadyThere: 0 };
  const collection = await notificationsCollection();

  const now = new Date();
  const docs = notifications.map((notification) => ({
    ...notification,
    userId: new ObjectId(notification.userId),
    read: false,
    createdAt: now,
    updatedAt: now,
  }));

  try {
    const result = await collection.insertMany(docs, { ordered: false });
    return { inserted: result.insertedCount ?? docs.length, alreadyThere: 0 };
  } catch (error) {
    const writeErrors = Array.isArray(error?.writeErrors)
      ? error.writeErrors
      : Object.values(error?.writeErrors ?? {});
    const codes = writeErrors.length > 0 ? writeErrors.map((e) => e?.code ?? e?.err?.code) : [error?.code];
    if (codes.length > 0 && codes.every((code) => code === 11000)) {
      return { inserted: docs.length - codes.length, alreadyThere: codes.length };
    }
    throw error;
  }
}

/**
 * Get notifications with custom query
 * @param {Object} query - MongoDB query object
 * @param {Object} options - Query options (sort, limit, etc.)
 * @returns {Promise<Array>} Array of matching notifications
 */
export async function getNotifications(query = {}, options = {}) {
  const collection = await notificationsCollection();

  const {
    sort = { createdAt: -1 },
    limit = null,
    skip = 0
  } = options;

  let cursor = collection.find(query).sort(sort).skip(skip);
  
  if (limit) {
    cursor = cursor.limit(limit);
  }

  return await cursor.toArray();
}

/**
 * Get notifications for a user with pagination
 * @param {ObjectId|string} userId - The user ID as ObjectId
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Notifications and metadata
 */
export async function getUserNotifications(userId, options = {}) {
  const collection = await notificationsCollection();

  const {
    page = 1,
    limit = 20,
    unreadOnly = false,
    category = null,
    priority = null
  } = options;

  // Build query with ObjectId userId
  const userObjectId = new ObjectId(userId);
  const query = { userId: userObjectId };
  if (unreadOnly) query.read = false;
  if (category) query.category = category;
  if (priority) query.priority = priority;

  // Calculate pagination
  const skip = (page - 1) * limit;

  // Get notifications and total count
  const [notifications, totalCount, unreadCount] = await Promise.all([
    collection
      .find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray(),
    collection.countDocuments(query),
    collection.countDocuments({ userId: userObjectId, read: false })
  ]);

  return {
    notifications,
    pagination: {
      page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      hasNext: page < Math.ceil(totalCount / limit),
      hasPrev: page > 1
    },
    unreadCount
  };
}

/**
 * Mark notification as read
 * @param {string} notificationId - The notification ID
 * @param {ObjectId|string} userId - The user ID (for security)
 * @returns {Promise<boolean>} Success status
 */
export async function markNotificationAsRead(notificationId, userId) {
  const collection = await notificationsCollection();

  const result = await collection.updateOne(
    { _id: new ObjectId(notificationId), userId: new ObjectId(userId) },
    { 
      $set: { 
        read: true, 
        readAt: new Date(),
        updatedAt: new Date()
      } 
    }
  );

  return result.matchedCount > 0;
}

/**
 * Mark multiple notifications as read
 * @param {Array} notificationIds - Array of notification IDs
 * @param {ObjectId|string} userId - The user ID (for security)
 * @returns {Promise<number>} Number of notifications marked as read
 */
export async function markNotificationsAsRead(notificationIds, userId) {
  const collection = await notificationsCollection();

  const objectIds = notificationIds.map(id => new ObjectId(id));
  const result = await collection.updateMany(
    { _id: { $in: objectIds }, userId: new ObjectId(userId) },
    { 
      $set: { 
        read: true, 
        readAt: new Date(),
        updatedAt: new Date()
      } 
    }
  );

  return result.modifiedCount;
}

/**
 * Mark all notifications as read for a user
 * @param {ObjectId|string} userId - The user ID
 * @returns {Promise<number>} Number of notifications marked as read
 */
export async function markAllNotificationsAsRead(userId) {
  const collection = await notificationsCollection();

  const result = await collection.updateMany(
    { userId: new ObjectId(userId), read: false },
    { 
      $set: { 
        read: true, 
        readAt: new Date(),
        updatedAt: new Date()
      } 
    }
  );

  return result.modifiedCount;
}

/**
 * Delete a notification
 * @param {string} notificationId - The notification ID
 * @param {ObjectId|string} userId - The user ID (for security)
 * @returns {Promise<boolean>} Success status
 */
export async function deleteNotification(notificationId, userId) {
  const collection = await notificationsCollection();

  const result = await collection.deleteOne({
    _id: new ObjectId(notificationId),
    userId: new ObjectId(userId)
  });

  return result.deletedCount > 0;
}

/**
 * Replace existing notification with same groupKey
 * @param {ObjectId|string} userId - The user ID
 * @param {string} groupKey - The group key to replace
 * @param {Object} newNotificationData - New notification data
 * @returns {Promise<Object>} The created/updated notification
 */
export async function replaceNotificationByGroup(userId, groupKey, newNotificationData) {
  const collection = await notificationsCollection();

  const userObjectId = new ObjectId(userId);

  // Find existing notification with same groupKey
  const existingNotification = await collection.findOne({
    userId: userObjectId,
    groupKey,
    read: false // Only replace unread notifications
  });

  if (existingNotification) {
    // Replace existing notification
    const updatedNotification = {
      ...newNotificationData,
      userId: userObjectId,
      read: false,
      createdAt: new Date(), // Reset creation time for new content
      updatedAt: new Date(),
      replaces: existingNotification._id
    };

    // Update the existing notification
    await collection.replaceOne(
      { _id: existingNotification._id },
      updatedNotification
    );

    return { ...updatedNotification, _id: existingNotification._id };
  } else {
    // Create new notification
    return await createNotification({ ...newNotificationData, userId: userObjectId });
  }
}

/**
 * Get unread notification count for a user
 * @param {ObjectId|string} userId - The user ID
 * @returns {Promise<number>} Unread count
 */
export async function getUnreadNotificationCount(userId) {
  const collection = await notificationsCollection();

  return await collection.countDocuments({ userId: new ObjectId(userId), read: false });
}

/**
 * Get all user IDs (for broadcast notifications)
 * @returns {Promise<Array>} Array of user IDs as ObjectIds
 */
export async function getAllUserIds() {
  // Use centralized WatchHistory query function
  const userIds = await getAllWatchHistoryUserIds();
  
  return userIds
    .filter(id => id && id.toString && id.toString().trim && id.toString().trim() !== '')
    .map(id => typeof id === 'string' ? new ObjectId(id) : id);
}

/**
 * Get admin user IDs based on email addresses from config
 * @param {Array} adminEmails - Array of admin email addresses
 * @returns {Promise<Array>} Array of admin user IDs as ObjectIds
 */
export async function getAdminUserIds(adminEmails) {
  if (!adminEmails || adminEmails.length === 0) {
    return [];
  }

  // Get users with admin email addresses
  const adminUsers = await userQueries.find(
    { email: { $in: adminEmails } },
    { _id: 1 }
  );
  
  return adminUsers.map(user => user._id); // Already ObjectIds from MongoDB
}

/**
 * Clean up old notifications
 * @param {number} daysOld - Delete notifications older than this many days
 * @returns {Promise<number>} Number of deleted notifications
 */
export async function cleanupOldNotifications(daysOld = 30) {
  const collection = await notificationsCollection();

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);

  const result = await collection.deleteMany({
    read: true,
    createdAt: { $lt: cutoffDate }
  });

  return result.deletedCount;
}

/**
 * Get notification by ID
 * @param {string} notificationId - The notification ID
 * @param {ObjectId|string} userId - The user ID (for security)
 * @returns {Promise<Object|null>} The notification or null
 */
export async function getNotificationById(notificationId, userId) {
  const collection = await notificationsCollection();

  return await collection.findOne({
    _id: new ObjectId(notificationId),
    userId: new ObjectId(userId)
  });
}
