import 'server-only'

import { getAllServers, getWebhookIdForServer } from '@src/utils/config'
import { getServersWithDisplayNames } from '@src/utils/serverDisplayNames'

const PROBE_TIMEOUT_MS = 3000
const CACHE_TTL_MS = 30000

let cachedResult = null
let cacheExpiresAt = 0
let inFlight = null

async function probeServer(server, { fetchImpl = fetch, now = performance.now.bind(performance) } = {}) {
  const endpoint = `${server.internalEndpoint || server.syncEndpoint}`.replace(/\/$/, '')
  const webhookId = await getWebhookIdForServer(server.id)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  const startedAt = now()

  try {
    const response = await fetchImpl(`${endpoint}/api/system-status`, {
      method: 'GET',
      headers: webhookId ? { 'X-Webhook-ID': webhookId } : {},
      cache: 'no-store',
      signal: controller.signal,
    })
    // Include response transfer and parsing in the displayed round-trip time;
    // this better represents what sync traffic experiences than headers alone.
    await response.arrayBuffer()
    return {
      serverId: server.id,
      displayName: server.displayName,
      state: response.ok ? 'available' : 'degraded',
      latencyMs: Math.max(0, Math.round(now() - startedAt)),
      httpStatus: response.status,
    }
  } catch (error) {
    return {
      serverId: server.id,
      displayName: server.displayName,
      state: 'unavailable',
      latencyMs: null,
      reason: error?.name === 'AbortError' ? 'timeout' : 'network-error',
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function measureRemoteSyncServerLatencies(
  servers,
  options = {}
) {
  const remoteServers = servers.filter((server) => server.isDefault !== true)
  const results = await Promise.all(remoteServers.map((server) => probeServer(server, options)))
  return {
    state: remoteServers.length === 0 ? 'no-remote-servers' : 'available',
    checkedAt: new Date().toISOString(),
    servers: results,
  }
}

export async function getRemoteSyncServerLatencies({ force = false } = {}) {
  const now = Date.now()
  if (!force && cachedResult && cacheExpiresAt > now) return cachedResult
  if (inFlight) return inFlight

  inFlight = (async () => {
    const configured = getAllServers()
    const decorated = await getServersWithDisplayNames()
    const displayNameById = new Map(decorated.map((server) => [server.id, server.displayName]))
    const result = await measureRemoteSyncServerLatencies(
      configured.map((server) => ({
        ...server,
        displayName: displayNameById.get(server.id) || server.id,
      }))
    )
    cachedResult = result
    cacheExpiresAt = Date.now() + CACHE_TTL_MS
    return result
  })().finally(() => {
    inFlight = null
  })

  return inFlight
}

export function resetRemoteSyncServerLatencyCache() {
  cachedResult = null
  cacheExpiresAt = 0
  inFlight = null
}