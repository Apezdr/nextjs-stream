'use client'

import useSWR from 'swr'
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react'
import { XMarkIcon, TvIcon, DevicePhoneMobileIcon, DeviceTabletIcon, ComputerDesktopIcon } from '@heroicons/react/20/solid'
import { classNames } from '@src/utils'
import { readProgress, formatClock } from '@components/WatchProgress/progress'

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300'

/** The device of a viewer's latest row (WatchHistory `deviceInfo.type`). */
const DEVICES = {
  tv: { Icon: TvIcon, label: 'TV' },
  mobile: { Icon: DevicePhoneMobileIcon, label: 'Mobile' },
  tablet: { Icon: DeviceTabletIcon, label: 'Tablet' },
  desktop: { Icon: ComputerDesktopIcon, label: 'Desktop' },
}

// Client-only (the dialog is never server-rendered), so the viewer's own locale and time zone
const WHEN = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

async function fetchViewers(url) {
  const res = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Viewer list request failed (${res.status})`)
  return res.json()
}

function initialsOf(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean)
  return words.length === 0 ? '?' : words.slice(0, 2).map((w) => w[0].toUpperCase()).join('')
}

function Avatar({ name, image }) {
  if (image) {
    // A provider avatar (Google, Discord): a plain img, since those hosts are not the image optimizer's business
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={image} alt="" referrerPolicy="no-referrer" className="size-9 shrink-0 rounded-full object-cover ring-1 ring-white/10" />
  }
  return (
    <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold text-white/80">
      {initialsOf(name)}
    </span>
  )
}

function ViewerRow({ viewer, durationMs }) {
  const progress = readProgress({ playbackTime: viewer.playbackTime, durationMs })
  const device = DEVICES[viewer.deviceType] || null
  const when = viewer.lastUpdated ? new Date(viewer.lastUpdated) : null
  const percent = Math.round(progress.progressPercent)

  return (
    <li className="flex items-center gap-3 py-3">
      <Avatar name={viewer.name} image={viewer.image} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white">{viewer.name || 'Unknown user'}</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-white/50">
          {device ? (
            <>
              <device.Icon className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="sr-only">{device.label}, </span>
            </>
          ) : null}
          {when && !Number.isNaN(when.getTime()) ? <time dateTime={when.toISOString()}>{WHEN.format(when)}</time> : null}
        </p>
      </div>
      <div className="w-24 shrink-0 text-right">
        {progress.completed ? (
          <p className="text-xs font-medium text-emerald-300">Finished</p>
        ) : progress.durationMs ? (
          <>
            <p className="text-xs font-medium text-white/80">{percent}%</p>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
              <div className="h-full rounded-full bg-blue-400" style={{ width: `${progress.progressPercent}%` }} />
            </div>
          </>
        ) : (
          <p className="text-xs font-medium text-white/80">{formatClock(progress.playbackTime)}</p>
        )}
      </div>
    </li>
  )
}

/**
 * The admin "Watched by" dialog: everyone who has watched this title, most
 * recent first, with how far they got, when, and on what kind of device.
 * The same rows the page's count reads (listViewersByNormalizedId).
 *
 * Nothing is fetched until the dialog opens; reopening shows the last list
 * and refreshes it behind.
 *
 * @param {Object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {string} props.title - the title's display name
 * @param {string} props.normalizedVideoId
 * @param {string|null} [props.mediaId]
 * @param {number|null} [props.durationMs]
 */
export default function WatchedByDialog({ open, onClose, title, normalizedVideoId, mediaId = null, durationMs = null }) {
  const params = new URLSearchParams({ normalizedVideoId })
  if (mediaId) params.set('mediaId', mediaId)
  const key = open ? `/api/authenticated/admin/watched-by?${params}` : null
  const { data, error, isLoading } = useSWR(key, fetchViewers, { revalidateOnFocus: false, revalidateOnReconnect: false })
  const viewers = data?.viewers || []

  return (
    <Dialog open={open} onClose={onClose} className="relative z-[70]">
      <DialogBackdrop className="fixed inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="fixed inset-0 flex items-center justify-center p-3 sm:p-6">
        <DialogPanel className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-[#0f1633] shadow-2xl ring-1 ring-white/10">
          <div className="flex items-start justify-between gap-4 px-5 pt-5">
            <div className="min-w-0">
              <DialogTitle className="text-lg font-semibold text-white">
                Watched by{data ? ` ${viewers.length} ${viewers.length === 1 ? 'person' : 'people'}` : ''}
              </DialogTitle>
              <p className="truncate text-sm text-white/55">{title}</p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className={classNames('rounded-md p-2 text-white/70 hover:bg-white/10 hover:text-white', FOCUS_RING)}>
              <XMarkIcon className="size-5" aria-hidden="true" />
            </button>
          </div>

          <div className="mt-2 min-h-0 flex-1 overflow-y-auto px-5 pb-4">
            {error && !data ? (
              <p className="py-6 text-sm text-red-300">Could not load the viewers. {error.message}</p>
            ) : isLoading && !data ? (
              <ul aria-busy="true" aria-label="Loading viewers" className="divide-y divide-white/10">
                {[0, 1, 2].map((i) => (
                  <li key={i} className="flex items-center gap-3 py-3">
                    <span className="size-9 animate-pulse rounded-full bg-white/10" />
                    <span className="h-3 w-32 animate-pulse rounded bg-white/10" />
                  </li>
                ))}
              </ul>
            ) : viewers.length === 0 ? (
              <p className="py-6 text-sm text-white/60">No one has watched this yet.</p>
            ) : (
              <ul className="divide-y divide-white/10">
                {viewers.map((viewer) => (
                  <ViewerRow key={viewer.userId} viewer={viewer} durationMs={durationMs} />
                ))}
              </ul>
            )}
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}
