'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import useCastSession, { endCastSession } from './useCastSession'
import { CastEnterIcon } from '@components/MediaPlayer/videojs'

const isWatchPage = (pathname) =>
  /^\/list\/movie\/[^/]+\/play$/.test(pathname) ||
  /^\/list\/tv\/[^/]+\/\d+\/\d+\/play$/.test(pathname)

/**
 * Where — and whether — the chip belongs on the current route.
 *
 * The only page it must stay off is the casting title's OWN watch page, where
 * the player already shows a casting overlay and owns the cast button; a chip
 * there would duplicate both and sit on the player chrome. Every other page
 * gets it, including a DIFFERENT title's watch page: watching one thing
 * locally while another plays on the television is a perfectly ordinary thing
 * to do, and that is exactly when a way back is most useful.
 *
 * Telling those two watch pages apart needs the route the session was started
 * from. Without it — a session that predates the app recording it — there is no
 * way to know which page is which, so it falls back to staying off all of them.
 *
 * Placement moves because the player's control bar ends bottom-right with the
 * fullscreen button, which a fixed bottom-right chip would cover. Fullscreen
 * itself is unaffected either way: the chip lives outside the player subtree,
 * so it is not painted while the player is the fullscreen element.
 *
 * The top slot is shared with the system status banner, which is also fixed and
 * whose own dismiss button sits top-right. Rather than guess a clearance — the
 * banner's height depends on how far its message wraps — it publishes where it
 * ends as `--system-banner-bottom`, and the chip starts below that.
 *
 * @param {string} pathname
 * @param {string|null} castPath - route recorded when the session started
 * @returns {{ visible: boolean, position: 'top'|'bottom', style: object, offset: number }}
 */
export function castBarPlacement(pathname, castPath) {
  const route = pathname || ''
  const onWatchPage = isWatchPage(route)
  const onCastingPage = castPath ? castPath === route : onWatchPage

  return {
    visible: !onCastingPage,
    position: onWatchPage ? 'top' : 'bottom',
    style: onWatchPage
      ? { top: 'calc(var(--system-banner-bottom, 0px) + 1rem)' }
      : { bottom: '1rem' },
    // Slide in from whichever edge it is anchored to.
    offset: onWatchPage ? -12 : 12,
  }
}

/**
 * Persistent "casting" chip with a stop control.
 *
 * A Cast session outlives the page that started it — the player framework
 * never ends one, and the receiver keeps playing after navigation or tab
 * close. Without this the session is orphaned: the TV plays on with nothing in
 * the app showing it or able to stop it, because the player store forgets the
 * session the moment the player unmounts.
 *
 * Mounted in ClientProviders, which is one of the few wrappers that genuinely
 * survives route changes (the root template remounts on every navigation).
 */
export default function CastSessionBar() {
  const pathname = usePathname()
  const { active, deviceName, title, path } = useCastSession()
  const reduceMotion = useReducedMotion()

  const placement = castBarPlacement(pathname, path)
  const visible = active && placement.visible
  // The route the session was started from, recorded by the player. Absent for
  // a session that predates this being remembered, so the control is offered
  // only when there is somewhere real to go.
  const canReturn = Boolean(path) && path !== pathname

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          key="cast-session-bar"
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: placement.offset }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: placement.offset }}
          transition={{ duration: reduceMotion ? 0.15 : 0.28, ease: 'easeOut' }}
          style={placement.style}
          className="fixed right-4 z-[60] flex max-w-[92vw] items-center gap-3 rounded-full border border-white/10 bg-black/85 py-2 pl-4 pr-2 text-white shadow-lg backdrop-blur-sm"
          role="status"
        >
          <CastEnterIcon className="h-5 w-5 shrink-0 text-white/90" aria-hidden="true" />
          <div className="min-w-0 text-sm leading-tight">
            <p className="truncate font-medium">
              {deviceName ? `Casting to ${deviceName}` : 'Casting'}
            </p>
            {title ? <p className="truncate text-xs text-white/60">{title}</p> : null}
          </div>
          {canReturn ? (
            <Link
              href={path}
              aria-label={
                title ? `Open the player for ${title}` : 'Open the player for what is casting'
              }
              className="shrink-0 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold outline-none ring-blue-400 transition hover:bg-white/20 focus-visible:ring-2"
            >
              Open
            </Link>
          ) : null}
          <button
            type="button"
            onClick={endCastSession}
            className="shrink-0 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold outline-none ring-blue-400 transition hover:bg-white/20 focus-visible:ring-2"
          >
            Stop
          </button>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
