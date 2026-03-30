'use client';

import { createContext, useContext, useCallback } from 'react';
import { authClient } from '@src/lib/auth-client';
import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import { fetcher } from '@src/utils';

const NotificationContext = createContext();

/**
 * Fetcher for notification mutations (POST requests)
 */
const mutationFetcher = async (url, { arg: body }) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Notification mutation failed: ${response.status}`);
  }

  return response.json();
};

/**
 * Provider component for notification information using SWR
 * @param {Object} props - Component props
 * @param {React.ReactNode} props.children - Child components
 */
export function NotificationProvider({ children }) {
  const { data: session, isPending } = authClient.useSession();
  
  // SWR for notifications - shared read cache across all instances
  const {
    data: notificationData,
    error,
    isLoading,
    mutate
  } = useSWR(
    !isPending && session?.user && session.user.approved !== false
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
  
  // Mutation: Mark single notification as read
  const { trigger: triggerMarkAsRead, isMutating: isMarkingAsRead } = useSWRMutation(
    `/api/authenticated/notifications/mark-read`,
    mutationFetcher,
    {
      optimisticData: (currentData, body) => {
        if (!currentData) return currentData;
        return {
          ...currentData,
          notifications: currentData.notifications.map(n =>
            n._id === body.id
              ? { ...n, read: true, readAt: new Date() }
              : n
          ),
          unreadCount: Math.max(0, currentData.unreadCount - 1)
        };
      },
      revalidate: false, // Don't auto-revalidate, we're handling it manually
      rollbackOnError: true,
    }
  );

  // Mutation: Mark all notifications as read
  const { trigger: triggerMarkAllAsRead, isMutating: isMarkingAllAsRead } = useSWRMutation(
    `/api/authenticated/notifications/mark-read`,
    mutationFetcher,
    {
      optimisticData: (currentData) => {
        if (!currentData) return currentData;
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
      revalidate: false,
      rollbackOnError: true,
    }
  );

  // Mutation: Dismiss notification
  const { trigger: triggerDismissNotification, isMutating: isDismissing } = useSWRMutation(
    `/api/authenticated/notifications/dismiss`,
    mutationFetcher,
    {
      optimisticData: (currentData, body) => {
        if (!currentData) return currentData;
        const dismissedNotification = currentData.notifications.find(n => n._id === body.id);
        const wasUnread = dismissedNotification && !dismissedNotification.read;

        return {
          ...currentData,
          notifications: currentData.notifications.filter(n => n._id !== body.id),
          unreadCount: wasUnread 
            ? Math.max(0, currentData.unreadCount - 1)
            : currentData.unreadCount
        };
      },
      revalidate: false,
      rollbackOnError: true,
    }
  );

  const markAsRead = useCallback(async (notificationId) => {
    if (isPending || !session?.user || session.user.approved === false) {
      return false;
    }

    try {
      await triggerMarkAsRead({ id: notificationId });
      return true;
    } catch (error) {
      console.error('Error marking notification as read:', error);
      return false;
    }
  }, [isPending, session, triggerMarkAsRead]);

  const markAllAsRead = useCallback(async () => {
    if (isPending || !session?.user || session.user.approved === false) {
      return false;
    }

    try {
      await triggerMarkAllAsRead({ all: true });
      return true;
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
      return false;
    }
  }, [isPending, session, triggerMarkAllAsRead]);

  const dismissNotification = useCallback(async (notificationId) => {
    if (isPending || !session?.user || session.user.approved === false) {
      return false;
    }

    try {
      await triggerDismissNotification({ id: notificationId });
      return true;
    } catch (error) {
      console.error('Error dismissing notification:', error);
      return false;
    }
  }, [isPending, session, triggerDismissNotification]);

  const fetchNotifications = useCallback(async (options = {}) => {
    // With SWR, this is just a revalidation
    await mutate();
  }, [mutate]);

  // Always provide context with appropriate values based on auth status
  const isAuthenticated = !isPending && !!session?.user && session.user.approved !== false;
  const isMutatingAny = isMarkingAsRead || isMarkingAllAsRead || isDismissing;
  
  const contextValue = {
    notifications: isAuthenticated ? notifications : [],
    unreadCount: isAuthenticated ? unreadCount : 0,
    loading: isPending ? true : isLoading,
    mutating: isMutatingAny,
    fetchNotifications: isAuthenticated ? fetchNotifications : async () => {},
    markAsRead: isAuthenticated ? markAsRead : async () => false,
    markAllAsRead: isAuthenticated ? markAllAsRead : async () => false,
    dismissNotification: isAuthenticated ? dismissNotification : async () => false,
    refresh: isAuthenticated ? () => mutate() : () => {}
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
