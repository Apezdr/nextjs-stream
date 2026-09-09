'use client'

import { forwardRef, useEffect, useState } from 'react'
import { Player, SpinnerIcon } from './videojs'
import usePlaybackPhase from './usePlaybackPhase'
import { isManifestSource } from './PlayerMedia'

/**
 * The one loading/buffering surface on the watch page, replacing the
 * framework's <BufferingIndicator>.
 *
 * Why it exists: the framework indicator is `store.waiting && !store.paused`.
 * That is silent for exactly the two moments a viewer most needs to be told
 * something — the cold start (nothing is playing yet, so nothing is
 * "waiting"), and a deferred play() on a cold element (paused, so again
 * nothing). Against a just-in-time origin the first segment of a title is
 * ENCODED on request, so a cold start is routinely 3-6 s and a deep resume
 * seek 10-15 s. With no indicator that reads as broken.
 *
 * What it says, and why it escalates: a spinner alone is honest for the
 * first few seconds. Past that the viewer deserves to know the wait is the
 * server working, not the player hanging — and past ~25 s that the wait is
 * still legitimate (the transcoder's own stall watchdog is 27 s; hls.js
 * retries a fragment for 30 s before giving up). Copy is chosen by phase and
 * elapsed time only; the JIT origin is inferred from the served URL.
 *
 * Reads the element via usePlaybackPhase — never the store (see that file).
 * Stamps `data-visible` while shown (usePlaybackDiagnostics watches it) and
 * `data-phase` for tests and CSS. Hidden while casting: the casting banner
 * shares this centre and the television draws its own spinner.
 */

const ARM_DELAY_MS = 500 // no flash on a sub-second hiccup
const TICK_MS = 1000

function copyFor(phase, elapsedMs, jit) {
  const s = elapsedMs / 1000
  if (phase === 'error') return { title: 'Playback failed', hint: 'Reload the page to try again.' }
  if (phase === 'starting') {
    if (s < 3) return null
    if (jit) {
      if (s < 10) return { title: 'Preparing this title', hint: null }
      if (s < 25) return { title: 'Preparing this title', hint: 'The server is encoding it for the first time.' }
      return { title: 'Still preparing', hint: 'Large files take longer on first play. This is normal.' }
    }
    if (s < 10) return { title: 'Loading', hint: null }
    return { title: 'Still loading', hint: null }
  }
  if (phase === 'buffering') {
    if (s < 3) return null
    if (jit && s >= 10) return { title: 'Waiting for the server', hint: 'Encoding the next part of this title.' }
    return { title: 'Buffering', hint: null }
  }
  return null
}

const PlaybackStatusOverlay = forwardRef(function PlaybackStatusOverlay(
  { videoURL, hidden = false, className = '' },
  ref
) {
  const media = Player.useMedia()
  const el = media?.target ?? null
  const { phase, since } = usePlaybackPhase(el)

  const wants = !hidden && (phase === 'starting' || phase === 'buffering' || phase === 'error')

  // Arm delay and a 1 Hz clock for the copy. State, not derived: the delay
  // is time-based, and the element emits nothing while it simply waits.
  // `now` is only ever set from timers (never synchronously in the effect),
  // and any stale value predates `since`, so the first render of a new phase
  // computes elapsed 0 and the arm timeout is what reveals the overlay.
  const [now, setNow] = useState(0)
  useEffect(() => {
    if (!wants) return undefined
    const id = setInterval(() => setNow(Date.now()), TICK_MS)
    const arm = setTimeout(() => setNow(Date.now()), ARM_DELAY_MS)
    return () => {
      clearInterval(id)
      clearTimeout(arm)
    }
  }, [wants, since])

  const elapsed = wants && now > since ? now - since : 0
  const visible = wants && (phase === 'error' || elapsed >= ARM_DELAY_MS)
  const copy = visible ? copyFor(phase, elapsed, isManifestSource(videoURL)) : null

  return (
    <div
      ref={ref}
      role="status"
      aria-live="polite"
      data-phase={phase}
      {...(visible ? { 'data-visible': '' } : {})}
      className={`pointer-events-none absolute left-1/2 top-1/2 z-20 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3 opacity-0 transition-opacity duration-200 data-[visible]:opacity-100 ${className}`}
    >
      {phase === 'error' ? (
        <div className="h-16 w-16 rounded-full border-2 border-white/80 text-center text-3xl leading-[3.6rem] text-white/90">
          !
        </div>
      ) : (
        <SpinnerIcon className="h-16 w-16 animate-spin text-white/90" />
      )}
      {copy ? (
        <div className="max-w-xs text-center font-sans drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
          <div className="text-base font-semibold text-white">{copy.title}</div>
          {copy.hint ? <div className="mt-1 text-sm text-white/75">{copy.hint}</div> : null}
        </div>
      ) : null}
    </div>
  )
})

export default PlaybackStatusOverlay
