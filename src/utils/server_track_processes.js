import { getAllServers } from './config'

/**
 * @param {object} [options]
 * @param {boolean} [options.activeOnly] - only running and queued processes.
 *   A processor that predates ?active=true ignores it and returns every row,
 *   so callers still filter.
 * @param {Object<string, string>} [options.headers] - auth for the processor
 *   (getBackendAuthHeaders). /processes answers 401 without it, and an
 *   unauthenticated poll used to read as "no active processes".
 */
async function fetchProcesses({ activeOnly = false, headers = {} } = {}) {
  const servers = getAllServers()
  const processes = []
  const query = activeOnly ? '?active=true' : ''
  for (const server of servers) {
    try {
      // Using internalEndpoint for server-to-server requests; falls back to syncEndpoint if unset.
      const response = await fetch(`${server.internalEndpoint || server.syncEndpoint}/processes${query}`, { headers })
      if (!response.ok) {
        console.error(`Error fetching processes for server ${server.id}: HTTP ${response.status}`)
        continue
      }
      const data = await response.json()
      processes.push({ server: server.id, processes: data.data })
    } catch (error) {
      console.error(`Error fetching processes for server ${server.id}:`, error)
      //throw error
    }
  }
  return processes
}

export { fetchProcesses }
