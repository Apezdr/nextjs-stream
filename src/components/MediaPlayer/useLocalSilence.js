'use client'

import { useEffect, useRef } from 'react'

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
 * Two things close that window, in order. Clearing the `autoplay` property at
 * mount PREVENTS the start: autoplay is consulted as readyState advances, well
 * after mount, so getting there first means no frame is ever shown. Cancelling
 * the play events is the backstop for anything that begins playback another
 * way. Together the worst case is a frame rather than a video playing
 * underneath the television.
 *
 * The caller decides what `silent` means, and says via `guess` whether it is
 * sure. On a cold load the reason is the localStorage breadcrumb, which can be
 * stale; once the SDK confirms a session it is certain. That distinction
 * decides what happens when silence lifts:
 *
 *  - a wrong guess should be undone, since the page was asked to autoplay and
 *    was held back for nothing;
 *  - a confirmed session ending should NOT start playing. Stopping a cast is a
 *    stop, not a transfer of playback to this screen.
 *
 * Either way a video the user paused themselves is never started behind their
 * back, because only suppression this hook caused is ever undone.
 */
export default function useLocalSilence(videoRef, silent, guess = false) {
  // null when we are not the reason it is paused, otherwise why we paused it.
  const suppressedRef = useRef(null)

  useEffect(() => {
    const el = videoRef?.current
    if (!el) return undefined

    if (!silent) {
      const reason = suppressedRef.current
      suppressedRef.current = null
      if (reason === 'guess') {
        el.play?.().catch(() => {
          /* autoplay policy, or the source went away */
        })
      }
      return undefined
    }

    suppressedRef.current = guess ? 'guess' : 'confirmed'

    // Clearing the property is what PREVENTS the start rather than cancelling
    // it: autoplay is consulted as readyState advances, which is well after
    // mount, so getting here first means no frame is ever shown. The listeners
    // below remain as a backstop for anything that starts playback another way
    // (hls.js attaching, a gesture that lands before the state settles).
    // removeAttribute rather than `el.autoplay = false`: the IDL attribute
    // reflects the content attribute so the effect is identical, and the
    // React Compiler forbids assigning to a property of a hook argument.
    try {
      el.removeAttribute('autoplay')
    } catch {
      /* not a media element any more */
    }

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
  }, [videoRef, silent, guess])
}
