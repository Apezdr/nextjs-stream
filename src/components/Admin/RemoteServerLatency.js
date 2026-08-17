'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { buildURL, fetcher } from '@src/utils'
import AppDateTime from '@components/AppDateTime'
import {
  MaterialCard,
  MaterialCardContent,
  MaterialCardHeader,
  MaterialButton,
  StatusBadge,
} from './BaseComponents'

function latencyPresentation(server) {
  if (!Number.isFinite(server.latencyMs)) {
    return { status: 'error', label: 'Unavailable', color: 'text-red-600' }
  }
  if (server.latencyMs < 100) return { status: 'success', label: 'Good', color: 'text-emerald-600' }
  if (server.latencyMs < 250) return { status: 'warning', label: 'Elevated', color: 'text-amber-600' }
  return { status: 'error', label: 'High', color: 'text-red-600' }
}

export default function RemoteServerLatency() {
  const [isChecking, setIsChecking] = useState(false)
  const { data, error, isLoading, isValidating, mutate } = useSWR(
    buildURL('/api/authenticated/admin/server-latency'),
    fetcher,
    {
      revalidateOnFocus: false,
      refreshInterval: (latest) =>
        latest?.state === 'disabled' || latest?.state === 'no-remote-servers' ? 0 : 30000,
    }
  )

  if (data?.state === 'no-remote-servers') return null

  const checkNow = async () => {
    setIsChecking(true)
    try {
      const response = await fetch(buildURL('/api/authenticated/admin/server-latency?refresh=1'), {
        cache: 'no-store',
      })
      if (!response.ok) throw new Error(`Latency check failed (${response.status})`)
      await mutate(await response.json(), { revalidate: false })
    } finally {
      setIsChecking(false)
    }
  }

  return (
    <MaterialCard elevation="medium">
      <MaterialCardHeader
        title="Remote Sync Server Latency"
        subtitle="Round-trip response time from this app to each remote sync server"
        icon={
          <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h8m-4-4v8M5 4h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z" />
          </svg>
        }
        action={data?.state !== 'disabled' ? (
          <MaterialButton
            variant="outlined"
            size="small"
            loading={isChecking || isValidating}
            onClick={checkNow}
          >
            Check now
          </MaterialButton>
        ) : null}
      />
      <MaterialCardContent>
        {isLoading ? (
          <div className="h-16 animate-pulse rounded bg-gray-100" />
        ) : error ? (
          <p className="text-sm text-red-600">Unable to load remote latency.</p>
        ) : data?.state === 'disabled' ? (
          <p className="text-sm text-gray-500">
            Latency checks are disabled in Admin Settings.
          </p>
        ) : (
          <div className="divide-y divide-gray-100">
            {(data?.servers || []).map((server) => {
              const presentation = latencyPresentation(server)
              return (
                <div key={server.serverId} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900">{server.displayName}</p>
                    <p className="text-xs text-gray-500">Remote sync server</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-sm font-semibold tabular-nums ${presentation.color}`}>
                      {Number.isFinite(server.latencyMs) ? `${server.latencyMs} ms` : '—'}
                    </span>
                    <StatusBadge status={presentation.status} variant="soft">
                      {presentation.label}
                    </StatusBadge>
                  </div>
                </div>
              )
            })}
            {data?.checkedAt ? (
              <p className="pt-3 text-right text-xs text-gray-400">
                Checked <AppDateTime value={data.checkedAt} options={{ year: undefined, month: undefined, day: undefined }} />
              </p>
            ) : null}
          </div>
        )}
      </MaterialCardContent>
    </MaterialCard>
  )
}