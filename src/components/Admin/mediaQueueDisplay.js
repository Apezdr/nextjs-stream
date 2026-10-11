// Display rules for the admin "Media Processing Queues" panel
// (EnhancedQueueDashboard). The data shape is lib/mediaQueues/types.ts.

import { formatBytes } from './Stats/serverLoadDisplay'

export const MEDIA_QUEUES_URL = '/api/authenticated/admin/media-queues'

/** One queue, asked again now rather than served from the shared answer. */
export const refreshUrlFor = (service) => `${MEDIA_QUEUES_URL}?refresh=${encodeURIComponent(service)}`

/** The panel's data with one service's queue swapped in; the other cards stay as they are. */
export function withQueue(data, queue) {
  if (!data) return data
  return { ...data, queues: data.queues.map((current) => (current.service === queue.service ? queue : current)) }
}

/** Poll this often while anything is downloading, importing or transcoding… */
export const ACTIVE_REFRESH_MS = 3_000
/** …and this often otherwise, including while a service is unreachable. */
export const IDLE_REFRESH_MS = 15_000

/** SWR calls this with the latest data to pick the next poll delay. */
export function refreshIntervalFor(data) {
  const moving = data?.queues?.some((queue) => queue.state === 'ok' && queue.inProgress > 0)
  return moving ? ACTIVE_REFRESH_MS : IDLE_REFRESH_MS
}

export const SERVICE_META = {
  // Descriptions stay short enough to sit beside the widest badge ("Needs attention") untruncated.
  sabnzbd: { label: 'SABnzbd', description: 'Downloads', apiKeyEnv: 'SABNZBD_API_KEY', urlEnv: 'SABNZBD_URL', empty: 'Nothing downloading' },
  radarr: { label: 'Radarr', description: 'Movies', apiKeyEnv: 'RADARR_API_KEY', urlEnv: 'RADARR_URL', empty: 'Queue is empty' },
  sonarr: { label: 'Sonarr', description: 'TV episodes', apiKeyEnv: 'SONARR_API_KEY', urlEnv: 'SONARR_URL', empty: 'Queue is empty' },
  tdarr: { label: 'Tdarr', description: 'Transcoding', apiKeyEnv: 'TDARR_API_KEY', urlEnv: 'TDARR_URL', empty: 'No workers running' },
}

export const HEALTH = {
  idle: { label: 'Idle', badge: 'neutral' },
  active: { label: 'Active', badge: 'info' },
  waiting: { label: 'Waiting', badge: 'neutral' },
  paused: { label: 'Paused', badge: 'warning' },
  warning: { label: 'Needs attention', badge: 'warning' },
  error: { label: 'Errors', badge: 'error' },
}

export const TONE = {
  neutral: { text: 'text-gray-600', strong: 'text-gray-900', dot: 'bg-gray-400', bar: 'bg-gray-400' },
  active: { text: 'text-blue-700', strong: 'text-blue-700', dot: 'bg-blue-500', bar: 'bg-blue-500' },
  warning: { text: 'text-amber-700', strong: 'text-amber-700', dot: 'bg-amber-500', bar: 'bg-amber-500' },
  error: { text: 'text-red-700', strong: 'text-red-700', dot: 'bg-red-500', bar: 'bg-red-500' },
}

const UNREACHABLE_MESSAGES = {
  timeout: 'Did not answer in time',
  unauthorized: 'Rejected the API key',
  refused: 'Refused the connection',
  network: 'Could not be reached over the network',
  bad_url: 'The configured URL is not valid',
  http_error: 'Answered with an error',
  invalid_response: 'Sent a response the dashboard could not read',
}

/** What went wrong, and the setting to check when it is a configuration problem. */
export function describeUnreachable({ service, reason, httpStatus }) {
  const base = UNREACHABLE_MESSAGES[reason] ?? 'Could not be reached'
  const meta = SERVICE_META[service]
  let hint = null
  if (reason === 'unauthorized') hint = `Check ${meta.apiKeyEnv}.`
  else if (reason === 'refused') hint = `Is it running? Check ${meta.urlEnv}.`
  else if (reason === 'bad_url') hint = `Check ${meta.urlEnv}.`
  return { message: httpStatus ? `${base} (HTTP ${httpStatus}).` : `${base}.`, hint }
}

/** "2d 3h", "1h 05m", "4m 09s", "38s"; null for nothing left. */
export function formatTimeLeft(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  const total = Math.round(seconds)
  const days = Math.floor(total / 86_400)
  const hours = Math.floor((total % 86_400) / 3_600)
  const minutes = Math.floor((total % 3_600) / 60)
  const secs = total % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`
  if (minutes > 0) return `${minutes}m ${String(secs).padStart(2, '0')}s`
  return `${secs}s`
}

export function formatCountValue({ value, unit }) {
  if (unit === 'bytesPerSecond') return `${formatBytes(value)}/s`
  if (unit === 'seconds') return formatTimeLeft(value) ?? '—'
  return value.toLocaleString()
}

/** "42% · 21.6 GiB · 12m 05s left", leaving out what the item lacks. */
export function itemMeta(item) {
  const timeLeft = formatTimeLeft(item.timeLeftSeconds)
  return [
    item.progress === null ? null : `${Math.floor(item.progress)}%`,
    item.sizeBytes === null ? null : formatBytes(item.sizeBytes),
    timeLeft ? `${timeLeft} left` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}
