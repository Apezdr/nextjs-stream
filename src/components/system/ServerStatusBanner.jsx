'use server';

import { auth } from '@src/lib/auth';
import { getLatestSystemStatus } from '@src/utils/admin_utils';
import StatusBannerClient from './StatusBannerClient';

/**
 * Server component that fetches system status and renders the banner
 * Only renders for authenticated users when there's a non-normal status
 */
export default async function ServerStatusBanner() {
  // Check authentication on server side
  const session = await auth();
  
  // Only show for authenticated users
  if (!session || !session.user) {
    return null;
  }
  
  // Get latest status from database
  const latestStatus = await getLatestSystemStatus();
  
  // If no status data or everything is normal, don't render anything
  if (!latestStatus || 
      !latestStatus.servers || 
      Object.keys(latestStatus.servers).length === 0) {
    return null;
  }
  
  // Determine worst status level across all servers
  const statusLevels = ['normal', 'heavy', 'critical'];
  let worstLevel = 'normal';
  let incidentServer = null;
  
  // Extract active incidents
  const currentIncidents = latestStatus.activeIncidents?.filter(
    incident => !incident.resolvedAt
  ) || [];
  
  // Check if any active incidents are still within display period
  const now = new Date();
  const activeIncidents = currentIncidents.filter(incident => 
    new Date(incident.minDisplayUntil) > now
  );
  
  // If we have active incidents, use their status
  if (activeIncidents.length > 0) {
    // Find the most severe incident
    for (const incident of activeIncidents) {
      const incidentLevelIndex = statusLevels.indexOf(incident.level);
      const worstLevelIndex = statusLevels.indexOf(worstLevel);
      
      if (incidentLevelIndex > worstLevelIndex) {
        worstLevel = incident.level;
        incidentServer = incident;
      }
    }
  } else {
    // Otherwise check server statuses
    for (const [serverId, serverStatus] of Object.entries(latestStatus.servers)) {
      const serverLevel = serverStatus.level || 'normal';
      const serverLevelIndex = statusLevels.indexOf(serverLevel);
      const worstLevelIndex = statusLevels.indexOf(worstLevel);
      
      if (serverLevelIndex > worstLevelIndex) {
        worstLevel = serverLevel;
      }
    }
  }
  
  // If everything is normal, don't render
  if (worstLevel === 'normal') {
    return null;
  }
  
  // Prepare status message
  let message = '';
  if (worstLevel === 'critical') {
    message = 'Critical system load detected. Some features may be unavailable.';
  } else if (worstLevel === 'heavy') {
    message = 'System is experiencing heavy load. Performance may be affected.';
  }
  
  // Include incident information if applicable
  const statusInfo = {
    level: worstLevel,
    message: incidentServer?.message || message,
    isIncidentActive: !!incidentServer,
    incidentStartedAt: incidentServer?.startedAt,
    serverId: incidentServer?.serverId
  };
  
  // Pass this data to a client component that handles visibility state
  return <StatusBannerClient status={statusInfo} />;
}
