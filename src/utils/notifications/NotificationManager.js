import { 
  createNotification, 
  createNotifications, 
  replaceNotificationByGroup,
  getAllUserIds,
  getAdminUserIds,
  getNotifications 
} from './notificationDatabase.js';
import { NotificationTemplates } from './NotificationTypes.js';
import { adminUserEmails } from '../config.js';

/**
 * Central notification manager for creating notifications throughout the app
 */
export class NotificationManager {
  
  /**
   * Create a basic notification
   * @param {string} userId - The user ID
   * @param {string} type - The notification type
   * @param {Object} data - Additional data for the notification
   * @returns {Promise<Object>} The created notification
   */
  static async create(userId, type, data = {}) {
    const notificationData = {
      userId,
      type,
      ...data
    };
    
    return await createNotification(notificationData);
  }

  /**
   * Create a notification (alternative method name for compatibility)
   * @param {string} userId - The user ID
   * @param {Object} notificationData - The notification data
   * @returns {Promise<Object>} The created notification
   */
  static async createNotification(userId, notificationData) {
    return await createNotification({
      userId,
      ...notificationData
    });
  }

  /**
   * Get notifications by content hash
   * @param {string} contentHash - The content hash to search for
   * @param {Date} cutoffTime - Only return notifications after this time
   * @returns {Promise<Array>} Array of matching notifications
   */
  static async getNotificationsByContentHash(contentHash, cutoffTime) {
    try {
      const notifications = await getNotifications({
        contentHash,
        createdAt: { $gte: cutoffTime }
      });
      
      return notifications;
    } catch (error) {
      console.error('Error getting notifications by content hash:', error);
      return [];
    }
  }

  /**
   * Create notifications for all users (broadcast)
   * @param {string} type - The notification type
   * @param {Object} data - Additional data for the notification
   * @returns {Promise<Array>} The created notifications
   */
  static async createForAllUsers(type, data = {}) {
    const userIds = await getAllUserIds();
    
    if (userIds.length === 0) {
      return [];
    }

    const notifications = userIds.map(userId => ({
      userId,
      type,
      ...data
    }));

    return await createNotifications(notifications);
  }

  /**
   * Create a sync completion notification
   * @param {string} userId - The user ID
   * @param {string} serverName - The server name
   * @param {Object} stats - Sync statistics
   * @returns {Promise<Object>} The created notification
   */
  static async createSyncComplete(userId, serverName, stats = {}) {
    const template = NotificationTemplates.syncComplete(serverName, stats);
    
    // Use group replacement to avoid multiple sync notifications
    if (template.groupKey) {
      return await replaceNotificationByGroup(userId, template.groupKey, template);
    }
    
    return await createNotification({ ...template, userId });
  }

  /**
   * Create a sync completion notification for admin users only
   * @param {string} serverName - The server name
   * @param {Object} stats - Sync statistics
   * @returns {Promise<Array>} The created notifications
   */
  static async createSyncCompleteForAdmins(serverName, stats = {}) {
    const emails = adminUserEmails;
    const adminUserIds = await getAdminUserIds(emails);
    
    if (adminUserIds.length === 0) {
      console.warn('No admin users found for sync completion notification');
      return [];
    }

    const template = NotificationTemplates.syncComplete(serverName, stats);
    
    // Use group replacement to avoid multiple sync notifications
    if (template.groupKey) {
      const notifications = [];
      for (const userId of adminUserIds) {
        const notification = await replaceNotificationByGroup(userId, template.groupKey, template);
        notifications.push(notification);
      }
      return notifications;
    }

    const notifications = adminUserIds.map(userId => ({
      ...template,
      userId
    }));

    return await createNotifications(notifications);
  }

  /**
   * Create a sync error notification
   * @param {string} userId - The user ID
   * @param {string} serverName - The server name
   * @param {Error|string} error - The error that occurred
   * @returns {Promise<Object>} The created notification
   */
  static async createSyncError(userId, serverName, error) {
    const template = NotificationTemplates.syncError(serverName, error);
    
    // Use group replacement to avoid multiple error notifications
    if (template.groupKey) {
      return await replaceNotificationByGroup(userId, template.groupKey, template);
    }
    
    return await createNotification({ ...template, userId });
  }

  /**
   * Create a new content notification
   * @param {string} userId - The user ID
   * @param {string} mediaTitle - The media title
   * @param {string} mediaType - 'movie' or 'episode'
   * @param {number} count - Number of new items (default 1)
   * @returns {Promise<Object>} The created notification
   */
  static async createNewContent(userId, mediaTitle, mediaType, count = 1) {
    const template = NotificationTemplates.newContent(mediaTitle, mediaType, count);
    
    // Use group replacement for content notifications to batch similar content
    if (template.groupKey) {
      return await replaceNotificationByGroup(userId, template.groupKey, template);
    }
    
    return await createNotification({ ...template, userId });
  }

  /**
   * Create a system alert notification for all users
   * @param {string} message - The alert message
   * @param {string} priority - 'low', 'medium', 'high', or 'urgent'
   * @param {string} actionUrl - Optional URL for action
   * @returns {Promise<Array>} The created notifications
   */
  static async createSystemAlert(message, priority = 'medium', actionUrl = null) {
    const template = NotificationTemplates.systemAlert(message, priority, actionUrl);
    const userIds = await getAllUserIds();
    
    if (userIds.length === 0) {
      return [];
    }

    // For system alerts with groupKey, replace existing alerts
    if (template.groupKey) {
      const notifications = [];
      for (const userId of userIds) {
        const notification = await replaceNotificationByGroup(userId, template.groupKey, template);
        notifications.push(notification);
      }
      return notifications;
    }

    // For regular system alerts, create individual notifications
    const notifications = userIds.map(userId => ({
      ...template,
      userId
    }));

    return await createNotifications(notifications);
  }

