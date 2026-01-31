'use server';

import { auth } from '@src/lib/cachedAuth';
import { getProcessedSystemStatus } from '@src/utils/getProcessedSystemStatus';
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
  
  // TEMPORARY DEV MODE: Force show elevated notification for styling
  const DEVELOPMENT_MODE = process.env.NODE_ENV !== 'production';
  
  let statusInfo;
  
  if (DEVELOPMENT_MODE) {
    // Show mock elevated status for styling purposes
    statusInfo = {
      level: 'elevated',
      message: 'System resources are under increased load due to high user activity. Performance monitoring is active.',
      isIncidentActive: true,
      incidentStartedAt: '2026-01-31T02:05:00.000Z', // Static incident time for dev
      serverId: 'server2'
    };
  } else {
    // Normal production logic
    let statusData;
    try {
      statusData = await getProcessedSystemStatus();
    } catch (error) {
      console.error('Error fetching system status in banner:', error);
      return null;
    }
    
    if (!statusData || 
        !statusData.servers || 
        statusData.servers.length === 0) {
      return null;
    }
    
    const worstLevel = statusData.overall?.level || 'normal';
    
    if (worstLevel === 'normal') {
      return null;
    }
    
    const statusLevels = ['normal', 'elevated', 'heavy', 'critical'];
    let incidentServer = null;
    
    for (const server of statusData.servers) {
      if (server.isIncidentActive) {
        if (!incidentServer || 
            statusLevels.indexOf(server.level) > statusLevels.indexOf(incidentServer.level)) {
          incidentServer = server;
        }
      }
    }
    
    const message = statusData.overall?.message || 
      (worstLevel === 'critical' ? 'Critical system load detected. Some features may be unavailable.' :
       worstLevel === 'heavy' ? 'System is experiencing heavy load. Performance may be affected.' :
       'System status unknown.');
    
    statusInfo = {
      level: worstLevel,
      message: incidentServer?.message || message,
      isIncidentActive: !!incidentServer,
      incidentStartedAt: incidentServer?.incidentStartedAt,
      serverId: incidentServer?.serverId
    };
  }
  
  // Pass this data to a client component that handles visibility state
  return <StatusBannerClient status={statusInfo} />;
}
