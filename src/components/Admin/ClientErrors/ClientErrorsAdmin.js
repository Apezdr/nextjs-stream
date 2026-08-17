'use client'

import { useState, useEffect } from 'react'
import useSWR from 'swr'
import {
  ExclamationTriangleIcon,
  InformationCircleIcon,
  XCircleIcon,
  TrashIcon,
  DevicePhoneMobileIcon,
  TvIcon,
} from '@heroicons/react/24/outline'
import { toast } from 'react-toastify'
import { buildURL, fetcher } from '@src/utils'
import { useAppDateFormatter } from '@src/contexts/AppTimeZoneContext'

const REFRESH_INTERVAL_MS = 15000

const severityConfig = {
  fatal: {
    icon: XCircleIcon,
    color: 'text-red-600',
    bgColor: 'bg-red-100',
    label: 'Fatal',
  },
  error: {
    icon: ExclamationTriangleIcon,
    color: 'text-orange-600',
    bgColor: 'bg-orange-100',
    label: 'Error',
  },
  warning: {
    icon: InformationCircleIcon,
    color: 'text-yellow-600',
    bgColor: 'bg-yellow-100',
    label: 'Warning',
  },
}

const codecSupportColors = {
  hardware: 'bg-green-100 text-green-700',
  software: 'bg-blue-100 text-blue-700',
  unsupported: 'bg-red-100 text-red-700',
  unknown: 'bg-gray-100 text-gray-600',
}

function groupsKeyFor(severity, category, page) {
  const params = new URLSearchParams({ view: 'groups', page: String(page) })
  if (severity !== 'all') params.set('severity', severity)
  if (category !== 'all') params.set('category', category)
  return buildURL(`/api/authenticated/admin/client-errors?${params.toString()}`)
}

