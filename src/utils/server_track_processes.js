import { getAllServers } from './config'
import { getWebhookIdForServer } from './webhookServer'

const PROCESSES_FETCH_TIMEOUT_MS = 8000

async function fetchServerProcesses(server) {
  const endpoint = `${server.internalEndpoint || server.syncEndpoint}/processes`

  try {
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
    if (!Array.isArray(data?.data)) {
      console.error(`Error fetching processes for server ${server.id}: invalid response`)
      return null
    }

    return { server: server.id, processes: data.data }
  } catch (error) {
    const reason = error?.name === 'TimeoutError'
      ? `timed out after ${PROCESSES_FETCH_TIMEOUT_MS}ms`
      : error?.message || String(error)
    console.error(`Error fetching processes for server ${server.id}: ${reason}`)
    return null
  }
}

async function fetchProcesses() {
  const results = await Promise.all(getAllServers().map(fetchServerProcesses))
  return results.filter(Boolean)
}

export { fetchProcesses }
