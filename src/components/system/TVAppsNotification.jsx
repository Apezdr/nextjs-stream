import { auth } from '@src/lib/cachedAuth';
import TVAppsNotificationClient from './TVAppsNotificationClient';

/**
 * Server component that checks if user has dismissed TV apps notification
 */
export default async function TVAppsNotification() {
  const session = await auth();
  
  // Don't show if user is not authenticated
  if (!session?.user?.id) {
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
