'use client'

import Link from 'next/link'
import useSWR from 'swr'
import { ArrowPathIcon, PlayIcon } from '@heroicons/react/20/solid'
import { classNames, fetcher } from '@src/utils'
import ProgressBar from './ProgressBar'
import useLiveProgress from './useLiveProgress'
import { formatClock } from './progress'

/**
 * The resume strip on a movie or episode details page.
 *
 * The details pages render inside a shared `'use cache'` subtree with no
 * per-user data, so the position is read on the client from the per-title
 * endpoint (which resolves by URL, hash and durable mediaId, and carries
 * `completed` / `progressPercent`), re-read every 15 s and on focus so a
 * film playing on the Shield moves the bar here. The local mirror
 * (useLiveProgress) fills the first paint and the seconds in between.
 *
 * Renders nothing until there is a position to show.
 *
 * @param {{ videoURL: string|null, mediaId?: string|null, durationMs?: number|null, playHref: string, className?: string }} props
 */
/** Server re-read cadence; the local mirror covers the gaps at 5 s. */
const REFRESH_MS = 15000

export default function WatchProgressPanel({ videoURL, mediaId = null, durationMs = null, playHref, className = '' }) {
  const key = videoURL ? `/api/authenticated/sync/playback?videoId=${encodeURIComponent(videoURL)}` : null
  const { data } = useSWR(key, fetcher, {
    revalidateOnFocus: true,
    refreshInterval: REFRESH_MS,
    dedupingInterval: 5000,
  })

  const watchHistory = data && data.found
    ? {
        playbackTime: data.playbackTime,
        progressPercent: data.progressPercent,
        completed: data.completed,
        lastWatched: data.lastUpdated,
      }
    : null
  const progress = useLiveProgress({ watchHistory, mediaId, videoURL, durationMs })

  if (!progress.hasProgress) return null

  const remaining = progress.durationMs ? Math.max(0, progress.durationMs / 1000 - progress.playbackTime) : null
  const startOverHref = playHref.includes('?') ? `${playHref}&start=0` : `${playHref}?start=0`

  return (
    <div
      className={classNames(
        'mt-4 rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-gray-200',
        className
      )}
      data-testid="watch-progress-panel"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className={classNames('font-semibold', progress.completed ? 'text-green-400' : 'text-blue-300')}>
          {progress.completed ? 'Watched' : 'Continue Watching'}
        </span>
        <span className="font-mono tabular-nums text-gray-100">{progress.clock}</span>
      </div>
      <ProgressBar
        progressPercent={progress.progressPercent}
        completed={progress.completed}
        className="mt-2 h-1.5 rounded-full"
        trackClassName="bg-white/15"
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-gray-400">
        <span>
          {progress.completed
            ? 'Finished. Playing again starts from the beginning.'
            : remaining !== null
              ? `${formatClock(remaining)} left`
              : `${Math.round(progress.progressPercent)}% watched`}
        </span>
        <span className="flex items-center gap-3">
          {!progress.completed && (
            <Link href={playHref} className="inline-flex items-center gap-1 text-blue-300 hover:text-white">
              <PlayIcon className="size-4" aria-hidden="true" />
              Resume at {formatClock(progress.playbackTime)}
            </Link>
          )}
          <Link href={startOverHref} className="inline-flex items-center gap-1 text-gray-300 hover:text-white">
            <ArrowPathIcon className="size-4" aria-hidden="true" />
            Start over
          </Link>
        </span>
      </div>
    </div>
  )
}
