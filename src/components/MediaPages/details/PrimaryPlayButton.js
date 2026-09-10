'use client'

import Link from 'next/link'
import { ArrowPathIcon, PlayIcon } from '@heroicons/react/20/solid'
import { classNames } from '@src/utils'
import useWatchPosition from '@components/WatchProgress/useWatchPosition'
import { primaryAction } from '@components/WatchProgress/primaryAction'

const SIZES = {
  lg: 'h-12 px-6 text-base gap-2',
  sm: 'h-9 px-4 text-sm gap-1.5',
}

/**
 * The one filled button on a details page. Says "Play" until the viewer's
 * position is known, then "Resume" or "Watch again" (which restarts).
 *
 * The details subtree is cached for everyone, so the label is decided on the
 * client from the same position the resume panel reads.
 *
 * @param {{ videoURL: string|null, mediaId?: string|null, durationMs?: number|null, playHref: string, size?: 'lg'|'sm', className?: string }} props
 */
export default function PrimaryPlayButton({ videoURL, mediaId = null, durationMs = null, playHref, size = 'lg', className = '' }) {
  const { progress } = useWatchPosition({ videoURL, mediaId, durationMs })
  const action = primaryAction({ progress, playHref })
  const Icon = action.restart ? ArrowPathIcon : PlayIcon

  return (
    <Link
      href={action.href}
      className={classNames(
        'inline-flex items-center justify-center rounded-md bg-blue-500 font-semibold text-white shadow-lg shadow-blue-900/40',
        'transition-colors hover:bg-blue-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300',
        SIZES[size] || SIZES.lg,
        className
      )}
      data-primary-action={action.label}
    >
      <Icon className={size === 'sm' ? 'size-4' : 'size-5'} aria-hidden="true" />
      {action.label}
    </Link>
  )
}
