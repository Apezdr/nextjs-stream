'use client'

import { classNames } from '@src/utils'
import { sessionsOnShow, sessionsOnTitle } from '@src/utils/playbackPresence/rules'
import { useOwnLiveSessions } from './ownSessions'
import { badgeParts } from './wording'

/**
 * "Playing" / "Paused" on a card's poster when one of the viewer's own
 * devices is on that title (a movie or an episode card) or on any episode of
 * that show (a show card). The tooltip and screen readers get the sentence:
 * "Playing S2 · E7 on TV". Nothing when nothing is live.
 *
 * Its own small component so only the badge re-renders when the sessions
 * change, never the card around it.
 *
 * @param {Object} props
 * @param {{ mediaId?: string|null, normalizedVideoId?: string|null } | null} [props.title] - a movie or episode card
 * @param {string|null} [props.showId] - a show card: the show's catalog id
 * @param {string} [props.className]
 */
export default function LiveBadge({ title = null, showId = null, className = '' }) {
  const { sessions: own } = useOwnLiveSessions()
  const scope = showId ? 'show' : 'title'
  const sessions = showId ? sessionsOnShow(own, showId) : title ? sessionsOnTitle(own, title) : []
  const parts = badgeParts(sessions, scope)
  if (!parts) return null

  return (
    <span
      title={parts.description}
      data-testid="live-badge"
      className={classNames(
        'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium shadow-lg',
        parts.playing ? 'bg-emerald-600 text-white' : 'bg-amber-300 text-amber-950',
        className
      )}
    >
      <span aria-hidden="true" className={classNames('size-1.5 rounded-full', parts.playing ? 'bg-white motion-safe:animate-pulse' : 'bg-amber-950')} />
      <span aria-hidden="true">{parts.verb}</span>
      <span className="sr-only">{parts.description}</span>
    </span>
  )
}
