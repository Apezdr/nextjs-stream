export function formatServerLabel(serverId) {
  if (serverId === 'default') return 'Default'

  const match = serverId?.match(/^server(\d+)$/i)
  if (match) {
    return `Server ${match[1]}`
  }

  return serverId
}

export const SERVER_DISPLAY_NAME_MAX_LENGTH = 60

function isUnsafeLabelCharacter(character) {
  const code = character.charCodeAt(0)
  return code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
}

export function normalizeServerDisplayName(value) {
  if (typeof value !== 'string') return ''

  // Deployment and persisted values bypass the form validator, so normalize
  // controls and bidi formatting before any label reaches the Admin UI.
  return Array.from(value, (character) => isUnsafeLabelCharacter(character) ? ' ' : character)
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SERVER_DISPLAY_NAME_MAX_LENGTH)
}
