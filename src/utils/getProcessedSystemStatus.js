import { getAllServers, getWebhookIdForServer } from '@src/utils/config'
import { httpGet } from '@src/lib/httpHelper'
import { getLatestSystemStatus, getSystemStatusMessage } from '@src/utils/admin_utils'

const SERVER_ENDPOINT = '/api/system-status'
const DEFAULTS = {
  GLOBAL_TIMEOUT: 5000, // ms
  SERVER_TIMEOUT: 2000, // ms per-server
  HTTP_GET: {
    timeout: 1500,
    http2: true,
    retry: { limit: 2, baseDelay: 200 },
  },
}

/** Wrap any promise to reject after ms with the given message */
function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(message)), ms)),
  ])
}

/**
 * Build a uniform status object.
 * If data is null or error is set, returns an 'unknown' status.
 */
function buildStatus(server, data = null, headers = {}, error = null) {
  const base = {
    serverId: server.id,
    serverName: server.name ?? server.id,
    lastUpdated: headers['last-modified'] ?? new Date().toISOString(),
  }

  if (error) {
    return { ...base, level: 'unknown', message: error, error }
  }
  if (!data) {
    return { ...base, level: 'unknown', message: 'Status information not available' }
  }

  const result = { ...base, ...data, etag: headers.etag ?? null }
  return result
}

async function fetchAllStatuses(servers) {
  const tasks = servers.map((server) =>
    withTimeout(fetchOneStatus(server), DEFAULTS.SERVER_TIMEOUT, 'Server timeout')
  )
  const settled = await Promise.allSettled(tasks)
  return settled.map((r, i) =>
    r.status === 'fulfilled' ? r.value : buildStatus(servers[i], null, {}, r.reason.message)
  )
}

async function fetchOneStatus(server) {
  const webhookId = await getWebhookIdForServer(server.id)
  const headers = webhookId ? { 'X-Webhook-ID': webhookId } : {}

  // Using internalEndpoint for server-to-server requests; falls back to syncEndpoint if unset.
  const { data, headers: resp } = await httpGet(
    `${server.internalEndpoint || server.syncEndpoint}${SERVER_ENDPOINT}`,
    { ...DEFAULTS.HTTP_GET, headers },
    true // allow 304 caching
  )

  // Normalize the response data structure to handle both cached and fresh responses
  const responseData = data?.data || data

  return buildStatus(server, responseData, resp)
}

/**
 * Gets processed system status with proper incident handling
 * This function encapsulates the logic from the API route for reuse
 * @returns {Promise<Object>} Processed system status data
 */
export async function getProcessedSystemStatus() {
  const servers = getAllServers()

  try {
    // Fetch all server statuses in parallel
    const statuses = await withTimeout(
      fetchAllStatuses(servers),
      DEFAULTS.GLOBAL_TIMEOUT,
      'Global operation timeout'
    )

    // Process each server status and handle embedded incidents
    const processed = statuses.map((serverStatus) => {
      // Start with the base server status
      let processedServer = { ...serverStatus }
      
      // Check if server has an embedded incident
      if (serverStatus.incident && !serverStatus.incident.resolvedAt) {
        // If incident exists and isn't resolved, merge incident data into server level
        processedServer = {
          ...processedServer,
          level: serverStatus.status, // Use status as level for incident servers
          message: serverStatus.incident.message || serverStatus.message,
          isIncidentActive: true,
          incidentStartedAt: serverStatus.incident.startTime,
          minDisplayUntil: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 minutes from now
        }
      } else {
        // No active incident, use normal server status
        processedServer = {
          ...processedServer,
          level: serverStatus.status || 'normal',
          isIncidentActive: false,
        }
      }
      
      return processedServer
    })

    // Also check database for any additional incidents (backward compatibility)
    const { activeIncidents = [] } = await getLatestSystemStatus()
    const dbIncidents = activeIncidents.filter((i) => !i.resolvedAt)
    
    // Merge any database incidents that aren't already handled by embedded incidents
    const merged = processed.map((serverStatus) => {
      // Skip if server already has an active incident
      if (serverStatus.isIncidentActive) {
        return serverStatus
      }
      
      // Check for database incident for this server
      const dbIncident = dbIncidents.find((inc) => 
        inc.serverId === serverStatus.serverId && 
        new Date(inc.minDisplayUntil) > new Date()
      )
      
      if (dbIncident) {
        return {
          ...serverStatus,
          level: dbIncident.level,
          message: dbIncident.message,
          isIncidentActive: true,
          incidentStartedAt: dbIncident.startedAt,
          minDisplayUntil: dbIncident.minDisplayUntil,
        }
      }
      
      return serverStatus
    })

    // Pick the worst level - include all possible status levels
    const levels = ['normal', 'elevated', 'heavy', 'critical']
    const worst = merged.reduce(
      (w, s) => (levels.indexOf(s.level || 'normal') > levels.indexOf(w) ? s.level : w),
      'normal'
    )
    
    // Count active incidents across all sources
    const activeIncidentCount = merged.filter(s => s.isIncidentActive).length

    return {
      overall: {
        level: worst,
        message: getSystemStatusMessage(worst, merged),
        updatedAt: new Date().toISOString(),
      },
      servers: merged,
      hasActiveIncidents: activeIncidentCount > 0,
    }

  } catch (err) {
    console.error('Error getting processed system status:', err)
    
    // Fallback response
    const { servers: latest = [], activeIncidents = [] } = await getLatestSystemStatus()
    const incidents = activeIncidents.filter((i) => !i.resolvedAt)

    const fallback = servers.map((s) => {
      const cached = latest.find((l) => l.serverId === s.id)
      return cached ?? buildStatus(s, null, {}, 'Global timeout')
    })

    return {
      overall: {
        level: 'unknown',
        message: 'System status temporarily unavailable',
        updatedAt: new Date().toISOString(),
      },
      servers: fallback,
      hasActiveIncidents: incidents.length > 0,
    }
  }
}