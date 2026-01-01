import clientPromise from '@src/lib/mongodb';
import { ObjectId } from 'mongodb';

/**
 * Database operations for notifications
 * All userId parameters are expected to be ObjectIds
 */

/**
 * Create a new notification
 * @param {Object} notificationData - The notification data
 * @returns {Promise<Object>} The created notification
 */
export async function createNotification(notificationData) {
  const client = await clientPromise;
  const db = client.db('Media');
  const collection = db.collection('Notifications');

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
  const client = await clientPromise;
  const db = client.db('Media');
  const collection = db.collection('Notifications');

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
 * Get notifications with custom query
 * @param {Object} query - MongoDB query object
 * @param {Object} options - Query options (sort, limit, etc.)
 * @returns {Promise<Array>} Array of matching notifications
 */
export async function getNotifications(query = {}, options = {}) {
  const client = await clientPromise;
  const db = client.db('Media');
  const collection = db.collection('Notifications');

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
  const client = await clientPromise;
  const db = client.db('Media');
  const collection = db.collection('Notifications');

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
  const client = await clientPromise;
  const db = client.db('Media');
  const collection = db.collection('Notifications');

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
  const client = await clientPromise;
  const db = client.db('Media');
  const collection = db.collection('Notifications');

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
  const client = await clientPromise;
  const db = client.db('Media');
  const collection = db.collection('Notifications');

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
  const client = await clientPromise;
  const db = client.db('Media');
  const collection = db.collection('Notifications');

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
  const client = await clientPromise;
  const db = client.db('Media');
  const collection = db.collection('Notifications');

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
  const client = await clientPromise;
  const db = client.db('Media');
  const collection = db.collection('Notifications');

  return await collection.countDocuments({ userId: new ObjectId(userId), read: false });
}

/**
 * Get all user IDs (for broadcast notifications)
 * @returns {Promise<Array>} Array of user IDs as ObjectIds
 */
export async function getAllUserIds() {
  const client = await clientPromise;
  const db = client.db('Media');
  const collection = db.collection('PlaybackStatus');

  // Get unique user IDs from PlaybackStatus collection and convert to ObjectIds
  const userIds = await collection.distinct('userId');
  return userIds
    .filter(id => id && id.toString().trim() !== '')
    .map(id => new ObjectId(id));
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

  const client = await clientPromise;
  const db = client.db('Users');
  const collection = db.collection('AuthenticatedUsers');

  // Get users with admin email addresses
  const adminUsers = await collection.find(
    { email: { $in: adminEmails } },
    { projection: { _id: 1 } }
  ).toArray();
  
  return adminUsers.map(user => user._id); // Already ObjectIds from MongoDB
}

/**
 * Clean up old notifications
 * @param {number} daysOld - Delete notifications older than this many days
 * @returns {Promise<number>} Number of deleted notifications
 */
export async function cleanupOldNotifications(daysOld = 30) {
  const client = await clientPromise;
  const db = client.db('Media');
  const collection = db.collection('Notifications');

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
  const client = await clientPromise;
  const db = client.db('Media');
  const collection = db.collection('Notifications');

  return await collection.findOne({
    _id: new ObjectId(notificationId),
    userId: new ObjectId(userId)
  });
}

/**
 * Update notification ETag hash for caching
 * @param {ObjectId|string} userId - The user ID
 * @returns {Promise<string>} ETag hash
 */
export async function generateNotificationETag(userId) {
  const client = await clientPromise;
  const db = client.db('Media');
  const collection = db.collection('Notifications');

  const userObjectId = new ObjectId(userId);

  // Get latest notification timestamp and unread count
  const [latestNotification, unreadCount] = await Promise.all([
    collection
      .findOne({ userId: userObjectId }, { sort: { updatedAt: -1 } }),
    collection.countDocuments({ userId: userObjectId, read: false })
  ]);

  const lastModified = latestNotification?.updatedAt?.getTime() || 0;
  const etagData = `${userObjectId.toString()}-${lastModified}-${unreadCount}`;
  
  // Simple hash function for ETag
  let hash = 0;
  for (let i = 0; i < etagData.length; i++) {
    const char = etagData.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  
  return Math.abs(hash).toString(36);
}
