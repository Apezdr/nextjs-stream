'use client';

import useSWR, { mutate } from 'swr';
import { useSession } from 'next-auth/react';
import { useCallback, useMemo } from 'react';
import { fetcher } from '@src/utils';

/**
 * Master cache key for all notifications (fetch more than we typically need)
 */
const MASTER_NOTIFICATIONS_KEY = '/api/authenticated/notifications?limit=500&page=1';

/**
 * Cache key for unread count
 */
const UNREAD_COUNT_KEY = '/api/authenticated/notifications?count=true';

/**
 * Client-side filtering and pagination utilities
 */
const filterNotifications = (notifications, filters = {}) => {
  if (!notifications || !Array.isArray(notifications)) return [];

  return notifications.filter(notification => {
    // Filter by read status
    if (filters.unreadOnly && notification.read) return false;
    if (filters.readOnly && !notification.read) return false;
    
    // Filter by category
    if (filters.category && filters.category !== 'all' && notification.category !== filters.category) return false;
    
    // Filter by priority
    if (filters.priority && notification.priority !== filters.priority) return false;
    
    return true;
  });
};

const paginateNotifications = (notifications, page = 1, limit = 20) => {
  if (!notifications || !Array.isArray(notifications)) return { items: [], totalPages: 1, total: 0 };

  const startIndex = (page - 1) * limit;
  const endIndex = startIndex + limit;
  const items = notifications.slice(startIndex, endIndex);
  const totalPages = Math.ceil(notifications.length / limit);

  return {
    items,
    totalPages,
    total: notifications.length
  };
};

/**
 * Custom hook for notifications using unified cache with client-side filtering
 * @param {Object} options - Query options for notifications (now used for client-side filtering)
 * @returns {Object} SWR data and utility functions
 */
