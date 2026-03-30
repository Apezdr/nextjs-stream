import { withApprovedUser } from '@components/HOC/ApprovedUser';
import NotificationsPageClient from '@src/components/notifications/NotificationsPageClient';

/**
 * Server Component wrapper for the notifications page.
 * Provides auth context and wraps client component with approval check.
 */
async function NotificationsPage() {
  return <NotificationsPageClient />;
}

export default withApprovedUser(NotificationsPage);
