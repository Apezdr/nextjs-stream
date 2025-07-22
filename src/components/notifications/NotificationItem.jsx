'use client';

import { useState } from 'react';
import { useNotifications } from '@src/hooks/useNotifications';
import { getNotificationIcon, getNotificationColor } from '@src/utils/notifications/NotificationTypes';
import { useSession } from 'next-auth/react';
import { classNames } from '@src/utils';
import { useRouter } from 'next/navigation';

/**
 * Individual notification item component
 */
export default function NotificationItem({ notification, onClose }) {
  // Use the new useSWR-based hooks for actions
  const { markAsRead, dismissNotification } = useNotifications();
  const { data: session } = useSession();
  const [isDismissing, setIsDismissing] = useState(false);
  const [isMarkingAsRead, setIsMarkingAsRead] = useState(false);
  const router = useRouter();

  const handleClick = async () => {
    // Mark as read if unread
    if (!notification.read) {
      await markAsRead(notification._id);
    }

    // Navigate to action URL if available
    if (notification.data?.actionUrl || notification.actionUrl) {
      router.push(notification.data.actionUrl || notification.actionUrl);
    }

    // Close dropdown/notify parent
    onClose();
  };

  const handleMarkAsRead = async (e) => {
    e.stopPropagation(); // Prevent triggering the main click handler
    
    if (isMarkingAsRead) return; // Prevent double-clicks
    
    setIsMarkingAsRead(true);
    try {
      await markAsRead(notification._id);
      // The hook handles optimistic updates automatically - no manual refresh needed
    } finally {
      setIsMarkingAsRead(false);
    }
  };

  const handleDismiss = async (e) => {
    e.stopPropagation(); // Prevent triggering the main click handler
    
    if (isDismissing) return; // Prevent double-clicks
    
    setIsDismissing(true);
    try {
      await dismissNotification(notification._id);
      // The hook handles optimistic updates automatically - no manual refresh needed
    } finally {
      setIsDismissing(false);
    }
  };

  const formatTimeAgo = (date) => {
    const now = new Date();
    const createdAt = new Date(date);
    const diffInSeconds = Math.floor((now - createdAt) / 1000);

    if (diffInSeconds < 60) {
      return 'Just now';
    } else if (diffInSeconds < 3600) {
      const minutes = Math.floor(diffInSeconds / 60);
      return `${minutes}m ago`;
    } else if (diffInSeconds < 86400) {
      const hours = Math.floor(diffInSeconds / 3600);
      return `${hours}h ago`;
    } else if (diffInSeconds < 604800) {
      const days = Math.floor(diffInSeconds / 86400);
      return `${days}d ago`;
    } else {
      return createdAt.toLocaleDateString();
    }
  };

  // Check if this is an admin-only notification
  const isAdminNotification = notification.adminOnly || 
    notification.category === 'admin' || 
    notification.type === 'admin_message' ||
    notification.type === 'sync_complete';

  // Check if current user is admin (basic check)
  const isUserAdmin = session?.user?.role === 'admin' || session?.user?.isAdmin;

  const colorClasses = getNotificationColor(notification.priority);
  const icon = getNotificationIcon(notification.type);

  return (
    <div
      className={`
        group p-4 cursor-pointer transition-colors duration-150 relative
        ${notification.read 
          ? 'bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700' 
          : 'bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30'
        }
        ${isDismissing ? 'opacity-60' : ''}
      `}
      onClick={handleClick}
    >
      {/* Loading overlay for dismissing */}
      {isDismissing && (
        <div className="absolute inset-0 bg-white/50 dark:bg-gray-900/50 flex items-center justify-center z-10 rounded-md">
          <div className="flex items-center space-x-2 text-gray-600 dark:text-gray-400">
            <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span className="text-sm">Dismissing...</span>
          </div>
        </div>
      )}

      <div className="flex items-start space-x-3">
        {/* Icon */}
        <div className={`
          flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm
          ${notification.read ? 'bg-gray-100 dark:bg-gray-700' : colorClasses}
        `}>
          <span>{icon}</span>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 pr-12">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <p className={`
                  text-sm font-medium truncate
                  ${notification.read 
                    ? 'text-gray-900 dark:text-gray-100' 
                    : 'text-gray-900 dark:text-white'
                  }
                `}>
                  {notification.title}
                </p>
                
                {/* Admin Badge */}
                {isAdminNotification && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400 border border-purple-200 dark:border-purple-800">
                    <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    ADMIN
                  </span>
                )}
              </div>
              
              <p className={`
                text-sm mt-1 line-clamp-2
                ${notification.read 
                  ? 'text-gray-600 dark:text-gray-400' 
                  : 'text-gray-700 dark:text-gray-300'
                }
              `}>
                {notification.message}
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between mt-2">
            <span className={classNames(
              `text-xs`,
              notification.read 
                ? 'text-gray-500 dark:text-gray-500' 
                : 'text-gray-600 dark:text-gray-400'  
            )}>
              {formatTimeAgo(notification.createdAt)}
            </span>

            {/* Priority badge for high/urgent notifications */}
            {(notification.priority === 'high' || notification.priority === 'urgent') && (
              <span className={`
                inline-flex items-center px-2 py-1 rounded-full text-xs font-medium
                ${notification.priority === 'urgent' 
                  ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                  : 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400'
                }
              `}>
                {notification.priority}
              </span>
            )}

            {/* Unread indicator */}
            {!notification.read && (
              <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
            )}
          </div>
        </div>
      </div>

      {/* Action Buttons - Fixed positioning in top-right */}
      <div className="absolute top-2 right-2 flex items-center space-x-1">
        {/* Mark as Read Button */}
        {!notification.read && (
          <button
            onClick={handleMarkAsRead}
            disabled={isMarkingAsRead || isDismissing}
            className={`
              p-1.5 rounded-md transition-colors
              ${isMarkingAsRead 
                ? 'text-blue-400 cursor-not-allowed' 
                : 'text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/20'
              }
            `}
            aria-label="Mark as read"
            title="Mark as read"
          >
            {isMarkingAsRead ? (
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            )}
          </button>
        )}

        {/* Dismiss Button */}
        <button
          onClick={handleDismiss}
          disabled={isDismissing || isMarkingAsRead}
          className={`
            p-1.5 rounded-md transition-colors
            ${isDismissing 
              ? 'text-gray-400 cursor-not-allowed' 
              : 'text-gray-400 hover:text-red-600 dark:text-gray-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20'
            }
          `}
          aria-label="Dismiss notification"
          title="Dismiss notification"
        >
          {isDismissing ? (
            <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
