'use client';

import { useState, useMemo } from 'react';
import { useNotifications } from '@src/hooks/useNotifications';
import NotificationItem from '@src/components/notifications/NotificationItem';

/**
 * Full notifications page with pagination using useSWR
 */
export default function NotificationsPageClient() {
  const [currentPage, setCurrentPage] = useState(1);
  const [filter, setFilter] = useState('all'); // 'all', 'unread', 'read'
  const [category, setCategory] = useState('all'); // 'all', 'sync', 'content', 'system', 'admin'
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);

  // Build query options for the hook
  const queryOptions = useMemo(() => {
    const options = {
      page: currentPage,
      limit: 20
    };

    if (filter === 'unread') {
      options.unreadOnly = true;
    } else if (filter === 'read') {
      options.readOnly = true;
    }

    if (category !== 'all') {
      options.category = category;
    }

    return options;
  }, [currentPage, filter, category]);

  // Use the new useSWR-based hook
  const { 
    notifications,
    unreadCount, 
    totalPages,
    loading,
    validating,
    error,
    markAllAsRead,
    invalidateAll,
    refresh
  } = useNotifications(queryOptions);

  const handleMarkAllAsRead = async () => {
    setIsMarkingAllRead(true);
    try {
      await markAllAsRead();
      // The hook handles optimistic updates automatically
    } catch (error) {
      console.error('Error marking all as read:', error);
    } finally {
      setIsMarkingAllRead(false);
    }
  };

  const handleFilterChange = (newFilter) => {
    setFilter(newFilter);
    setCurrentPage(1); // Reset to first page
  };

  const handleCategoryChange = (newCategory) => {
    setCategory(newCategory);
    setCurrentPage(1); // Reset to first page
  };

  const handlePageChange = (page) => {
    setCurrentPage(page);
  };

  const handleNotificationAction = () => {
    // The hook automatically handles cache invalidation through optimistic updates
    // No need for manual refresh calls
    refresh()
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pt-20">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            Notifications
          </h1>
          <div className="flex items-center justify-between">
            <p className="text-gray-600 dark:text-gray-400">
              {unreadCount > 0 ? `${unreadCount} unread notifications` : 'All notifications are read'}
            </p>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllAsRead}
                disabled={isMarkingAllRead || validating}
                className={`
                  px-4 py-2 rounded-lg transition-all duration-200 font-medium
                  ${isMarkingAllRead || validating
                    ? 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700 text-white shadow-md hover:shadow-lg'
                  }
                `}
              >
                {isMarkingAllRead ? 'Marking...' : 'Mark All Read'}
              </button>
            )}
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 mb-6">
          {/* Status Filter */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Status
            </label>
            <div className="flex gap-2">
              {['all', 'unread', 'read'].map((f) => (
                <button
                  key={f}
                  onClick={() => handleFilterChange(f)}
                  disabled={validating}
                  className={`
                    px-4 py-2 rounded-lg font-medium text-sm transition-all duration-200
                    ${filter === f
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }
                    ${validating ? 'opacity-50 cursor-not-allowed' : ''}
                  `}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Category Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Category
            </label>
            <div className="flex flex-wrap gap-2">
              {['all', 'sync', 'content', 'system', 'admin'].map((cat) => (
                <button
                  key={cat}
                  onClick={() => handleCategoryChange(cat)}
                  disabled={validating}
                  className={`
                    px-4 py-2 rounded-lg font-medium text-sm transition-all duration-200
                    ${category === cat
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }
                    ${validating ? 'opacity-50 cursor-not-allowed' : ''}
                  `}
                >
                  {cat.charAt(0).toUpperCase() + cat.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md">
          {error && (
            <div className="p-6 text-center">
              <p className="text-red-600 dark:text-red-400">
                Error loading notifications: {error.message}
              </p>
              <button
                onClick={() => refresh()}
                className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                Try Again
              </button>
            </div>
          )}

          {loading ? (
            <div className="p-6">
              <div className="flex justify-center items-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                <span className="ml-3 text-gray-600 dark:text-gray-400">Loading notifications...</span>
              </div>
            </div>
          ) : (
            <>
              {notifications.length === 0 ? (
                <div className="p-8 text-center">
                  <p className="text-gray-500 dark:text-gray-400 text-lg">
                    No notifications found
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-gray-200 dark:divide-gray-700">
                  {notifications.map((notification) => (
                    <NotificationItem
                      key={notification._id}
                      notification={notification}
                      onAction={handleNotificationAction}
                    />
                  ))}
                </div>
              )}

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="p-4 border-t border-gray-200 dark:border-gray-700">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Page {currentPage} of {totalPages}
                      {validating && <span className="ml-2 text-blue-600 dark:text-blue-400">(updating...)</span>}
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handlePageChange(currentPage - 1)}
                        disabled={currentPage === 1 || validating}
                        className="px-3 py-1 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-200 dark:hover:bg-gray-600"
                      >
                        Previous
                      </button>
                      <button
                        onClick={() => handlePageChange(currentPage + 1)}
                        disabled={currentPage === totalPages || validating}
                        className="px-3 py-1 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-200 dark:hover:bg-gray-600"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
