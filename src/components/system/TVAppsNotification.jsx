import { getSession } from '@src/lib/cachedAuth';
import TVAppsNotificationClient from './TVAppsNotificationClient';

/**
 * Server component that checks if user has dismissed TV apps notification
 */
export default async function TVAppsNotification() {
  const session = await getSession();
  
  // Don't show if user is not authenticated
  if (!session?.user?.id) {
    return null;
  }

  // Don't show if user is not approved
  if (session.user.approved === false) {
    return null;
  }

  // Check if user has dismissed the TV apps notification using session data
  // This avoids an extra database call since preferences are now included in the session
  if (session.user.preferences?.tvAppsNotificationDismissed) {
    return null;
  }

  // Return the client component that handles dismiss functionality
  return <TVAppsNotificationClient />;
}
