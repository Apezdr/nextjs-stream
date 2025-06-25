'use client';

import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useNotifications } from '@src/hooks/useNotifications';
import NotificationItem from './NotificationItem';

/**
 * Notification dropdown component
 */
export default function NotificationDropdown({ isOpen, onClose, position }) {
  const router = useRouter();
  
  // Use the new useSWR-based hook for dropdown notifications
  const { 
    notifications, 
    unreadCount, 
    loading, 
    markAllAsRead,
    refresh
  } = useNotifications({ limit: 10 });

  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isOpen) {
      // Refresh notifications when dropdown opens
      refresh();
    }
  }, [isOpen, refresh]);

  const handleMarkAllAsRead = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await markAllAsRead();
  };

  const handleViewAll = (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Navigate to full notifications page using Next.js router
    try {
      router.push('/notifications');
      onClose();
    } catch (error) {
      console.error('Navigation error:', error);
      // Fallback to window.location
      window.location.href = '/notifications';
    }
  };

  const handleDropdownClick = (e) => {
    // Prevent dropdown from closing when clicking inside
    e.stopPropagation();
  };

  const handleNotificationAction = () => {
    // The hook automatically handles cache invalidation through optimistic updates
    // No additional refresh needed
  };

  if (!mounted) return null;

  const dropdownContent = (
    <div
      data-notification-dropdown="true"
      className="fixed z-50 w-80 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 max-h-96 flex flex-col"
      style={{
        top: `${position.top}px`,
        right: `${position.right}px`,
      }}
      onClick={handleDropdownClick}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          Notifications
        </h3>
        <div className="flex items-center space-x-2">
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllAsRead}
              className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
            >
              Mark all read
            </button>
          )}
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            aria-label="Close notifications"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading && notifications.length === 0 ? (
          // Loading state
          <div className="flex items-center justify-center p-8">
            <div className="w-6 h-6 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin"></div>
            <span className="ml-3 text-gray-600 dark:text-gray-400">Loading notifications...</span>
          </div>
        ) : notifications.length === 0 ? (
          // Empty state
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <svg 
              className="w-12 h-12 text-gray-400 mb-4" 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                strokeWidth={1} 
                d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" 
              />
            </svg>
            <h4 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
              No notifications
            </h4>
            <p className="text-gray-600 dark:text-gray-400">
              You're all caught up! Check back later for updates.
            </p>
          </div>
        ) : (
          // Notifications list
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {notifications.map((notification) => (
              <NotificationItem
                key={notification._id}
                notification={notification}
                onClose={handleNotificationAction}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      {notifications.length > 0 && (
        <div className="p-3 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={handleViewAll}
            className="w-full text-center text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium py-2"
          >
            View all notifications
          </button>
        </div>
      )}
    </div>
  );

  return createPortal(dropdownContent, document.body);
}
