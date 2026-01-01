/**
 * Notification type definitions and templates
 */

export const NOTIFICATION_TYPES = {
  SYNC_COMPLETE: 'sync_complete',
  NEW_CONTENT: 'new_content',
  SYSTEM_ALERT: 'system_alert',
  ADMIN_MESSAGE: 'admin_message',
  SYNC_ERROR: 'sync_error',
  NEW_EPISODE: 'new_episode',
  NEW_MOVIE: 'new_movie',
  MAINTENANCE: 'maintenance'
};

export const NOTIFICATION_PRIORITIES = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  URGENT: 'urgent'
};

export const NOTIFICATION_CATEGORIES = {
  SYNC: 'sync',
  CONTENT: 'content',
  SYSTEM: 'system',
  ADMIN: 'admin'
};

/**
 * Template generators for different notification types
 */
export const NotificationTemplates = {
  syncComplete: (serverName, stats = {}) => ({
    type: NOTIFICATION_TYPES.SYNC_COMPLETE,
    title: 'Sync Complete',
    message: `${serverName} sync completed successfully`,
    data: {
      serverName,
      stats,
      actionUrl: '/admin'
    },
    priority: NOTIFICATION_PRIORITIES.LOW,
    category: NOTIFICATION_CATEGORIES.SYNC,
    groupKey: `sync_${serverName.toLowerCase().replace(/\s+/g, '_')}`
  }),

  syncError: (serverName, error) => ({
    type: NOTIFICATION_TYPES.SYNC_ERROR,
    title: 'Sync Failed',
    message: `${serverName} sync encountered an error`,
    data: {
      serverName,
      error: error?.message || 'Unknown error',
      actionUrl: '/admin'
    },
    priority: NOTIFICATION_PRIORITIES.HIGH,
    category: NOTIFICATION_CATEGORIES.SYNC,
    groupKey: `sync_error_${serverName.toLowerCase().replace(/\s+/g, '_')}`
  }),

  newContent: (mediaTitle, mediaType, count = 1) => ({
    type: mediaType === 'episode' ? NOTIFICATION_TYPES.NEW_EPISODE : NOTIFICATION_TYPES.NEW_MOVIE,
    title: `New ${mediaType === 'episode' ? 'Episode' : 'Movie'} Available`,
    message: count > 1 
      ? `${count} new ${mediaType}s available including ${mediaTitle}`
      : `${mediaTitle} is now available`,
    data: {
      mediaTitle,
      mediaType,
      count,
      actionUrl: mediaType === 'episode' ? '/list/tv' : '/list/movies'
    },
    priority: NOTIFICATION_PRIORITIES.MEDIUM,
    category: NOTIFICATION_CATEGORIES.CONTENT,
    groupKey: `new_${mediaType}_content`
  }),

  systemAlert: (message, priority = NOTIFICATION_PRIORITIES.MEDIUM, actionUrl = null) => ({
    type: NOTIFICATION_TYPES.SYSTEM_ALERT,
    title: 'System Alert',
    message,
    data: {
      actionUrl
    },
    priority,
    category: NOTIFICATION_CATEGORIES.SYSTEM,
    groupKey: 'system_alert'
  }),

  adminMessage: (title, message, priority = NOTIFICATION_PRIORITIES.MEDIUM, actionUrl = null) => ({
    type: NOTIFICATION_TYPES.ADMIN_MESSAGE,
    title,
    message,
    data: {
      actionUrl
    },
    priority,
    category: NOTIFICATION_CATEGORIES.ADMIN,
    groupKey: null // Admin messages don't replace each other
  }),

  maintenance: (scheduledTime, duration = null) => ({
    type: NOTIFICATION_TYPES.MAINTENANCE,
    title: 'Scheduled Maintenance',
    message: `System maintenance scheduled for ${scheduledTime}${duration ? ` (${duration})` : ''}`,
    data: {
      scheduledTime,
      duration,
      actionUrl: null
    },
    priority: NOTIFICATION_PRIORITIES.HIGH,
    category: NOTIFICATION_CATEGORIES.SYSTEM,
    groupKey: 'maintenance'
  })
};

/**
 * Get notification icon based on type
 */
export const getNotificationIcon = (type) => {
  switch (type) {
    case NOTIFICATION_TYPES.SYNC_COMPLETE:
      return '✅';
    case NOTIFICATION_TYPES.SYNC_ERROR:
      return '❌';
    case NOTIFICATION_TYPES.NEW_EPISODE:
    case NOTIFICATION_TYPES.NEW_MOVIE:
    case NOTIFICATION_TYPES.NEW_CONTENT:
      return '🎬';
    case NOTIFICATION_TYPES.SYSTEM_ALERT:
      return '⚠️';
    case NOTIFICATION_TYPES.ADMIN_MESSAGE:
      return '📢';
    case NOTIFICATION_TYPES.MAINTENANCE:
      return '🔧';
    default:
      return '🔔';
  }
};

/**
 * Get notification color based on priority
 */
export const getNotificationColor = (priority) => {
  switch (priority) {
    case NOTIFICATION_PRIORITIES.URGENT:
      return 'text-red-600 bg-red-50';
    case NOTIFICATION_PRIORITIES.HIGH:
      return 'text-orange-600 bg-orange-50';
    case NOTIFICATION_PRIORITIES.MEDIUM:
      return 'text-blue-600 bg-blue-50';
    case NOTIFICATION_PRIORITIES.LOW:
      return 'text-gray-600 bg-gray-50';
    default:
      return 'text-gray-600 bg-gray-50';
  }
};
