import 'server-only'
import { getAllServers } from '@src/utils/config'
import { ServerDisplayNameManager } from '@src/utils/admin_database'
import { formatServerLabel, normalizeServerDisplayName } from '@src/utils/serverLabel'

export function applyServerDisplayNames(servers, displayNames = {}) {
  return servers.map((server) => {
    const environmentName = normalizeServerDisplayName(server.environmentDisplayName)
    const storedName = normalizeServerDisplayName(displayNames[server.id])
    const displayName = environmentName || storedName || formatServerLabel(server.id)

    return {
      ...server,
      // These fields are presentation-only; id remains the protocol/database key.
      displayName,
      displayNameOverride: storedName,
      displayNameSource: environmentName ? 'environment' : storedName ? 'database' : 'derived',
      displayNameEditable: !environmentName,
    }
  })
}

export async function getServersWithDisplayNames() {
  const manager = new ServerDisplayNameManager()
  const displayNames = await manager.getServerDisplayNames()
  return applyServerDisplayNames(getAllServers(), displayNames)
}