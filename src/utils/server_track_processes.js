import { getAllServers } from './config'

/**
 * @param {object} [options]
 * @param {boolean} [options.activeOnly] - only running and queued processes.
 *   A processor that predates ?active=true ignores it and returns every row,
 *   so callers still filter.
 */
async function fetchProcesses({ activeOnly = false } = {}) {
  const servers = getAllServers()
  const processes = []
  const query = activeOnly ? '?active=true' : ''
  for (const server of servers) {
    try {
      // Using internalEndpoint for server-to-server requests; falls back to syncEndpoint if unset.
      const response = await fetch(`${server.internalEndpoint || server.syncEndpoint}/processes${query}`)
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
