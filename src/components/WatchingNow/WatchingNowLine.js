'use client'

import { useSyncExternalStore } from 'react'
import Link from 'next/link'
import { classNames } from '@src/utils'
import useWatchingNow from './useWatchingNow'
import { MAX_LISTED_SESSIONS, sessionLineParts } from './wording'

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300'

// The second hand for a playing position: re-read once a second, only while
// something is playing. The snapshot is the whole second, stable by value.
function subscribeSecond(onChange) {
  const id = setInterval(onChange, 1000)
  return () => clearInterval(id)
}
function subscribeNever() {
  return () => {}
}
function currentSecond() {
  return Math.floor(Date.now() / 1000)
}
function serverSecond() {
  return 0
}

function StateDot({ playing }) {
  return (
    <span aria-hidden="true" className="relative flex size-2 shrink-0">
      {playing ? <span className="absolute inline-flex size-full rounded-full bg-emerald-400 opacity-60 motion-safe:animate-ping" /> : null}
      <span className={classNames('relative inline-flex size-2 rounded-full', playing ? 'bg-emerald-400' : 'bg-amber-300')} />
    </span>
  )
}

/**
 * "Playing on TV · 41:12": the viewer's own live sessions on this page,
 * under the title on the movie, episode, season and show pages. One line
 * per device (at most three), ranked as every presence surface ranks them:
 * playing before paused, then the newest heartbeat. Nothing at all when
 * nothing is live, and nothing until the first answer, so the cached shell
 * the page is served from never carries it.
 *
 * Pass `mediaId` / `normalizedVideoId` for a movie or an episode, or
 * `showId` (with `seasonNumber` on a season page) for a show; a show or
 * season page also names the episode and links to it, through `show`.
 *
 * @param {Object} props
 * @param {string|null} [props.mediaId]
 * @param {string|null} [props.normalizedVideoId]
 * @param {string|null} [props.showId] - the show's catalog id (FlatTVShows _id)
 * @param {number|null} [props.seasonNumber]
 * @param {{ originalTitle?: string|null, showTitle?: string|null } | null} [props.show] - the show's route key, for the episode links
 * @param {string} [props.className]
 */
export default function WatchingNowLine({
  mediaId = null,
  normalizedVideoId = null,
  showId = null,
  seasonNumber = null,
  show = null,
  className = '',
}) {
  const scope = showId ? (Number.isInteger(seasonNumber) ? 'season' : 'show') : 'title'
  const { sessions, offsetMs } = useWatchingNow({ mediaId, normalizedVideoId, showId, seasonNumber })
  const ticking = sessions.some((session) => session.state === 'playing')
  const second = useSyncExternalStore(ticking ? subscribeSecond : subscribeNever, currentSecond, serverSecond)

  if (sessions.length === 0) return null

  const serverNowMs = second * 1000 + offsetMs
  const listed = sessions.slice(0, MAX_LISTED_SESSIONS).map((session) => sessionLineParts(session, { scope, serverNowMs, show }))
  const more = sessions.length - listed.length

  return (
    <ul aria-label="Watching now" className={classNames('space-y-1 text-sm text-white/85', className)} data-testid="watching-now">
      {listed.map((parts) => (
        <li key={parts.key} className="flex items-center gap-2">
          <StateDot playing={parts.playing} />
          <span className="min-w-0">
            <span className={parts.playing ? 'font-medium text-emerald-200' : 'font-medium text-amber-100'}>{parts.verb}</span>
            {parts.episode ? (
              <>
                {' '}
                {parts.episode.href ? (
                  <Link href={parts.episode.href} className={`rounded font-medium text-white underline-offset-2 hover:underline ${FOCUS_RING}`}>
                    {parts.episode.label}
                  </Link>
                ) : (
                  <span className="font-medium text-white">{parts.episode.label}</span>
                )}
              </>
            ) : null}
            {` on ${parts.device}`}
            {parts.clock ? (
              <>
                {' · '}
                <span className="tabular-nums">{parts.clock}</span>
              </>
            ) : null}
          </span>
        </li>
      ))}
      {more > 0 ? <li className="pl-4 text-white/55">and {more} more</li> : null}
    </ul>
  )
}
