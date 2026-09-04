'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Player } from './videojs'
import { classNames } from '@src/utils'

/**
 * Copy for each verdict, built from the MEASURED ceilings rather than constants.
 *
 * The transcoder's 1080p AVC floor is only guaranteed for ladders generated
 * after epoch 17, and the throughput budget can still shed the 1080 rungs on a
 * loaded box — which is exactly how the confirmed case landed on 720p. Printing
 * the numbers the player actually has makes the notice self-verifying and
 * removes any coupling to the transcoder's release cadence.
 */
const COPY = {
  'gpu-regressed': (v) => ({
    headline: 'Hardware video acceleration is off',
    body:
      `This browser isn't using hardware video decoding, so the ${v.offeredMax}p version of ` +
      `this title can't play here — you're watching at ${v.keptMax}p. ` +
      `Restarting your browser usually fixes it.`,
  }),
  'no-hevc': (v) => ({
    headline: "This browser can't play HEVC",
    body:
      `The ${v.offeredMax}p version of this title is HEVC, which this browser can't decode, ` +
      (v.keptIsAvc
        ? `so you're watching the ${v.keptMax}p AVC version.`
        : `so you're watching at ${v.keptMax}p.`),
  }),
  limited: (v) => ({
    headline: `${v.offeredMax}p isn't available here`,
    body:
      `This browser can't decode the ${v.offeredMax}p version of this title, ` +
      `so you're watching at ${v.keptMax}p.`,
  }),
}

/** Warning glyph, inline like ChaptersIcon in menus.js — no icon package. */
function WarnGlyph({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2.75a1.5 1.5 0 0 1 1.3.76l8.5 15A1.5 1.5 0 0 1 20.5 20.75h-17a1.5 1.5 0 0 1-1.3-2.24l8.5-15a1.5 1.5 0 0 1 1.3-.76Zm0 5a1 1 0 0 0-1 1v4.5a1 1 0 1 0 2 0v-4.5a1 1 0 0 0-1-1Zm0 8.25a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 0 0 0-2.3Z" />
    </svg>
  )
}

/**
 * The compact reminder, a flex child of the top-right metadata rail.
 *
 * Sits in the same visual register as the resolution badge below it and takes
 * the `playing` class like both of its siblings, so once the modal has been
 * read this is paused-state chrome — present when the viewer looks, absent
 * while they watch. Clicking it brings the full explanation back.
 */
export function DecodeHealthChip({ verdict, isPaused, onOpen }) {
  if (!verdict) return null

  return (
    // No `hidden sm:block` here — the rail owns the breakpoint (globals.css),
    // and `hidden` would win over a rule that never sets `display`.
    <span className={classNames('media-decode font-sans', isPaused ? '' : 'playing')} role="status">
      <button
        type="button"
        onClick={onOpen}
        title="Why is this limited?"
        className={classNames(
          'flex h-[30px] items-center gap-1.5 rounded border border-amber-400/25 bg-amber-400/15 px-3',
          'text-sm font-medium text-amber-200 outline-none ring-inset ring-blue-400 backdrop-blur-sm',
          'transition-colors hover:bg-amber-400/25 focus-visible:ring-2',
          // Controls.Root stamps data-interactive on itself and the tap gesture
          // bails on target.closest('[data-interactive]'), so an always-on
          // pointer target here would turn the top-right corner into an
          // invisible tap-to-pause dead zone — opacity-0 elements still
          // hit-test. Only accept the pointer while the controls are up.
          'pointer-events-none group-data-[visible]:pointer-events-auto'
        )}
      >
        <WarnGlyph className="h-4 w-4 shrink-0" />
        <span>Limited to {verdict.keptMax}p</span>
      </button>
    </span>
  )
}

/**
 * The one-time explanation.
 *
 * Rendered inside Player.Container rather than portalled to the body, because
 * the fullscreen feature requests fullscreen on the CONTAINER — anything
 * outside it is invisible the moment the viewer goes fullscreen, which is when
 * a 4K title is most likely being watched.
 *
 * It never pauses playback. It does take keyboard focus, and that is why the
 * root stops keydown propagation: the hotkey coordinator listens on the
 * container and only exempts Space/Enter on buttons, so `f`, `m`, `c` and the
 * arrows would otherwise still drive the player from inside the dialog.
 */
