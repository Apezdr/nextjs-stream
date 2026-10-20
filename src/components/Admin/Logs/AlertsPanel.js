'use client'

import { useState } from 'react'
import { ChevronRightIcon } from '@heroicons/react/20/solid'
import { AlertsNotShared, SEVERITY_STYLES, sortAlerts, useProcessorAlerts } from './useProcessorAlerts'

const when = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const formatWhen = (iso) => (iso ? when.format(new Date(iso)) : '')

function AlertRow({ alert, onShowLines }) {
  const style = SEVERITY_STYLES[alert.severity] ?? SEVERITY_STYLES.info
  const resolved = alert.state === 'resolved'
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${resolved ? 'bg-green-500' : style.dot}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className={`break-words text-sm ${resolved ? 'text-gray-500' : 'text-gray-900'}`}>{alert.title}</p>
        <p className="mt-0.5 text-xs text-gray-500">
          <span className={`font-medium ${resolved ? 'text-green-700' : style.text}`}>{resolved ? 'Resolved' : alert.severity}</span>
          {' · '}
          {resolved ? `${formatWhen(alert.firedAt)} – ${formatWhen(alert.resolvedAt)}` : `since ${formatWhen(alert.firedAt)}`}
          {alert.muted && ' · muted'}
        </p>
      </div>
      {alert.fp && (
        <button
          type="button"
          onClick={() => onShowLines(alert)}
          className="shrink-0 rounded px-2 py-0.5 text-xs font-medium text-indigo-600 ring-1 ring-inset ring-indigo-200 hover:bg-indigo-50"
        >
          Show lines
        </button>
      )}
    </li>
  )
}

/**
 * The selected server's log alerts above its log: firing ones first, resolved
 * in the last day behind a toggle. "Show lines" filters the log to the
 * alert's fingerprint.
 */
export default function AlertsPanel({ serverId, onShowLines }) {
  const { data, error, isLoading } = useProcessorAlerts(serverId)
  const [showResolved, setShowResolved] = useState(false)

  if (!serverId || isLoading) return null
  if (error) {
    return (
      <p className="mb-4 text-sm text-gray-500">
        {error instanceof AlertsNotShared ? "This server doesn't share its alerts with you." : `Alerts unavailable: ${error.message}`}
      </p>
    )
  }

  const active = sortAlerts(data?.active ?? [])
  const recent = data?.recent ?? []

  return (
    <section aria-label="Log alerts" className="mb-4 rounded-lg px-4 py-2 ring-1 ring-inset ring-gray-200">
      <div className="flex flex-wrap items-center justify-between gap-2 py-1">
        <h2 className="text-sm font-semibold text-gray-900">
          {active.length === 0 ? (
            <span className="inline-flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-green-500" aria-hidden="true" />
              No active alerts
            </span>
          ) : (
            `${active.length} active ${active.length === 1 ? 'alert' : 'alerts'}`
          )}
        </h2>
        {recent.length > 0 && (
          <button
            type="button"
            onClick={() => setShowResolved((value) => !value)}
            aria-expanded={showResolved}
            className="inline-flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900"
          >
            <ChevronRightIcon className={`h-4 w-4 transition-transform ${showResolved ? 'rotate-90' : ''}`} aria-hidden="true" />
            {recent.length} resolved in the last day
          </button>
        )}
      </div>
      {(active.length > 0 || showResolved) && (
        <ul className="divide-y divide-gray-100">
          {active.map((alert) => (
            <AlertRow key={alert.key} alert={alert} onShowLines={onShowLines} />
          ))}
          {showResolved && recent.map((alert) => <AlertRow key={`${alert.key}:${alert.resolvedAt}`} alert={alert} onShowLines={onShowLines} />)}
        </ul>
      )}
    </section>
  )
}
