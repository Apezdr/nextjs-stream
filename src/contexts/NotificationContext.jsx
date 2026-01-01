'use client';

import { createContext, useContext, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import useSWR from 'swr';

const NotificationContext = createContext();

// Fetcher function for SWR
const fetcher = async (url) => {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch: ${res.status}`);
  }
  return res.json();
};

/**
 * Provider component for notification information using SWR
 * @param {Object} props - Component props
 * @param {React.ReactNode} props.children - Child components
 */
export function NotificationProvider({ children }) {
  const { data: session, status: authStatus } = useSession();
  
  // SWR for notifications
  const {
    data: notificationData,
    error,
    isLoading,
    mutate
  } = useSWR(
    authStatus === 'authenticated' && session 
      ? `/api/authenticated/notifications?limit=10` 
      : null,
    fetcher,
    {
      refreshInterval: 5000, // Poll every 5 seconds
      revalidateOnFocus: true,
      dedupingInterval: 1000, // Dedupe requests within 1 second
    }
  );
  
  const notifications = notificationData?.notifications || [];
  const unreadCount = notificationData?.unreadCount || 0;
  
  const markAsRead = useCallback(async (notificationId) => {
    if (authStatus !== 'authenticated' || !session) {
      return false;
    }

    try {
      // Optimistic update
      await mutate(
        async (currentData) => {
          // Make the API call
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

          // Return optimistically updated data
          return {
            ...currentData,
            notifications: currentData.notifications.map(n =>
              n._id === notificationId
                ? { ...n, read: true, readAt: new Date() }
                : n
            ),
            unreadCount: Math.max(0, currentData.unreadCount - 1)
          };
        },
        {
          revalidate: true, // Revalidate after mutation
          populateCache: true, // Update the cache with the result
          rollbackOnError: true, // Rollback on error
        }
      );
      
      return true;
    } catch (error) {
      console.error('Error marking notification as read:', error);
      return false;
    }
  }, [authStatus, session, mutate]);

  const markAllAsRead = useCallback(async () => {
    if (authStatus !== 'authenticated' || !session) {
      return false;
    }

    try {
      await mutate(
        async (currentData) => {
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

          return {
            ...currentData,
            notifications: currentData.notifications.map(n => ({
              ...n,
              read: true,
              readAt: new Date()
            })),
            unreadCount: 0
          };
        },
        {
          revalidate: true,
          populateCache: true,
          rollbackOnError: true,
        }
      );
      
      return true;
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
      return false;
    }
  }, [authStatus, session, mutate]);

  const dismissNotification = useCallback(async (notificationId) => {
    if (authStatus !== 'authenticated' || !session) {
      return false;
    }

    try {
      await mutate(
        async (currentData) => {
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

          const dismissedNotification = currentData.notifications.find(n => n._id === notificationId);
          const wasUnread = dismissedNotification && !dismissedNotification.read;

          return {
            ...currentData,
            notifications: currentData.notifications.filter(n => n._id !== notificationId),
            unreadCount: wasUnread 
              ? Math.max(0, currentData.unreadCount - 1)
              : currentData.unreadCount
          };
        },
        {
          revalidate: true,
          populateCache: true,
          rollbackOnError: true,
        }
      );
      
      return true;
    } catch (error) {
      console.error('Error dismissing notification:', error);
      return false;
    }
  }, [authStatus, session, mutate]);

  const fetchNotifications = useCallback(async (options = {}) => {
    // With SWR, this is just a revalidation
    await mutate();
  }, [mutate]);

  // Always provide context with appropriate values based on auth status
  const contextValue = {
    notifications: authStatus === 'authenticated' && session ? notifications : [],
    unreadCount: authStatus === 'authenticated' && session ? unreadCount : 0,
    loading: authStatus === 'loading' ? true : isLoading,
    fetchNotifications: authStatus === 'authenticated' && session ? fetchNotifications : async () => {},
    markAsRead: authStatus === 'authenticated' && session ? markAsRead : async () => false,
    markAllAsRead: authStatus === 'authenticated' && session ? markAllAsRead : async () => false,
    dismissNotification: authStatus === 'authenticated' && session ? dismissNotification : async () => false,
    refresh: authStatus === 'authenticated' && session ? () => mutate() : () => {}
  };
  
  return (
    <NotificationContext.Provider value={contextValue}>
      {children}
    </NotificationContext.Provider>
  );
}

/**
 * Hook to access notifications
 * @returns {Object} Notification context
 */
export function useNotifications() {
  const context = useContext(NotificationContext);
  if (context === undefined) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
}