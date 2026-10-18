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

/** How long a read notification is kept after it was read. Unread ones are kept. */
export const READ_NOTIFICATION_TTL_SECONDS = 30 * 24 * 60 * 60;

// MongoDB's TTL monitor deletes a read notification READ_NOTIFICATION_TTL_SECONDS
// after its readAt. Every path that marks a notification read sets readAt.
const READ_TTL_INDEX = {
  key: { readAt: 1 },
  name: 'readAt_ttl_read',
  expireAfterSeconds: READ_NOTIFICATION_TTL_SECONDS,
  partialFilterExpression: { read: true },
};

/** The backfill's flag in app_config.migrations (migrations/runOnce). */
export const READ_AT_BACKFILL_MIGRATION = 'notifications-readAt-restamp';

let indexesEnsured = null;

/**
 * Before the TTL index exists: give every read notification readAt = now,
 * once per database, so the ones already read expire a month after this
 * ships rather than all together the moment the index is built. (Every read
 * notification has carried a readAt since the notifications shipped, most of
 * them older than a month: left as they are, the index would delete them at
 * once.) Idempotent: a second run only moves dates a month out again.
 */
async function backfillReadAt(collection) {
  const result = await collection.updateMany({ read: true }, { $set: { readAt: new Date() } });
  return { readNotifications: result?.modifiedCount ?? 0 };
}

/**
 * Creates the indexes once per process, and the read-notification TTL index
 * once its backfill has run. Never throws into the request that triggered it:
 * a failure is logged and the request goes on without them (a failed backfill
 * leaves the TTL index for the next process).
 */
function ensureIndexes(client, collection) {
  indexesEnsured ??= (async () => {
    const results = await Promise.allSettled(
      NOTIFICATION_INDEXES.map(({ key, name }) => collection.createIndex(key, { name }))
    );
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        log.error(
          { err: result.reason, indexName: NOTIFICATION_INDEXES[i].name },
          'Could not ensure a Notifications index'
        );
      }
    });

    try {
      const backfill = await runMigrationOnce(client, READ_AT_BACKFILL_MIGRATION, () => backfillReadAt(collection));
      if (backfill.applied) log.info({ ...backfill.result }, 'Gave every read notification readAt = now');
      const { key, ...options } = READ_TTL_INDEX;
      await collection.createIndex(key, options);
    } catch (err) {
      log.error({ err, indexName: READ_TTL_INDEX.name }, 'Could not ensure a Notifications index');
    }
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
