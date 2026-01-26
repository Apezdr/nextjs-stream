import { getAllServers } from './config'

async function fetchProcesses() {
  const servers = getAllServers()
  const processes = []
  for (const server of servers) {
    try {
      // Using internalEndpoint for server-to-server requests; falls back to syncEndpoint if unset.
      const response = await fetch(`${server.internalEndpoint || server.syncEndpoint}/processes`)
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