export function DecodeHealthModal({ verdict, open, delayMs = 0, onClose }) {
  const reduceMotion = useReducedMotion()
  const started = Player.usePlayer((state) => state.started)
  const [delayElapsed, setDelayElapsed] = useState(false)
  const overlayRef = useRef(null)
  const dialogRef = useRef(null)
  const restoreFocusRef = useRef(null)

  // Hold the modal back until the title/logo intro choreography has finished
  // (~2s of staggered transitions in globals.css) so the two don't collide.
  // Reopening from the chip passes delayMs 0 and skips the wait entirely.
  useEffect(() => {
    if (delayMs === 0 || !open || !started) return undefined
    const timer = setTimeout(() => setDelayElapsed(true), delayMs)
    return () => clearTimeout(timer)
  }, [open, started, delayMs])

  const visible = open && Boolean(verdict) && (delayMs === 0 || delayElapsed)

  // Focus in on open, back where it was on close. Deliberately separate from
  // the key handling below so a new `onClose` identity cannot re-run this and
  // yank focus out of a dialog the viewer is still reading.
  useEffect(() => {
    if (!visible) return undefined
    restoreFocusRef.current = document.activeElement
    dialogRef.current?.focus()
    return () => {
      const restore = restoreFocusRef.current
      if (restore instanceof HTMLElement && restore.isConnected) restore.focus()
    }
  }, [visible])

  // A NATIVE listener on the overlay, not React's onKeyDown. React attaches its
  // own listener at the app's root container, while the hotkey coordinator
  // attaches one directly to Player.Container — which sits between this overlay
  // and that root. The coordinator therefore sees the event first, and a
  // synthetic stopPropagation would arrive far too late to stop `f`, `m`, `c`
  // and the arrow keys from driving the player while the viewer is reading the
  // dialog. Bubbling from a descendant beats it. (Space and Enter are already
  // exempt: the coordinator skips activation keys on buttons, which is where
  // focus lands.)
  useEffect(() => {
    if (!visible) return undefined
    const overlay = overlayRef.current
    const onKeyDown = (event) => {
      event.stopPropagation()
      if (event.key === 'Escape') onClose()
    }
    overlay?.addEventListener('keydown', onKeyDown)
    return () => overlay?.removeEventListener('keydown', onKeyDown)
  }, [visible, onClose])

  if (!visible) return null

  const { headline, body } = (COPY[verdict.tier] ?? COPY.limited)(verdict)

  return (
    <AnimatePresence>
      <motion.div
        key="decode-health"
        ref={overlayRef}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reduceMotion ? 0.15 : 0.3, ease: 'easeOut' }}
        // Exempts the whole overlay from tap-to-pause, backdrop included: the
        // gesture coordinator bails on closest('[data-interactive]').
        data-interactive=""
        className="absolute inset-0 z-40 flex items-center justify-center bg-black/50 px-6 backdrop-blur-[2px]"
        onClick={onClose}
      >
        <motion.div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="decode-health-headline"
          aria-describedby="decode-health-body"
          tabIndex={-1}
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: reduceMotion ? 0.15 : 0.3, ease: 'easeOut' }}
          onClick={(event) => event.stopPropagation()}
          className={classNames(
            'w-[min(30rem,90vw)] rounded-lg border border-white/10 bg-black/95 p-5 font-sans',
            'text-left shadow-2xl outline-none'
          )}
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-400/15 text-amber-300">
              <WarnGlyph className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="decode-health-headline" className="text-base font-semibold text-white">
                {headline}
              </h2>
              <p id="decode-health-body" className="mt-1.5 text-sm leading-relaxed text-gray-300">
                {body}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Dismiss"
              className="-mr-1 -mt-1 shrink-0 rounded p-1.5 text-xl leading-none text-gray-400 outline-none ring-inset ring-blue-400 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2"
            >
              ×
            </button>
          </div>
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded bg-white/10 px-4 py-1.5 text-sm font-medium text-white outline-none ring-inset ring-blue-400 transition-colors hover:bg-white/20 focus-visible:ring-2"
            >
              Got it
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
