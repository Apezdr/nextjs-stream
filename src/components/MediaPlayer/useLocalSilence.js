'use client'

import { useEffect } from 'react'

/**
 * Keeps the local <video> quiet while the television owns this title.
 *
 * This is the backstop for the one case the other two layers cannot cover.
 * Normally two things already prevent local playback during an adopted cast
 * session: the transport bridge routes every control to the receiver, and the
 * `autoplay` attribute is suppressed. Both depend on knowing we are casting at
 * the moment the element mounts, which holds for an in-app navigation — the
 * Cast SDK, its context singleton and the session all survive it, and a
 * RemotePlayerController binds to a live session synchronously in its
 * constructor.
 *
 * A hard reload or a deep link is different: the sender SDK is injected lazily
 * by the player, so `globalThis.cast` does not exist on the first render and
 * nothing *can* know yet. Detection lands a beat later, after the script loads
 * and the session resumes — by which time `autoplay` may already have fired.
 *
 * Removing the attribute after the fact does nothing; it is consulted as
 * readyState advances. Cancelling the play events is what closes the window.
 * Worst case is a fraction of a second of audio rather than a video playing
 * underneath the television.
 */
export default function useLocalSilence(videoRef, silent) {
  useEffect(() => {
    const el = videoRef?.current
    if (!el || !silent) return undefined

    const stop = () => {
      try {
        if (!el.paused) el.pause()
      } catch {
        /* already torn down */
      }
    }

    stop() // it may have started before we knew
    el.addEventListener('play', stop)
    el.addEventListener('playing', stop)

    return () => {
      el.removeEventListener('play', stop)
      el.removeEventListener('playing', stop)
    }
  }, [videoRef, silent])
}
