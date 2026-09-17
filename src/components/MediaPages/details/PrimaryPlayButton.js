'use client'

import Link from 'next/link'
import { ArrowPathIcon, PlayIcon } from '@heroicons/react/20/solid'
import { classNames } from '@src/utils'
import useWatchPosition from '@components/WatchProgress/useWatchPosition'
import { primaryAction } from '@components/WatchProgress/primaryAction'
import { PRIMARY_CLASSES, PRIMARY_CLASSES_SM } from './Primitives'

// Re-exported for client surfaces that render a matching primary. A server
// component should import it from './Primitives' (see the note there).
export { PRIMARY_CLASSES }

/**
 * The one filled button on a details page. Says "Play" until the viewer's
 * position is known, then "Resume" or "Watch again" (which restarts).
 *
 * The details subtree is cached for everyone, so the label is decided on the
 * client from the same position the resume panel reads. A page that already
 * has the viewer's watch history on the server (the show and season pages)
 * passes it as `watchHistory`, so the first paint already says the right
 * verb and a rewatch already links to `?start=0`.
 *
 * With a `noun` the verb names what it plays: "Resume S1 · E1",
 * "Play Episode 3". `restartNoun` is the noun after "Watch again" (defaults
 * to `noun`; '' drops it, so a page can say "Watch again" alone).
 *
 * @param {Object} props
 * @param {string|null} props.videoURL
 * @param {string|null} [props.mediaId]
 * @param {number|null} [props.durationMs]
 * @param {string} props.playHref
 * @param {'lg'|'sm'} [props.size]
 * @param {string} [props.className]
 * @param {string|null} [props.noun]
 * @param {string|null} [props.restartNoun]
 * @param {Object|null} [props.watchHistory] - the server's watch-history object for this title, when the page had it
 */
export default function PrimaryPlayButton({
  videoURL,
  mediaId = null,
  durationMs = null,
  playHref,
  size = 'lg',
  className = '',
  noun = null,
  restartNoun = noun,
  watchHistory = null,
}) {
  const { progress } = useWatchPosition({ videoURL, mediaId, durationMs, watchHistory })
  const action = primaryAction({ progress, playHref })
  const Icon = action.restart ? ArrowPathIcon : PlayIcon
  const suffix = action.restart ? restartNoun : noun
  const label = typeof suffix === 'string' && suffix.length > 0 ? `${action.label} ${suffix}` : action.label

  return (
    <Link
      href={action.href}
      className={classNames(size === 'sm' ? PRIMARY_CLASSES_SM : PRIMARY_CLASSES, className)}
      data-primary-action={action.label}
    >
      <Icon className={size === 'sm' ? 'size-4' : 'size-5'} aria-hidden="true" />
      {label}
    </Link>
  )
}
