'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowPathIcon, PlayIcon } from '@heroicons/react/20/solid'
import { classNames } from '@src/utils'
import useWatchPosition from '@components/WatchProgress/useWatchPosition'
import { primaryAction } from '@components/WatchProgress/primaryAction'
import { PRIMARY_CLASSES, PRIMARY_CLASSES_SM } from './Primitives'

// Re-exported for client surfaces that render a matching primary. A server
// component should import it from './Primitives' (see the note there).
export { PRIMARY_CLASSES }

/** How long the button waits for the viewer's position before it says "Play". */
export const PENDING_LABEL_MS = 1500

/**
 * Whether `ms` have passed with `pending` still true. One timeout, armed only
 * while waiting; a page hidden and shown again waits afresh.
 */
function useGaveUpWaiting(pending, ms) {
  const [gaveUp, setGaveUp] = useState(false)
  useEffect(() => {
    if (!pending) return undefined
    const timer = setTimeout(() => setGaveUp(true), ms)
    return () => {
      clearTimeout(timer)
      setGaveUp(false)
    }
  }, [pending, ms])
  return pending && gaveUp
}

const labelWith = (verb, noun) => (typeof noun === 'string' && noun.length > 0 ? `${verb} ${noun}` : verb)

/**
 * The one filled button on a details page: "Play", "Resume", or "Watch
 * again" (which restarts).
 *
 * The details subtree is cached for everyone, so the label is decided on the
 * client from the same position the resume panel reads. Until that position
 * is known the button shows its icon and an empty label, in a slot as wide as
 * its widest label so nothing moves when the word arrives: it never says
 * "Play" and then "Resume". It plays either way (the player finds its own
 * place), and after PENDING_LABEL_MS without an answer it says "Play".
 *
 * A page that already has the viewer's watch history on the server (the show
 * and season pages) passes it as `watchHistory`, so the first paint already
 * says the right verb and a rewatch already links to `?start=0`; that button
 * is never pending and keeps its natural width.
 *
 * With a `noun` the verb names what it plays: "Resume S1 · E1",
 * "Play Episode 3". `restartNoun` is the noun after "Watch again" (defaults
 * to `noun`; '' drops it, so a page can say "Watch again" alone).
 *
 * @param {Object} props
 * @param {string|null} props.videoURL
 * @param {string|null} [props.mediaId]
 * @param {string|null} [props.normalizedVideoId] - the hash of the title's file, as the server gave it
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
  normalizedVideoId = null,
  durationMs = null,
  playHref,
  size = 'lg',
  className = '',
  noun = null,
  restartNoun = noun,
  watchHistory = null,
}) {
  const { progress, settled } = useWatchPosition({ videoURL, mediaId, normalizedVideoId, durationMs, watchHistory })
  const gaveUp = useGaveUpWaiting(!settled, PENDING_LABEL_MS)
  const pending = !settled && !gaveUp
  const action = primaryAction({ progress, playHref })
  const Icon = action.restart ? ArrowPathIcon : PlayIcon
  const label = labelWith(action.label, action.restart ? restartNoun : noun)
  const buttonClasses = classNames(size === 'sm' ? PRIMARY_CLASSES_SM : PRIMARY_CLASSES, className)
  const iconClasses = size === 'sm' ? 'size-4' : 'size-5'

  // The server had the answer: the button was never without its word
  if (watchHistory !== null) {
    return (
      <Link href={action.href} className={buttonClasses} data-primary-action={action.label}>
        <Icon className={iconClasses} aria-hidden="true" />
        {label}
      </Link>
    )
  }

  // Every word the button can say, stacked in one grid cell: the slot is as
  // wide as the widest, whichever one shows
  const words = [labelWith('Play', noun), labelWith('Resume', noun), labelWith('Watch again', restartNoun)]

  return (
    <Link
      href={pending ? playHref : action.href}
      className={buttonClasses}
      data-primary-action={pending ? 'pending' : action.label}
      aria-label={pending ? words[0] : label}
    >
      <Icon className={iconClasses} aria-hidden="true" />
      <span className="grid justify-items-start" aria-hidden="true">
        {words.map((word, index) => (
          <span key={index} className={classNames('col-start-1 row-start-1', !pending && word === label ? '' : 'invisible')}>
            {word}
          </span>
        ))}
      </span>
    </Link>
  )
}
