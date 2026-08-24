'use client'

import { useSyncExternalStore } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Player, CastEnterIcon } from './videojs'
import useCastSession from '@components/Cast/useCastSession'

/** The Cast session's device name, or null when unavailable. */
function getDeviceName() {
  try {
    const session = globalThis.cast?.framework?.CastContext?.getInstance?.()?.getCurrentSession?.()
    return session?.getCastDevice?.()?.friendlyName ?? null
  } catch {
    return null
  }
}

function subscribeToCastSession(onChange) {
  try {
    const framework = globalThis.cast?.framework
    const context = framework?.CastContext?.getInstance?.()
    const eventType = framework?.CastContextEventType?.SESSION_STATE_CHANGED
    if (!context || !eventType) return () => {}
    context.addEventListener(eventType, onChange)
    return () => context.removeEventListener(eventType, onChange)
  } catch {
    return () => {}
  }
}

/**
 * The banner itself. Split out so the subscription below is only set up once a
 * session exists — by then the Cast SDK has certainly been injected, so the
 * device name resolves on the first render instead of arriving a beat late.
 */
function CastingBanner({ connecting, titleLabel }) {
  const deviceName = useSyncExternalStore(
    subscribeToCastSession,
    getDeviceName,
    () => null // server render: no Cast session
  )
  const reduceMotion = useReducedMotion()

  // The backdrop settles first (`beforeChildren`), then the contents fade up
  // one at a time — icon, status, title — so the reveal reads in a fixed
  // order rather than everything arriving at once.
  const backdrop = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: reduceMotion
        ? { duration: 0.2 }
        : {
            duration: 0.35,
            ease: 'easeOut',
            when: 'beforeChildren',
            delayChildren: 0.1,
            staggerChildren: 0.14,
          },
    },
    exit: { opacity: 0, transition: { duration: 0.25, ease: 'easeIn' } },
  }

  const item = {
    hidden: reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: reduceMotion ? 0.2 : 0.35, ease: 'easeOut' },
    },
  }

  return (
    <motion.div
      variants={backdrop}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="pointer-events-none absolute inset-0 z-[5] flex flex-col items-center justify-center gap-4 bg-black/80 px-6 text-center backdrop-blur-sm"
    >
      <motion.div variants={item}>
        <CastEnterIcon className="h-16 w-16 text-white/90" />
      </motion.div>
      <motion.p variants={item} className="text-xl font-medium text-white">
        {connecting ? 'Connecting…' : deviceName ? `Casting to ${deviceName}` : 'Casting'}
      </motion.p>
      {titleLabel ? (
        <motion.p variants={item} className="max-w-2xl truncate text-sm text-white/70">
          {titleLabel}
        </motion.p>
      ) : null}
    </motion.div>
  )
}

/**
 * Covers the video while playback is on a Cast device.
 *
 * The local element is not what the user is watching during a session, so the
 * frame is replaced with the destination. Controls sit at z-10 and stay usable
 * (they drive the remote player), and this is pointer-events-none so gestures
 * still reach the surface underneath.
 */
export default function CastingOverlay({ titleLabel, videoURL }) {
  const remoteState = Player.usePlayer((s) => s.remotePlaybackState)
  // The store only knows about sessions THIS player started. Returning to a
  // watch page while a session is live mounts a fresh, disconnected provider
  // (its adoption path is event-driven and never re-checks on mount), so the
  // SDK is asked directly whether the receiver is already playing this title.
  const session = useCastSession()
  const adopted = session.active && !!videoURL && session.contentId === videoURL
  const isCasting = remoteState === 'connected' || remoteState === 'connecting' || adopted

  return (
    <AnimatePresence>
      {isCasting ? (
        <CastingBanner
          key="casting"
          connecting={remoteState === 'connecting'}
          titleLabel={titleLabel}
        />
      ) : null}
    </AnimatePresence>
  )
}
