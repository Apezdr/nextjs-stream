"use server";

import { getAllServers, getWebhookIdForServer } from '@src/utils/config';
import { httpGet } from '@src/lib/httpHelper';
import { getLatestSystemStatus, getSystemStatusMessage } from '@src/utils/admin_utils';
import isAuthenticated from '@src/utils/routeAuth';

/**
 * Generates an ETag for the combined response
 * @param {Object} response - The response object
 * @returns {string} - ETag string
 */
function generateETag(response) {
  // Simple hash function for generating ETags
  const str = JSON.stringify(response);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return `"${hash.toString(36)}"`;
}

export async function GET(request) {
  // Authenticate the request
  const authResult = await isAuthenticated(request);
  if (authResult instanceof Response) {
    return authResult;
  }

  // Check for If-None-Match header for conditional requests
  const etag = request.headers.get('If-None-Match');

  // Get all configured servers
  const servers = getAllServers();
  
  // Request status from each server in parallel, using httpGet with etag support
  const statusPromises = servers.map(async (server) => {
    try {
      // Prepare headers with webhook ID for authentication
      const headers = {};
      const webhookId = await getWebhookIdForServer(server.id);
      if (webhookId) {
        headers['X-Webhook-ID'] = webhookId;
      }
      
      // Use httpGet with etag support and enable returning cached data
      const { data, headers: responseHeaders } = await httpGet(
        `${server.syncEndpoint}/api/system-status`, 
        { 
          headers,
          timeout: 3000, // Short timeout to prevent hanging
          http2: true,   // Enable HTTP/2 for better performance
          retry: {
            limit: 2,    // Limit retries to reduce wait time on failures
            baseDelay: 500 // Faster initial retry
          }
        }, 
        true // Return cached data when 304 Not Modified is received
      );
      
      // If no cached data (or fresh data) was available), return unknown status
      if (!data) {
        return {
          serverId: server.id,
          serverName: server.name || server.id,
          level: 'unknown',
          message: 'Status information not available',
          lastUpdated: responseHeaders['last-modified'] || new Date().toISOString()
        };
      }
      
      // Return the status with server info
      return {
        serverId: server.id,
        serverName: server.name || server.id,
        ...data,
        lastUpdated: responseHeaders['last-modified'] || new Date().toISOString(),
        etag: responseHeaders.etag || null
      };
    } catch (error) {
      console.error(`Error fetching status for server ${server.id}:`, error);
      
      // Return unknown status for this server
      return {
        serverId: server.id,
        serverName: server.name || server.id,
        level: 'unknown',
        message: `Could not retrieve status: ${error.message}`,
        error: error.message
      };
    }
  });
  
  // Wait for all requests to complete
  const realTimeStatuses = await Promise.all(statusPromises);
  
  // Get the latest stored status data from the database including active incidents
  const { servers: latestServers, activeIncidents = [] } = await getLatestSystemStatus();

  // Filter to only active incidents
  const currentIncidents = activeIncidents?.filter(incident => !incident.resolvedAt) || [];

  // Merge real-time status with incident data - prioritize incidents
  const mergedStatuses = realTimeStatuses.map(serverStatus => {
    // Check if there's an active incident for this server
    const incident = currentIncidents.find(inc => inc.serverId === serverStatus.serverId);
    
    // If there's an active incident and it hasn't expired, use that status
    if (incident && new Date(incident.minDisplayUntil) > new Date()) {
      return {
        ...serverStatus,
        level: incident.level, // Override with incident level
        message: incident.message, // Override with incident message
        isIncidentActive: true,
        incidentStartedAt: incident.startedAt,
        minDisplayUntil: incident.minDisplayUntil
      };
    }
    
    // Otherwise use the real-time status
    return serverStatus;
  });

  // Determine the worst overall status level
  const statusLevels = ['normal', 'heavy', 'critical'];
  const worstLevel = mergedStatuses.reduce((worst, current) => {
    if (!current.level || !statusLevels.includes(current.level)) return worst;
    const currentIndex = statusLevels.indexOf(current.level);
    const worstIndex = statusLevels.indexOf(worst);
    return currentIndex > worstIndex ? current.level : worst;
  }, 'normal');
  
  // Prepare the consolidated response
  const response = {
    overall: {
      level: worstLevel,
      message: getSystemStatusMessage(worstLevel, mergedStatuses),
      updatedAt: new Date().toISOString()
    },
    servers: mergedStatuses,
    hasActiveIncidents: currentIncidents.length > 0
  };

  // Generate ETag for the response
  const responseETag = generateETag(response);
  
  // If ETag matches, return 304 Not Modified
  if (etag && etag === responseETag) {
    return new Response(null, {
      status: 304,
      headers: {
        'Cache-Control': 'private, must-revalidate, max-age=30',
        'ETag': responseETag
      }
    });
  }

  // Set cache control headers to allow client-side caching but require revalidation
  return new Response(JSON.stringify(response), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, must-revalidate, max-age=30', // 30-second cache
      'ETag': responseETag
    }
  });
}
