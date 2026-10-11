'use client'

import useSWR from 'swr'
import {
  ArrowDownTrayIcon,
  CpuChipIcon,
  ExclamationTriangleIcon,
  FilmIcon,
  TvIcon,
} from '@heroicons/react/24/outline'
import { MaterialCard, StatusBadge } from './BaseComponents'
import {
  HEALTH,
  MEDIA_QUEUES_URL,
  SERVICE_META,
  TONE,
  describeUnreachable,
  formatCountValue,
  itemMeta,
  refreshIntervalFor,
} from './mediaQueueDisplay'

const SERVICE_ICONS = {
  sabnzbd: ArrowDownTrayIcon,
  radarr: FilmIcon,
  sonarr: TvIcon,
  tdarr: CpuChipIcon,
}

const GRID = 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4'

async function fetchMediaQueues(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

// Module-level so SWR sees the same options object on every render.
const SWR_OPTIONS = { refreshInterval: refreshIntervalFor }

/**
 * Download and processing queues (SABnzbd, Radarr, Sonarr, Tdarr) for the admin
 * overview. Fetched in the browser after hydration, so the page never waits on
 * a slow service; each card reports its own service's state.
 */
export default function EnhancedQueueDashboard() {
  // Read only data and error: SWR re-renders for the fields a component reads,
  // so leaving isValidating alone keeps unchanged polls from re-rendering.
  const { data, error } = useSWR(MEDIA_QUEUES_URL, fetchMediaQueues, SWR_OPTIONS)
  const queues = data?.queues ?? []
  const shown = queues.filter((queue) => queue.state !== 'not_configured')
  const notConfigured = queues.filter((queue) => queue.state === 'not_configured')

  let body
  if (data) {
    body =
      shown.length > 0 ? (
        <div className={GRID}>
          {shown.map((queue) => (
            <QueueCard key={queue.service} queue={queue} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-500">No queue integrations are configured.</p>
      )
  } else if (error) {
    body = (
      <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        Couldn&apos;t load the queues ({error.message}). Retrying automatically.
      </div>
    )
  } else {
    body = LOADING_GRID
  }

  return (
    <section aria-labelledby="media-queues-heading" className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 id="media-queues-heading" className="text-xl font-bold text-gray-900">
          Media Processing Queues
        </h2>
        {error ? (
          <StatusBadge status="warning" size="small">
            Reconnecting
          </StatusBadge>
        ) : data ? (
          <StatusBadge status="info" size="small">
            Live
          </StatusBadge>
        ) : null}
      </div>

      {error && data ? (
        <p className="text-xs text-amber-700">Couldn&apos;t refresh ({error.message}); showing the last update.</p>
      ) : null}

      {body}

      {notConfigured.length > 0 ? <NotConfiguredNote queues={notConfigured} /> : null}
    </section>
  )
}

function QueueCard({ queue }) {
  const meta = SERVICE_META[queue.service]
  const Icon = SERVICE_ICONS[queue.service]
  return (
    <MaterialCard elevation="low" className="flex flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="h-5 w-5 shrink-0 text-blue-600" aria-hidden="true" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-gray-900">
              {meta.label}
            </h3>
            <p className="truncate text-xs text-gray-500">{meta.description}</p>
          </div>
        </div>
        {queue.state === 'ok' ? (
          <StatusBadge status={HEALTH[queue.health].badge} size="small" variant="soft" className="shrink-0">
            {HEALTH[queue.health].label}
          </StatusBadge>
        ) : (
          <StatusBadge status="error" size="small" variant="soft" className="shrink-0">
            Unreachable
          </StatusBadge>
        )}
      </div>
      <div className="flex-1 px-4 py-3">
        {queue.state === 'ok' ? <QueueBody queue={queue} emptyText={meta.empty} /> : <UnreachableBody queue={queue} />}
      </div>
    </MaterialCard>
  )
}

function QueueBody({ queue, emptyText }) {
  const { items, itemsTotal, counts, notices } = queue
  const remaining = itemsTotal - items.length

  return (
    <div className="space-y-3">
      {counts.length > 0 ? (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
          {counts.map((count) => (
            <div key={count.label} className="min-w-0">
              <dt className="truncate text-xs text-gray-500">{count.label}</dt>
              <dd className={`text-sm font-semibold ${TONE[count.tone].strong}`}>{formatCountValue(count)}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {items.length > 0 ? (
        <ul className="space-y-2">
          {items.map((item) => (
            <QueueItemRow key={item.id} item={item} />
          ))}
        </ul>
      ) : (
        <p className="py-2 text-center text-sm text-gray-400">{emptyText}</p>
      )}

      {remaining > 0 ? <p className="text-center text-xs text-gray-500">+{remaining.toLocaleString()} more</p> : null}

      {notices.length > 0 ? (
        <ul className="space-y-1">
          {notices.map((notice) => (
            <li key={notice.message} className={`flex items-start gap-1.5 text-xs ${TONE[notice.tone].text}`}>
              <ExclamationTriangleIcon className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{notice.message}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function QueueItemRow({ item }) {
  const tone = TONE[item.tone]
  const meta = itemMeta(item)

  return (
    <li className="rounded-md bg-gray-50 p-2.5">
      <p className="truncate text-sm font-medium text-gray-900" title={item.title}>
        {item.title}
      </p>
      {/* Wraps rather than truncates: the status is the part that matters, so
          a long meta line drops below it instead of squeezing it. */}
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-xs">
        <span className={`inline-flex items-center gap-1.5 ${tone.text}`}>
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} aria-hidden="true" />
          {item.status}
        </span>
        {meta ? <span className="text-gray-500">{meta}</span> : null}
      </div>
      {item.progress === null ? null : (
        <div
          className="mt-2 h-1 w-full overflow-hidden rounded-full bg-gray-200"
          role="progressbar"
          aria-label={`${item.title} progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.floor(item.progress)}
        >
          <div className={`h-full rounded-full ${tone.bar} transition-[width] duration-300`} style={{ width: `${item.progress}%` }} />
        </div>
      )}
      {item.detail ? (
        <p
          className={`mt-1 line-clamp-2 text-xs ${item.tone === 'warning' || item.tone === 'error' ? tone.text : 'text-gray-500'}`}
          title={item.detail}
        >
          {item.detail}
        </p>
      ) : null}
    </li>
  )
}

function UnreachableBody({ queue }) {
  const { message, hint } = describeUnreachable(queue)
  return (
    <div className="space-y-1 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">
      <p className="text-sm font-medium">Can&apos;t reach {SERVICE_META[queue.service].label}</p>
      <p>{message}</p>
      {hint ? <p>{hint}</p> : null}
      <p className="text-red-700">Retrying automatically.</p>
    </div>
  )
}

function NotConfiguredNote({ queues }) {
  return (
    <p className="text-xs text-gray-500">
      Not configured:{' '}
      {queues.map((queue, index) => (
        <span key={queue.service}>
          {index > 0 ? '; ' : null}
          {SERVICE_META[queue.service].label} (set{' '}
          {queue.missing.map((name, nameIndex) => (
            <span key={name}>
              {nameIndex > 0 ? ' and ' : null}
              <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[11px] text-gray-700">{name}</code>
            </span>
          ))}
          )
        </span>
      ))}
    </p>
  )
}

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="h-4 w-24 rounded bg-gray-200" />
        <div className="h-4 w-12 rounded-full bg-gray-200" />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="h-8 rounded bg-gray-100" />
        <div className="h-8 rounded bg-gray-100" />
      </div>
      <div className="mt-3 h-12 rounded bg-gray-100" />
    </div>
  )
}

// Static, so it is created once. One placeholder per service keeps the grid
// from jumping when the first response lands.
const LOADING_GRID = (
  <div className={GRID} role="status" aria-busy="true">
    <span className="sr-only">Loading media queues…</span>
    <SkeletonCard />
    <SkeletonCard />
    <SkeletonCard />
    <SkeletonCard />
  </div>
)
