'use client'

import Link from 'next/link'
import useSWR from 'swr'
import { buildURL } from '@src/utils'
import { formatServerLabel } from '@src/utils/serverLabel'
import { AlertsNotShared, SEVERITY_STYLES, sortAlerts, useProcessorAlerts } from './Logs/useProcessorAlerts'
import { MaterialCard, MaterialCardHeader, MaterialCardContent } from './BaseComponents'

const NO_SERVERS = Object.freeze([])
const SHOWN_PER_SERVER = 3

async function fetchServers(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Couldn't load the server list (HTTP ${response.status})`)
  return response.json()
}

/** "Healthy", "2 critical, 1 warning" … from a server's firing alerts. */
function statusOf({ data, error }) {
  if (error instanceof AlertsNotShared) return { label: 'Not shared', tone: 'bg-gray-100 text-gray-600 ring-gray-500/20' }
  if (error) return { label: 'Unavailable', tone: 'bg-gray-100 text-gray-600 ring-gray-500/20', detail: error.message }
  if (!data) return { label: 'Checking…', tone: 'bg-gray-50 text-gray-500 ring-gray-500/10' }
  const counts = { critical: 0, warning: 0, info: 0 }
  for (const alert of data.active) if (!alert.muted) counts[alert.severity] += 1
  if (counts.critical) return { label: `${counts.critical} critical${counts.warning ? `, ${counts.warning} warning` : ''}`, tone: SEVERITY_STYLES.critical.badge }
  if (counts.warning) return { label: `${counts.warning} warning${counts.warning === 1 ? '' : 's'}`, tone: SEVERITY_STYLES.warning.badge }
  return { label: 'Healthy', tone: 'bg-green-50 text-green-700 ring-green-600/20' }
}

function ServerAlerts({ server }) {
  const alerts = useProcessorAlerts(server.id)
  const status = statusOf(alerts)
  const active = sortAlerts(alerts.data?.active ?? [])
  const label = server.displayName || formatServerLabel(server.id)

  return (
    <li className="px-6 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="font-medium text-gray-900">{label}</span>
          <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${status.tone}`} title={status.detail}>
            {status.label}
          </span>
        </div>
        {!alerts.error && (
          <Link href={`/admin/logs?server=${encodeURIComponent(server.id)}`} className="text-sm font-medium text-indigo-600 hover:text-indigo-500">
            Open logs
          </Link>
        )}
      </div>
      {active.length > 0 && (
        <ul className="mt-2 space-y-1">
          {active.slice(0, SHOWN_PER_SERVER).map((alert) => (
            <li key={alert.key} className="flex items-start gap-2 text-sm text-gray-700">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${(SEVERITY_STYLES[alert.severity] ?? SEVERITY_STYLES.info).dot}`} aria-hidden="true" />
              <span className="min-w-0 break-words">{alert.title}</span>
            </li>
          ))}
          {active.length > SHOWN_PER_SERVER && (
            <li className="pl-4 text-xs text-gray-500">and {active.length - SHOWN_PER_SERVER} more</li>
          )}
        </ul>
      )}
    </li>
  )
}

/**
 * The admin dashboard's view of each media processor's log alerts: what its
 * own log has been warning about, from the processor's own alert manager.
 * Servers you don't run don't share theirs ("Not shared").
 */
export default function ProcessorAlertsCard() {
  const { data: servers = NO_SERVERS } = useSWR(buildURL('/api/authenticated/admin/servers'), fetchServers, {
    revalidateOnFocus: false,
  })

  return (
    <MaterialCard elevation="medium" className="h-fit">
      <MaterialCardHeader
        title="Log alerts"
        subtitle="What each server's own log is warning about"
        icon={
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
        }
      />
      <MaterialCardContent padding="none">
        <ul className="divide-y divide-gray-100">
          {servers.map((server) => (
            <ServerAlerts key={server.id} server={server} />
          ))}
        </ul>
      </MaterialCardContent>
    </MaterialCard>
  )
}