export function useNotifications(options = {}) {
  const { data: session, status: authStatus } = useSession();
  
  const isAuthenticated = authStatus === 'authenticated' && session;
  
  // Master notifications query - fetch all notifications once
  const { 
    data: masterData, 
    error: masterError, 
    isLoading: masterLoading,
    isValidating: masterValidating,
    mutate: mutateMaster
  } = useSWR(isAuthenticated ? MASTER_NOTIFICATIONS_KEY : null, fetcher, {
    refreshInterval: 5000,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    dedupingInterval: 2000,
  });
  
  // Unread count query (separate for efficiency and real-time updates)
  const { 
    data: unreadCountData, 
    error: unreadCountError,
    isLoading: unreadCountLoading,
    mutate: mutateUnreadCount
  } = useSWR(isAuthenticated ? UNREAD_COUNT_KEY : null, fetcher, {
    refreshInterval: 10000, // Auto-refresh every 10 seconds
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    dedupingInterval: 2000,
  });

  // Client-side filtering and pagination
  const processedData = useMemo(() => {
    if (!masterData?.notifications) {
      return {
        notifications: [],
        totalPages: 1,
        total: 0
      };
    }

    // Apply filters
    const filteredNotifications = filterNotifications(masterData.notifications, {
      unreadOnly: options.unreadOnly,
      readOnly: options.readOnly,
      category: options.category,
      priority: options.priority
    });

    // Apply pagination
    const paginatedResult = paginateNotifications(
      filteredNotifications, 
      options.page || 1, 
      options.limit || 20
    );

    return {
      notifications: paginatedResult.items,
      totalPages: paginatedResult.totalPages,
      total: paginatedResult.total
    };
  }, [masterData, options.unreadOnly, options.readOnly, options.category, options.priority, options.page, options.limit]);

  /**
   * Mark a single notification as read with optimistic update
   */
  const markAsRead = useCallback(async (notificationId) => {
    if (!isAuthenticated) return false;

    try {
      // Optimistic update for master cache
      if (masterData?.notifications) {
        const optimisticData = {
          ...masterData,
          notifications: masterData.notifications.map(notification =>
            notification._id === notificationId
              ? { ...notification, read: true, readAt: new Date().toISOString() }
              : notification
          )
        };
        
        mutateMaster(optimisticData, false);
      }

      // Optimistic update for unread count
      if (unreadCountData && unreadCountData.unreadCount > 0) {
        const targetNotification = masterData?.notifications?.find(n => n._id === notificationId);
        if (targetNotification && !targetNotification.read) {
          const optimisticCount = {
            ...unreadCountData,
            unreadCount: Math.max(0, unreadCountData.unreadCount - 1)
          };
          mutateUnreadCount(optimisticCount, false);
        }
      }

      // Make API call
      const response = await fetch('/api/authenticated/notifications/mark-read', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id: notificationId }),
      });

      if (!response.ok) {
        throw new Error(`Failed to mark notification as read: ${response.status}`);
      }

      // Revalidate caches
      mutateMaster();
      mutateUnreadCount();
      
      return true;
    } catch (error) {
      console.error('Error marking notification as read:', error);
      
      // Revert optimistic updates on error
      mutateMaster();
      mutateUnreadCount();
      
      return false;
    }
  }, [isAuthenticated, masterData, unreadCountData, mutateMaster, mutateUnreadCount]);

  /**
   * Mark all notifications as read with optimistic update
   */
  const markAllAsRead = useCallback(async () => {
    if (!isAuthenticated) return false;

    try {
      // Optimistic update for master cache
      if (masterData?.notifications) {
        const optimisticData = {
          ...masterData,
          notifications: masterData.notifications.map(notification => ({
            ...notification,
            read: true,
            readAt: new Date().toISOString()
          }))
        };
        
        mutateMaster(optimisticData, false);
      }

      // Optimistic update for unread count
      if (unreadCountData) {
        const optimisticCount = {
          ...unreadCountData,
          unreadCount: 0
        };
        mutateUnreadCount(optimisticCount, false);
      }

      // Make API call
      const response = await fetch('/api/authenticated/notifications/mark-read', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ all: true }),
      });

      if (!response.ok) {
        throw new Error(`Failed to mark all notifications as read: ${response.status}`);
      }

      // Revalidate caches
      mutateMaster();
      mutateUnreadCount();
      
      return true;
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
      
      // Revert optimistic updates on error
      mutateMaster();
      mutateUnreadCount();
      
      return false;
    }
  }, [isAuthenticated, masterData, unreadCountData, mutateMaster, mutateUnreadCount]);

  /**
   * Dismiss a notification with optimistic update
   */
  const dismissNotification = useCallback(async (notificationId) => {
    if (!isAuthenticated) return false;

    // Store original data for potential rollback
    const originalMasterData = masterData;
    const originalUnreadCountData = unreadCountData;

    try {
      // Find the notification to check if it was unread
      const dismissedNotification = masterData?.notifications?.find(n => n._id === notificationId);
      const wasUnread = dismissedNotification && !dismissedNotification.read;

      // Optimistic update for master cache - immediately remove the notification
      if (masterData?.notifications) {
        const optimisticData = {
          ...masterData,
          notifications: masterData.notifications.filter(notification => 
            notification._id !== notificationId
          ),
          pagination: {
            ...masterData.pagination,
            total: Math.max(0, (masterData.pagination?.total || masterData.notifications.length) - 1)
          }
        };
        
        // Force immediate update without revalidation
        await mutateMaster(optimisticData, false);
      }

      // Optimistic update for unread count if the dismissed notification was unread
      if (wasUnread && unreadCountData && unreadCountData.unreadCount > 0) {
        const optimisticCount = {
          ...unreadCountData,
          unreadCount: Math.max(0, unreadCountData.unreadCount - 1)
        };
        
        // Force immediate update without revalidation
        await mutateUnreadCount(optimisticCount, false);
      }

      // Make API call
      const response = await fetch('/api/authenticated/notifications/dismiss', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id: notificationId }),
      });

      if (!response.ok) {
        throw new Error(`Failed to dismiss notification: ${response.status}`);
      }

      // Revalidate caches (but don't wait for it)
      mutateMaster();
      mutateUnreadCount();
      
      return true;
    } catch (error) {
      console.error('Error dismissing notification:', error);
      
      // Revert optimistic updates on error by restoring original data
      if (originalMasterData) {
        mutateMaster(originalMasterData, false);
      }
      if (originalUnreadCountData) {
        mutateUnreadCount(originalUnreadCountData, false);
      }
      
      return false;
    }
  }, [isAuthenticated, masterData, unreadCountData, mutateMaster, mutateUnreadCount]);

  /**
   * Refresh notifications data
   */
  const refresh = useCallback(() => {
    if (isAuthenticated) {
      mutateMaster();
      mutateUnreadCount();
    }
  }, [isAuthenticated, mutateMaster, mutateUnreadCount]);

  /**
   * Invalidate all notification-related cache keys
   */
  const invalidateAll = useCallback(() => {
    if (isAuthenticated) {
      // Invalidate all notification-related cache keys
      mutate(key => typeof key === 'string' && key.startsWith('/api/authenticated/notifications'));
    }
  }, [isAuthenticated]);

  // Return appropriate values based on auth status
  if (!isAuthenticated) {
    return {
      notifications: [],
      unreadCount: 0,
      totalPages: 1,
      loading: authStatus === 'loading',
      error: null,
      markAsRead: async () => false,
      markAllAsRead: async () => false,
      dismissNotification: async () => false,
      refresh: () => {},
      invalidateAll: () => {}
    };
  }

  return {
    notifications: processedData.notifications,
    unreadCount: unreadCountData?.unreadCount || 0,
    totalPages: processedData.totalPages,
    loading: masterLoading || unreadCountLoading,
    validating: masterLoading && masterValidating,
    error: masterError || unreadCountError,
    markAsRead,
    markAllAsRead,
    dismissNotification,
    refresh,
    invalidateAll
  };
}

/**
 * Hook specifically for unread count (lightweight, but now shares the same unified approach)
 */
export function useUnreadCount() {
  const { data: session, status: authStatus } = useSession();
  const isAuthenticated = authStatus === 'authenticated' && session;
  
  const { data, error, isLoading } = useSWR(
    isAuthenticated ? UNREAD_COUNT_KEY : null, 
    fetcher, 
    {
      refreshInterval: 10000,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      dedupingInterval: 2000,
    }
  );

  return {
    unreadCount: data?.unreadCount || 0,
    loading: isLoading,
    error: error
  };
}
