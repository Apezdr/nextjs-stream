import { Suspense } from 'react';
import { withApprovedUser } from '@components/HOC/ApprovedUser';
import NotificationsPageClient from '@src/components/notifications/NotificationsPageClient';

/**
 * Server Component wrapper for the notifications page.
 * Provides auth context and wraps client component with approval check.
 */
async function NotificationsPage() {
  return <NotificationsPageClient />;
}

// The same approval check as before, unchanged. It now runs INSIDE a Suspense
// boundary instead of at the top of the page: whatever a page awaits at its
// top is absent from the route's prerendered shell, which left this route with
// an empty one.
const ApprovedNotifications = withApprovedUser(NotificationsPage);

/**
 * The page's frame and heading with nothing in it yet. Mirrors the outer markup
 * of NotificationsPageClient; change the two together.
 */
function NotificationsPageSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading notifications"
      className="min-h-screen bg-gray-50 dark:bg-gray-900 pt-20"
    >
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Notifications</h1>
          <div className="h-5 w-48 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
        </div>
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-lg bg-gray-200 dark:bg-gray-800 animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function NotificationsRoute() {
  return (
    <Suspense fallback={<NotificationsPageSkeleton />}>
      <ApprovedNotifications />
    </Suspense>
  );
}
