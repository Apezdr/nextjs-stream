import { formatServerLabel } from '@src/utils/serverLabel'

/**
 * Render a byte count for the admin table. Binary units, matching what the
 * *arr apps and file managers report for the same file.
 *
 * @param {number|null|undefined} bytes
 * @returns {string}
 */
export function formatFileSize(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return '\u2014'
  const gib = bytes / 1024 ** 3
  if (gib >= 1) return `${gib.toFixed(gib >= 10 ? 1 : 2)} GB`
  const mib = bytes / 1024 ** 2
  return `${mib.toFixed(mib >= 10 ? 0 : 1)} MB`
}

export function getMediaColumnDefinitions(type, hasMultipleServers) {
  const common = [
    { id: 'poster', label: 'Poster', defaultVisible: true },
    { id: 'originalTitle', label: 'Original title', defaultVisible: false },
  ]
  const typeColumns = type === 'tv'
    ? [
        { id: 'years', label: 'Years', defaultVisible: true },
        { id: 'seasons', label: 'Seasons', defaultVisible: true },
        { id: 'episodes', label: 'Episodes', defaultVisible: true },
        { id: 'video', label: 'Video', defaultVisible: false },
        { id: 'hdr', label: 'HDR', defaultVisible: false },
      ]
    : [
        { id: 'year', label: 'Year', defaultVisible: true },
        { id: 'size', label: 'File Size', defaultVisible: true },
        { id: 'video', label: 'Video', defaultVisible: false },
        { id: 'hdr', label: 'HDR', defaultVisible: false },
      ]
  return [
    ...common,
    ...(hasMultipleServers
      ? [{ id: 'server', label: 'Server Name', defaultVisible: true }]
      : []),
    { id: 'quality', label: 'Quality', defaultVisible: true },
    ...typeColumns,
    { id: 'flags', label: 'Flags', defaultVisible: true },
  ]
}

export function getDefaultVisibleColumns(definitions) {
  return definitions.filter(column => column.defaultVisible).map(column => column.id)
}

export function groupMediaByServer(items, servers, enabled) {
  if (!enabled) return [{ key: 'all', label: null, items }]
  const labelById = new Map(servers.map(server => [server.id, server.displayName]))
  const groups = new Map()
  for (const item of items) {
    const ids = [...new Set(item.serverIds || [])]
    const key = ids.length === 0 ? 'unassigned' : ids.length === 1 ? ids[0] : 'multiple'
    const label = key === 'unassigned'
      ? 'Unassigned'
      : key === 'multiple' ? 'Multiple servers' : labelById.get(key) || formatServerLabel(key)
    if (!groups.has(key)) groups.set(key, { key, label, items: [] })
    groups.get(key).items.push(item)
  }
  return [...groups.values()].sort((left, right) => left.label.localeCompare(right.label))
}

export function groupMediaItems(items, groupBy, servers) {
  if (!groupBy) return [{ key: 'all', label: null, items }]
  if (groupBy === 'server') return groupMediaByServer(items, servers, true)

  const groups = new Map()
  for (const item of items) {
    let label = 'Unknown'
    if (groupBy === 'quality') {
      const values = [...new Set(item.qualities || (item.quality ? [item.quality] : []))]
      label = values.length > 1 ? 'Mixed quality' : values[0] || 'Unknown'
    } else if (groupBy === 'year') {
      label = String(item.year || item.years || 'Unknown')
    } else if (groupBy === 'video') {
      label = item.hasVideo ? 'Video available' : 'Video missing'
    } else if (groupBy === 'hdr') {
      const values = [...new Set(item.hdrValues || (item.hdr ? [item.hdr] : []))]
      label = values.length > 1 ? 'Mixed HDR' : values[0] || 'SDR / none'
    }
    if (!groups.has(label)) groups.set(label, { key: `${groupBy}:${label}`, label, items: [] })
    groups.get(label).items.push(item)
  }
  return [...groups.values()].sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true }))
}