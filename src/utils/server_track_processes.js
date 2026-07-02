import { getAllServers } from './config'
import { getWebhookIdForServer } from './webhookServer'

// Bound each per-server /processes request so a slow or unreachable server can't
// hang the admin "Active Processes" endpoint. Servers are queried concurrently so
// the slowest one caps the total wait instead of summing across every server.
const PROCESSES_FETCH_TIMEOUT_MS = 8000

async function fetchServerProcesses(server) {
  // Using internalEndpoint for server-to-server requests; falls back to syncEndpoint if unset.
  const endpoint = `${server.internalEndpoint || server.syncEndpoint}/processes`
  try {
    // /processes is webhook-authenticated — without the header it returns 401,
    // so attach the server's webhook ID to receive real process data.
    const webhookId = await getWebhookIdForServer(server.id)
    const response = await fetch(endpoint, {
      headers: webhookId ? { 'x-webhook-id': webhookId } : undefined,
      signal: AbortSignal.timeout(PROCESSES_FETCH_TIMEOUT_MS),
    })

    if (!response.ok) {
      console.error(`Error fetching processes for server ${server.id}: HTTP ${response.status}`)
      return null
    }

    const data = await response.json()
    return { server: server.id, processes: data.data }
  } catch (error) {
    const reason =
      error?.name === 'TimeoutError'
        ? `timed out after ${PROCESSES_FETCH_TIMEOUT_MS}ms`
        : error?.message || String(error)
    console.error(`Error fetching processes for server ${server.id}: ${reason}`)
    return null
  }
}

async function fetchProcesses() {
  const servers = getAllServers()
  const results = await Promise.all(servers.map(fetchServerProcesses))
  return results.filter(Boolean)
}

export { fetchProcesses }
