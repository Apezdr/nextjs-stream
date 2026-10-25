import { getChromeSession } from '@src/lib/cachedAuth';
import TVAppsNotificationClient from './TVAppsNotificationClient';

/**
 * Server component that checks if user has dismissed TV apps notification
 */
export default async function TVAppsNotification() {
  // The prefetchable session read (getChromeSession): the notice is chrome
  const session = await getChromeSession();

  // Don't show if user is not authenticated
  if (!session?.id) {
    return null;
  }

  // Don't show if user is not approved
  if (!session.approved) {
    return null;
  }

  // Check if user has dismissed the TV apps notification using session data
  // This avoids an extra database call since preferences are now included in the session
  if (session.tvAppsNotificationDismissed) {
    return null;
  }

  // Return the client component that handles dismiss functionality
  return <TVAppsNotificationClient />;
}
