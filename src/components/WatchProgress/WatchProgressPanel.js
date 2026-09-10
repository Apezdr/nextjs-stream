'use client'

import Link from 'next/link'
import { ArrowPathIcon } from '@heroicons/react/20/solid'
import { classNames } from '@src/utils'
import ProgressBar from './ProgressBar'
import useWatchPosition from './useWatchPosition'
import { formatRemaining } from './progress'
import { withStartOver } from './primaryAction'

/**
 * The resume block under the action row on a movie or episode details page.
 *
 *   Continue where you left off          1:40:13 / 3:02:29
 *   ████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
 *   1h 22m left                              ↺ Start over
 *
 * Reads the viewer's position through useWatchPosition (shared with the
 * primary button and the sticky bar), so it stays live while the film plays
 * elsewhere. Renders nothing until there is a position to show.
 *
 * @param {{ videoURL: string|null, mediaId?: string|null, durationMs?: number|null, playHref: string, className?: string }} props
 */
export default function WatchProgressPanel({ videoURL, mediaId = null, durationMs = null, playHref, className = '' }) {
  const { progress } = useWatchPosition({ videoURL, mediaId, durationMs })

  if (!progress.hasProgress) return null

  const startOverHref = withStartOver(playHref)

  return (
    <div className={classNames('text-sm text-white/80', className)} data-testid="watch-progress-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className={classNames('font-medium', progress.completed ? 'text-emerald-300' : 'text-white')}>
          {progress.completed ? 'Watched' : 'Continue where you left off'}
        </span>
        <span className="tabular-nums text-white/90">{progress.clock}</span>
      </div>
      <ProgressBar
        progressPercent={progress.progressPercent}
        completed={progress.completed}
        className="mt-2 h-1.5 rounded-full"
        trackClassName="bg-white/15"
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-white/60">
        <span>
          {progress.completed
            ? 'You finished this one.'
            : progress.remainingSeconds !== null
              ? formatRemaining(progress.remainingSeconds)
              : `${Math.round(progress.progressPercent)}% watched`}
        </span>
        <Link
          href={startOverHref}
          className="inline-flex items-center gap-1 rounded text-white/70 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
        >
          <ArrowPathIcon className="size-4" aria-hidden="true" />
          Start over
        </Link>
      </div>
    </div>
  )
}
