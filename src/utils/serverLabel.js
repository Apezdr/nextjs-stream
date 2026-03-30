export function formatServerLabel(serverId) {
  if (serverId === 'default') return 'Default'

  const match = serverId?.match(/^server(\d+)$/i)
  if (match) {
    return `Server ${match[1]}`
  }

  return serverId
}