export default function ClientErrorsAdmin() {
  const { formatDateTime } = useAppDateFormatter()
  const [severityFilter, setSeverityFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [expandedGroup, setExpandedGroup] = useState(null)
  const [actionLoading, setActionLoading] = useState(false)

  const { data, error, isLoading, mutate } = useSWR(
    groupsKeyFor(severityFilter, categoryFilter, page),
    fetcher,
    {
      refreshInterval: REFRESH_INTERVAL_MS,
      revalidateOnFocus: true,
      keepPreviousData: true,
    }
  )

  const groups = data?.data?.groups || []
  const stats = data?.data?.stats || null
  const pagination = data?.data?.pagination || null

  // If this page emptied out (e.g. the last group on it was deleted, or the
  // TTL swept it between polls), step back; the key change refetches.
  useEffect(() => {
    if (data?.data?.groups && data.data.groups.length === 0 && page > 1) {
      setPage(page - 1)
    }
  }, [data, page])

  const handleDeleteGroup = async (dedupeKey) => {
    if (!window.confirm('Delete all reports in this group? This cannot be undone.')) {
      return
    }
    try {
      setActionLoading(true)
      const params = new URLSearchParams({ dedupeKey })
      const response = await fetch(
        `/api/authenticated/admin/client-errors?${params.toString()}`,
        { method: 'DELETE' }
      )
      if (!response.ok) {
        throw new Error('Failed to delete error group')
      }
      const json = await response.json()
      toast.success(`Deleted ${json.data?.deletedCount ?? 0} report(s)`)
      if (expandedGroup === dedupeKey) {
        setExpandedGroup(null)
      }
      await mutate()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setActionLoading(false)
    }
  }

  const severityCounts = stats?.severity || {}
  const categories = Object.keys(stats?.category || {}).sort()

  if (isLoading && !data) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    )
  }

  if (error || data?.error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-md p-4">
        <div className="flex">
          <ExclamationTriangleIcon className="h-5 w-5 text-red-400" />
          <div className="ml-3">
            <h3 className="text-sm font-medium text-red-800">Error</h3>
            <p className="mt-2 text-sm text-red-700">
              {error?.message || data?.error?.message || 'Failed to fetch client error reports'}
            </p>
            <button
              onClick={() => mutate()}
              className="mt-2 text-sm text-red-600 hover:text-red-500"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 w-full">
      <div className="sm:flex sm:items-center">
        <div className="sm:flex-auto">
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Client Errors</h1>
          <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
            Error reports from external client apps, grouped by error signature. Auto-refreshes
            every {REFRESH_INTERVAL_MS / 1000}s.
            {stats && (
              <span className="ml-2 text-gray-500 dark:text-gray-400">
                {stats.total} report{stats.total !== 1 ? 's' : ''} total · {stats.last24h} in the
                last 24h
              </span>
            )}
          </p>
        </div>
        <div className="mt-4 sm:mt-0 sm:ml-16 sm:flex-none">
          <button
            onClick={() => mutate()}
            disabled={isLoading}
            className="inline-flex items-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Severity Filter Tabs + Category Select */}
      <div className="border-b border-gray-200 dark:border-gray-700 flex items-end justify-between">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => {
              setSeverityFilter('all')
              setPage(1)
            }}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              severityFilter === 'all'
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            All ({stats?.total || 0})
          </button>
          {Object.entries(severityConfig).map(([severity, config]) => (
            <button
              key={severity}
              onClick={() => {
                setSeverityFilter(severity)
                setPage(1)
              }}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                severityFilter === severity
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {config.label} ({severityCounts[severity] || 0})
            </button>
          ))}
        </nav>
        {categories.length > 0 && (
          <select
            value={categoryFilter}
            onChange={(e) => {
              setCategoryFilter(e.target.value)
              setPage(1)
            }}
            className="mb-1 rounded-md border-gray-300 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
          >
            <option value="all">All categories</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat} ({stats.category[cat]})
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Error Groups */}
      <div className="bg-white dark:bg-gray-800 shadow overflow-hidden sm:rounded-md">
        <ul className="divide-y divide-gray-200 dark:divide-gray-700">
          {groups.length === 0 ? (
            <li className="px-6 py-8 text-center">
              <p className="text-gray-500 dark:text-gray-400">No client error reports found.</p>
            </li>
          ) : (
            groups.map((group) => {
              const config = severityConfig[group.severity] || severityConfig.error
              const IconComponent = config.icon
              const isExpanded = expandedGroup === group.dedupeKey
              const deviceSummary = (group.deviceModels || []).filter(Boolean).join(', ')

              return (
                <li key={group.dedupeKey} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <div className="px-6 py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center flex-wrap gap-2">
                          <div
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${config.bgColor} ${config.color}`}
                          >
                            <IconComponent className="h-3 w-3 mr-1" />
                            {config.label}
                          </div>
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700 dark:bg-gray-600 dark:text-gray-200">
                            {group.category}
                          </span>
                          {(group.platforms || []).map((platform) => (
                            <span
                              key={platform}
                              className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-200"
                            >
                              {group.latestApp?.isTV ? (
                                <TvIcon className="h-3 w-3 mr-1" />
                              ) : (
                                <DevicePhoneMobileIcon className="h-3 w-3 mr-1" />
                              )}
                              {platform}
                            </span>
                          ))}
                        </div>
                        <p className="mt-2 text-sm font-mono text-gray-800 dark:text-gray-200 break-all line-clamp-2">
                          {group.message}
                        </p>
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          {group.count} report{group.count !== 1 ? 's' : ''} · {group.userCount}{' '}
                          user{group.userCount !== 1 ? 's' : ''}
                          {deviceSummary && <> · {deviceSummary}</>}
                          {' · '}last seen {formatDateTime(group.lastSeen)}
                        </p>
                      </div>

                      <div className="flex items-center space-x-3 shrink-0">
                        <button
                          onClick={() =>
                            setExpandedGroup(isExpanded ? null : group.dedupeKey)
                          }
                          className="text-indigo-600 hover:text-indigo-900 text-sm font-medium"
                        >
                          {isExpanded ? 'Hide' : 'Details'}
                        </button>
                        <button
                          onClick={() => handleDeleteGroup(group.dedupeKey)}
                          disabled={actionLoading}
                          title="Delete this error group"
                          className="text-gray-400 hover:text-red-600 disabled:opacity-50"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    {isExpanded && <GroupReports dedupeKey={group.dedupeKey} />}
                  </div>
                </li>
              )
            })
          )}
        </ul>
      </div>

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Page {pagination.page} of {pagination.totalPages} ({pagination.totalCount} group
            {pagination.totalCount !== 1 ? 's' : ''})
          </p>
          <div className="flex space-x-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || isLoading}
              className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= pagination.totalPages || isLoading}
              className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function GroupReports({ dedupeKey }) {
  const params = new URLSearchParams({ view: 'reports', dedupeKey, limit: '20' })
  const { data, error, isLoading, mutate } = useSWR(
    buildURL(`/api/authenticated/admin/client-errors?${params.toString()}`),
    fetcher,
    { refreshInterval: REFRESH_INTERVAL_MS, keepPreviousData: true }
  )

  const reports = data?.data?.reports || []

  if (isLoading && !data) {
    return (
      <div className="mt-4 flex justify-center py-6">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600"></div>
      </div>
    )
  }

  if (error || data?.error) {
    return (
      <div className="mt-4 bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-700">
        {error?.message || 'Failed to fetch reports for this group'}{' '}
        <button onClick={() => mutate()} className="text-red-600 underline hover:text-red-500">
          Try again
        </button>
      </div>
    )
  }

  return (
    <div className="mt-4 border-t border-gray-200 dark:border-gray-600 pt-4 space-y-4">
      <p className="text-xs text-gray-500 dark:text-gray-400 font-mono">
        dedupeKey: {dedupeKey}
      </p>
      {reports.map((report) => (
        <ReportDetails key={report._id} report={report} />
      ))}
    </div>
  )
}

function ReportDetails({ report }) {
  const { formatDateTime } = useAppDateFormatter()
  const details = report.details || {}
  const isPlayback = report.category === 'playback'
  const codecSupport = Array.isArray(details.codecSupport) ? details.codecSupport : []
  const genericDetails = { ...details }
  if (isPlayback) {
    delete genericDetails.codecSupport
    delete genericDetails.videoURL
    delete genericDetails.playerStatus
    delete genericDetails.playbackSessionId
    delete genericDetails.mediaId
    delete genericDetails.mediaType
  }

  return (
    <div className="rounded-md bg-gray-50 dark:bg-gray-700 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-600 dark:text-gray-300">
        <span className="font-medium">{report.userEmail || String(report.userId)}</span>
        <span>received {formatDateTime(report.receivedAt)}</span>
      </div>

      <dl className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-xs">
        <DetailRow label="App">
          {report.app?.version}
          {report.app?.otaUpdateId ? ` (OTA ${report.app.otaUpdateId})` : ''} ·{' '}
          {report.app?.platform}
          {report.app?.isTV ? ' · TV' : ''}
        </DetailRow>
        <DetailRow label="Device">
          {[report.device?.brand, report.device?.model].filter(Boolean).join(' ') || 'Unknown'}
          {report.device?.osVersion ? ` · OS ${report.device.osVersion}` : ''}
          {report.device?.apiLevel != null ? ` · API ${report.device.apiLevel}` : ''}
        </DetailRow>
        <DetailRow label="Occurred (device clock)">{report.occurredAt || 'n/a'}</DetailRow>
        {isPlayback && (
          <>
            {details.mediaId && (
              <DetailRow label="Media">
                {details.mediaId}
                {details.mediaType ? ` (${details.mediaType})` : ''}
              </DetailRow>
            )}
            {details.playerStatus && (
              <DetailRow label="Player status">{details.playerStatus}</DetailRow>
            )}
            {details.playbackSessionId && (
              <DetailRow label="Playback session">
                <span className="font-mono">{details.playbackSessionId}</span>
              </DetailRow>
            )}
            {details.videoURL && (
              <div className="md:col-span-2">
                <DetailRow label="Stream URL">
                  <span className="font-mono break-all">{details.videoURL}</span>
                </DetailRow>
              </div>
            )}
          </>
        )}
      </dl>

      {codecSupport.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
            Codec support probe
          </p>
          <div className="flex flex-wrap gap-1">
            {codecSupport.map((codec, i) => (
              <span
                key={`${codec.mimeType}-${codec.width}x${codec.height}-${i}`}
                className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono ${
                  codecSupportColors[codec.support] || codecSupportColors.unknown
                }`}
              >
                {codec.mimeType} {codec.width}x{codec.height}: {codec.support}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3">
        <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
          Raw message{report.messageTruncated ? ' (truncated)' : ''}
        </p>
        <pre className="text-xs bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded border border-gray-200 dark:border-gray-600 p-2 whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
          {report.message}
        </pre>
      </div>

      {!isPlayback && Object.keys(genericDetails).length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Details</p>
          <pre className="text-xs bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded border border-gray-200 dark:border-gray-600 p-2 whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
            {JSON.stringify(genericDetails, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

function DetailRow({ label, children }) {
  return (
    <div>
      <dt className="inline font-medium text-gray-700 dark:text-gray-300">{label}:</dt>
      <dd className="inline ml-2 text-gray-600 dark:text-gray-400">{children}</dd>
    </div>
  )
}