  /**
   * Create an admin message notification for all users
   * @param {string} title - The message title
   * @param {string} message - The message content
   * @param {string} priority - 'low', 'medium', 'high', or 'urgent'
   * @param {string} actionUrl - Optional URL for action
   * @returns {Promise<Array>} The created notifications
   */
  static async createAdminMessage(title, message, priority = 'medium', actionUrl = null) {
    const template = NotificationTemplates.adminMessage(title, message, priority, actionUrl);
    const userIds = await getAllUserIds();
    
    if (userIds.length === 0) {
      return [];
    }

    const notifications = userIds.map(userId => ({
      ...template,
      userId
    }));

    return await createNotifications(notifications);
  }

  /**
   * Create a maintenance notification for all users
   * @param {string} scheduledTime - When maintenance is scheduled
   * @param {string} duration - How long maintenance will take (optional)
   * @returns {Promise<Array>} The created notifications
   */
  static async createMaintenanceNotification(scheduledTime, duration = null) {
    const template = NotificationTemplates.maintenance(scheduledTime, duration);
    const userIds = await getAllUserIds();
    
    if (userIds.length === 0) {
      return [];
    }

    // Replace existing maintenance notifications
    if (template.groupKey) {
      const notifications = [];
      for (const userId of userIds) {
        const notification = await replaceNotificationByGroup(userId, template.groupKey, template);
        notifications.push(notification);
      }
      return notifications;
    }

    const notifications = userIds.map(userId => ({
      ...template,
      userId
    }));

    return await createNotifications(notifications);
  }

  /**
   * Create new episode notification for users who have watched the show
   * @param {string} mediaTitle - The show title
   * @param {string} episodeTitle - The episode title
   * @param {number} seasonNumber - Season number
   * @param {number} episodeNumber - Episode number
   * @returns {Promise<Array>} The created notifications
   */
  static async createNewEpisodeForWatchers(mediaTitle, episodeTitle, seasonNumber, episodeNumber) {
    // This would require querying PlaybackStatus to find users who have watched this show
    // For now, we'll create a generic implementation that can be enhanced later
    
    const template = NotificationTemplates.newContent(
      `${mediaTitle} - S${seasonNumber}E${episodeNumber}: ${episodeTitle}`,
      'episode'
    );

    // Get users who have watched this show (implementation would need to query PlaybackStatus)
    // For now, broadcast to all users
    const userIds = await getAllUserIds();
    
    if (userIds.length === 0) {
      return [];
    }

    // Use groupKey to replace existing new episode notifications for this show
    const notifications = [];
    const groupKey = `new_episode_${mediaTitle.toLowerCase().replace(/\s+/g, '_')}`;
    
    for (const userId of userIds) {
      const customTemplate = {
        ...template,
        groupKey
      };
      const notification = await replaceNotificationByGroup(userId, groupKey, customTemplate);
      notifications.push(notification);
    }

    return notifications;
  }

  /**
   * Create new movie notification for all users
   * @param {string} movieTitle - The movie title
   * @param {number} year - Release year (optional)
   * @returns {Promise<Array>} The created notifications
   */
  static async createNewMovieNotification(movieTitle, year = null) {
    const title = year ? `${movieTitle} (${year})` : movieTitle;
    const template = NotificationTemplates.newContent(title, 'movie');
    
    // Use group replacement to batch new movie notifications
    const userIds = await getAllUserIds();
    
    if (userIds.length === 0) {
      return [];
    }

    if (template.groupKey) {
      const notifications = [];
      for (const userId of userIds) {
        const notification = await replaceNotificationByGroup(userId, template.groupKey, template);
        notifications.push(notification);
      }
      return notifications;
    }

    const notifications = userIds.map(userId => ({
      ...template,
      userId
    }));

    return await createNotifications(notifications);
  }

  /**
   * Create a custom notification with grouping support
   * @param {string|Array} userIds - Single user ID or array of user IDs
   * @param {Object} notificationData - Custom notification data
   * @param {boolean} useGrouping - Whether to use group replacement
   * @returns {Promise<Object|Array>} The created notification(s)
   */
  static async createCustom(userIds, notificationData, useGrouping = false) {
    const users = Array.isArray(userIds) ? userIds : [userIds];
    
    if (users.length === 0) {
      return [];
    }

    if (users.length === 1) {
      const userId = users[0];
      if (useGrouping && notificationData.groupKey) {
        return await replaceNotificationByGroup(userId, notificationData.groupKey, notificationData);
      }
      return await createNotification({ ...notificationData, userId });
    }

    // Multiple users
    if (useGrouping && notificationData.groupKey) {
      const notifications = [];
      for (const userId of users) {
        const notification = await replaceNotificationByGroup(userId, notificationData.groupKey, notificationData);
        notifications.push(notification);
      }
      return notifications;
    }

    const notifications = users.map(userId => ({
      ...notificationData,
      userId
    }));

    return await createNotifications(notifications);
  }

  /**
   * Replace existing notification by group key
   * @param {string} userId - The user ID
   * @param {string} groupKey - The group key to replace
   * @param {Object} newNotificationData - New notification data
   * @returns {Promise<Object>} The created/updated notification
   */
  static async replaceExisting(userId, groupKey, newNotificationData) {
    return await replaceNotificationByGroup(userId, groupKey, newNotificationData);
  }
}

// Export default for convenience
export default NotificationManager;
