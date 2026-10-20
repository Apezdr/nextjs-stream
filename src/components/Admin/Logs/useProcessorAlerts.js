'use client'

import useSWR from 'swr'
import { buildURL } from '@src/utils'

const REFRESH_MS = 60_000

/** Thrown when the processor refused: a server you don't run doesn't share its alerts. */
export class AlertsNotShared extends Error {}

async function fetchAlerts(url) {
  const response = await fetch(url, { cache: 'no-store' })
  const body = await response.json().catch(() => null)
  if (body?.refused) throw new AlertsNotShared(body.error)
  if (!response.ok) throw new Error(body?.error || `Couldn't load alerts (HTTP ${response.status})`)
  return body
}

/**
 * One server's log alerts through /api/authenticated/admin/alerts, refreshed
 * every minute: { processorId, active, recent, checkedAt }.
 */
export function useProcessorAlerts(serverId) {
  return useSWR(
    serverId ? buildURL(`/api/authenticated/admin/alerts?server=${encodeURIComponent(serverId)}`) : null,
    fetchAlerts,
    { refreshInterval: REFRESH_MS, revalidateOnFocus: true, shouldRetryOnError: false }
  )
}

export const SEVERITY_STYLES = {
  critical: { dot: 'bg-red-500', text: 'text-red-700', badge: 'bg-red-50 text-red-700 ring-red-600/20' },
  warning: { dot: 'bg-amber-500', text: 'text-amber-700', badge: 'bg-amber-50 text-amber-800 ring-amber-600/20' },
  info: { dot: 'bg-sky-500', text: 'text-sky-700', badge: 'bg-sky-50 text-sky-700 ring-sky-600/20' },
}

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 }

/** Most severe first, then most recently updated. */
export function sortAlerts(alerts) {
  return [...alerts].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || String(b.updatedAt).localeCompare(String(a.updatedAt))
  )
}
