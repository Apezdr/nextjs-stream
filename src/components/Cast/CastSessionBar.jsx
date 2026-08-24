'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import useCastSession, { endCastSession } from './useCastSession'
import { CastEnterIcon } from '@components/MediaPlayer/videojs'

// The watch page has its own casting overlay and cast button, so the bar would
// duplicate them (and overlap the player chrome) there.
const isWatchPage = (pathname) =>
  /^\/list\/movie\/[^/]+\/play$/.test(pathname) ||
  /^\/list\/tv\/[^/]+\/\d+\/\d+\/play$/.test(pathname)

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

  const visible = active && !isWatchPage(pathname || '')
  // The route the session was started from, recorded by the player. Absent for
  // a session that predates this being remembered, so the control is offered
  // only when there is somewhere real to go.
  const canReturn = Boolean(path) && path !== pathname

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          key="cast-session-bar"
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12 }}
          transition={{ duration: reduceMotion ? 0.15 : 0.28, ease: 'easeOut' }}
          className="fixed bottom-4 right-4 z-[60] flex max-w-[92vw] items-center gap-3 rounded-full border border-white/10 bg-black/85 py-2 pl-4 pr-2 text-white shadow-lg backdrop-blur-sm"
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
