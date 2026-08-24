'use client'

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Player, CastEnterIcon } from './videojs'
import { useCastAdoption } from '@components/Cast/useCastSession'

/**
 * The banner itself. Split out so its animation only mounts when there is
 * something to say.
 */
function CastingBanner({ connecting, deviceName, titleLabel }) {
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
 * frame is replaced with the destination. Controls sit at z-10 and stay usable,
 * and this is pointer-events-none so gestures still reach the surface
 * underneath.
 *
 * Two ways to be casting, and both must be handled. The player store knows
 * about a session THIS player started. It knows nothing about one that was
 * already running when the page mounted — adoption in the framework is
 * event-driven and never re-checked on mount — so that case is read from the
 * Cast SDK directly, which is the only thing that survives navigation.
 */
export default function CastingOverlay({ titleLabel, videoURL }) {
  const remoteState = Player.usePlayer((s) => s.remotePlaybackState)
  const { adopted, connecting, deviceName } = useCastAdoption(videoURL)

  const isCasting = remoteState === 'connected' || remoteState === 'connecting' || adopted

  return (
    <AnimatePresence>
      {isCasting ? (
        <CastingBanner
          key="casting"
          connecting={remoteState === 'connecting' || (connecting && !adopted)}
          deviceName={deviceName}
          titleLabel={titleLabel}
        />
      ) : null}
    </AnimatePresence>
  )
}
