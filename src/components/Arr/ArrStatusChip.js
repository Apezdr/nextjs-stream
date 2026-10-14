import { classNames } from '@src/utils'
import { arrServiceName } from './arrApi'

/**
 * What a watchlist card's chip says for a title's Radarr/Sonarr state, or
 * null for no chip. A title already in the library only gets one while
 * something is still happening to it (a download, missing episodes).
 */
export function describeArrStatus(status, { isAvailable = false } = {}) {
  switch (status?.state) {
    case 'downloading':
      if (status.progress === null || status.progress === undefined) return { label: 'Download queued', tone: 'active' }
      return { label: status.progress >= 100 ? 'Importing' : `Downloading ${status.progress}%`, tone: 'active' }
    case 'downloaded':
      return isAvailable ? null : { label: 'Downloaded · adding to library', tone: 'success' }
    case 'partial':
      return { label: `${status.episodeFileCount} of ${status.episodeCount} episodes`, tone: 'warning' }
    case 'wanted':
      return status.released === false
        ? { label: 'Waiting for release', tone: 'neutral' }
        : { label: 'Looking for a download', tone: 'neutral' }
    case 'unmonitored':
      return { label: 'Not monitored', tone: 'muted' }
    default:
      return null
  }
}

const TONES = {
  active: 'bg-blue-500/15 text-blue-300 ring-blue-400/30',
  success: 'bg-green-500/15 text-green-300 ring-green-400/30',
  warning: 'bg-amber-500/15 text-amber-300 ring-amber-400/30',
  neutral: 'bg-indigo-500/15 text-indigo-200 ring-indigo-400/30',
  muted: 'bg-gray-500/15 text-gray-300 ring-gray-400/30',
}

/** Admin-only: where a title stands in Radarr/Sonarr. */
export default function ArrStatusChip({ status, mediaType, isAvailable = false, className = '' }) {
  const described = describeArrStatus(status, { isAvailable })
  if (!described) return null
  const service = arrServiceName(mediaType)
  return (
    <span
      className={classNames(
        'inline-flex max-w-full items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset',
        TONES[described.tone],
        className
      )}
      title={`${service}: ${described.label}`}
    >
      <span className="font-semibold">{service}</span>
      <span aria-hidden="true">·</span>
      <span className="truncate">{described.label}</span>
    </span>
  )
}
