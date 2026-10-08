'use client'

import { useSyncExternalStore } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { CastEnterIcon } from './videojs'
import useIsCasting from './useIsCasting'
import { readCastNowPlaying, subscribeCastNowPlaying } from '@components/Cast/castSdk'
import { castNowPlayingLabel } from './settingsModel'

/**
 * What the TV is actually playing ("1080p · HDR · 7.8 Mbps"), as the receiver
 * reports it, or null until it does. The receiver adapts on its own, so this
 * is the truth on screen rather than the sender's quality choice. A string
 * snapshot, so a repeated media status is not a re-render.
 */
function useCastNowPlayingLabel() {
  return useSyncExternalStore(
    subscribeCastNowPlaying,
    () => castNowPlayingLabel(readCastNowPlaying()),
    () => null
  )
}

/**
 * The banner itself. Split out so its animation only mounts when there is
 * something to say. Under the title, what the TV is actually playing, once the
 * receiver reports it.
 */
function CastingBanner({ connecting, deviceName, titleLabel }) {
  const reduceMotion = useReducedMotion()
  const nowPlaying = useCastNowPlayingLabel()

  // The backdrop settles first (`beforeChildren`), then the contents fade up
  // one at a time — icon, status, title, quality — so the reveal reads in a fixed
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
      className="pointer-events-none absolute inset-0 z-[5] flex flex-col items-center justify-center gap-4 bg-black/60 px-6 text-center backdrop-blur-md"
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
      {/* Arrives once the receiver reports it, and fades up like the rest. */}
      {nowPlaying && !connecting ? (
        <motion.p
          variants={item}
          className="-mt-2 text-xs font-medium tracking-wide text-white/50 tabular-nums"
        >
          {nowPlaying}
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
 * The backdrop is deliberately not opaque. The video element fades to nothing
 * at the same moment this appears (see PlayerMedia), so during the transition
 * the picture is still visible through it and dissolves away rather than being
 * hidden behind a wall that drops into place. Both halves read the same
 * useIsCasting so they always move together.
 */
export default function CastingOverlay({ titleLabel, videoURL }) {
  const { isCasting, connecting, deviceName } = useIsCasting(videoURL)

  return (
    <AnimatePresence>
      {isCasting ? (
        <CastingBanner
          key="casting"
          connecting={connecting}
          deviceName={deviceName}
          titleLabel={titleLabel}
        />
      ) : null}
    </AnimatePresence>
  )
}
