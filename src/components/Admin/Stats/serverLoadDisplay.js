// Shared by the admin server-load panels (EnhancedServerStats on the overview,
// MinimalServerStats in the sidebar).

export const LEVELS = {
  normal: { label: 'Normal', badge: 'success', bar: 'bg-emerald-500', sidebarBar: 'bg-emerald-400' },
  high: { label: 'High', badge: 'warning', bar: 'bg-amber-500', sidebarBar: 'bg-amber-400' },
  critical: { label: 'Critical', badge: 'error', bar: 'bg-red-500', sidebarBar: 'bg-red-400' },
}

/** 'normal' | 'high' | 'critical' for a percentage against a warn/critical pair. */
export function levelFor(percent, { warn, critical }) {
  if (percent >= critical) return 'critical'
  if (percent >= warn) return 'high'
  return 'normal'
}

/** The worst of several levels; null when there are none. */
export function worstLevel(levels) {
  const present = levels.filter(Boolean)
  if (present.length === 0) return null
  if (present.includes('critical')) return 'critical'
  if (present.includes('high')) return 'high'
  return 'normal'
}

const BYTE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1
  return `${value.toFixed(digits)} ${BYTE_UNITS[unit]}`
}

/**
 * Storage as the file servers report it in /api/authenticated/system-status
 * (each server's metrics.disk.drives), graded with the disk thresholds. The
 * app's own container does not mount the media drives, so the file servers
 * are the only place that knows how full they are.
 */
export function storageFromSystemStatus(status, thresholds) {
  const servers = (status?.servers ?? [])
    .map((server) => ({
      serverId: server?.serverId,
      label: server?.serverName || server?.serverId,
      drives: (server?.metrics?.disk?.drives ?? [])
        .map((drive) => ({
          mount: drive?.mount,
          percent: Number.parseFloat(drive?.use),
          available: drive?.available,
          size: drive?.size,
        }))
        .filter((drive) => drive.mount && Number.isFinite(drive.percent)),
    }))
    .filter((server) => server.drives.length > 0)

  let worst = null
  for (const server of servers) {
    for (const drive of server.drives) {
      if (!worst || drive.percent > worst.percent) worst = { ...drive, serverLabel: server.label }
    }
  }
  return { servers, worst, level: worst ? levelFor(worst.percent, thresholds) : null }
}
