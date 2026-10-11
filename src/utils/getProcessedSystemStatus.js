import { getAllServers, getWebhookIdForServer } from '@src/utils/config'
import { httpGet } from '@src/lib/httpHelper'
import { getLatestSystemStatus, getSystemStatusMessage } from '@src/utils/admin_utils'
import { formatServerLabel } from '@src/utils/serverLabel'

const SERVER_ENDPOINT = '/api/system-status'
const DEFAULTS = {
  GLOBAL_TIMEOUT: 5000, // ms
  SERVER_TIMEOUT: 2000, // ms per-server
  HTTP_GET: {
    timeout: 1500,
    http2: true,
    retry: { limit: 2, baseDelay: 200 },
  },
  // The result is the same for every user, and each computation probes every
  // file server and reads Mongo. Every signed-in tab polls system-status
  // every 30 s and the (styled) layout's banner calls this on every render,
  // so one computation serves all of them for this long.
  CACHE_TTL: 15_000, // ms
}

/**
 * Worst-level ranking. `unknown` (a file server that did not answer) sits
 * above `normal` but below every load level, which is how StatusBannerClient
 * already ranks it: a load level on any server names that server, and only
 * when there is none does `unknown` become the overall level.
 */
const LEVELS = ['normal', 'unknown', 'elevated', 'heavy', 'critical']

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
    // Every signed-in user sees this, so it stays the neutral id-derived label
    // ("Server 2"), never the operator's SERVER_DISPLAY_NAME.
    serverName: formatServerLabel(server.id),
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
  return settled.map((r, i) => {
    if (r.status === 'fulfilled') return r.value
    // Every signed-in user receives this list, and a transport error can name
    // the internal endpoint (host and port). The reason stays in the log.
    console.warn(`System status: ${servers[i].id} did not answer:`, r.reason?.message)
    return buildStatus(servers[i], null, {}, 'Server unreachable')
  })
}

async function fetchOneStatus(server) {
  const webhookId = await getWebhookIdForServer(server.id)
  const headers = webhookId ? { 'X-Webhook-ID': webhookId } : {}
  const endpoint = `${server.internalEndpoint || server.syncEndpoint}${SERVER_ENDPOINT}`
  const useHttp2 = endpoint.startsWith('https://')

  // Using internalEndpoint for server-to-server requests; falls back to syncEndpoint if unset.
  const { data, headers: resp } = await httpGet(
    endpoint,
    { ...DEFAULTS.HTTP_GET, headers, http2: useHttp2 },
    true // allow 304 caching
  )

  // Normalize the response data structure to handle both cached and fresh responses
  const responseData = data?.data || data

  return buildStatus(server, responseData, resp)
}

let cachedStatus = null // { value, expiresAt }
let inFlight = null

/**
 * Gets processed system status with proper incident handling
 * This function encapsulates the logic from the API route for reuse.
 * Cached for DEFAULTS.CACHE_TTL; callers arriving while it is computed share
 * that computation.
 * @returns {Promise<Object>} Processed system status data
 */
export async function getProcessedSystemStatus() {
  if (cachedStatus && Date.now() < cachedStatus.expiresAt) return cachedStatus.value
  if (!inFlight) {
    inFlight = computeProcessedSystemStatus()
      .then((value) => {
        cachedStatus = { value, expiresAt: Date.now() + DEFAULTS.CACHE_TTL }
        return value
      })
      .finally(() => {
        inFlight = null
      })
  }
  return inFlight
}

async function computeProcessedSystemStatus() {
  const servers = getAllServers()

  const normalizeServerStatusList = (serversValue) => {
    if (Array.isArray(serversValue)) return serversValue
    if (serversValue && typeof serversValue === 'object') {
      return Object.entries(serversValue).map(([serverId, status]) => ({
        ...status,
        serverId: status?.serverId ?? serverId,
      }))
    }
    return []
  }

  const normalizeIncidents = (incidentsValue) =>
    Array.isArray(incidentsValue) ? incidentsValue : []

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
        // No active incident: the file server's own status. A server that did
        // not answer has no status, and buildStatus already marked it
        // 'unknown' — keep that rather than reporting it as healthy.
        processedServer = {
          ...processedServer,
          level: serverStatus.status || serverStatus.level || 'unknown',
          isIncidentActive: false,
        }
      }
      
      return processedServer
    })

    // Also check database for any additional incidents (backward compatibility)
    const latestStatus = await getLatestSystemStatus()
    const dbIncidents = normalizeIncidents(
      latestStatus.normalizedActiveIncidents ?? latestStatus.activeIncidents
    ).filter((i) => !i.resolvedAt)
    
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

    // Pick the worst level (see LEVELS for where 'unknown' ranks)
    const worst = merged.reduce(
      (w, s) => (LEVELS.indexOf(s.level || 'normal') > LEVELS.indexOf(w) ? s.level : w),
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
    const latestStatus = await getLatestSystemStatus()
    const latest = normalizeServerStatusList(latestStatus.normalizedServers ?? latestStatus.servers)
    const incidents = normalizeIncidents(
      latestStatus.normalizedActiveIncidents ?? latestStatus.activeIncidents
    ).filter((i) => !i.resolvedAt)

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