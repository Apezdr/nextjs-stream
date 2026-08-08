'use client'

import { useEffect, useMemo, useRef } from 'react'

/** True when the element isn't watchable: detached, zero-size, or not rendered. */
function isHidden(el) {
  if (!el.isConnected) return true
  const rect = el.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return true
  return typeof el.checkVisibility === 'function' ? !el.checkVisibility() : false
}

/**
 * Whether some other media element is on screen and playing right now — i.e.
 * a hover preview really is speaking for the page.
 *
 * The coordinator's claim alone can't be trusted: a preview claims playback
 * on hover and releases on mouse-leave, but navigating away mid-hover fires
 * no mouse-leave, so the claim latches and would mute the player forever
 * once the user navigates back.
 */
function hasVisiblePlayingPeer(selfEl) {
  for (const el of document.querySelectorAll('video, audio')) {
    if (el !== selfEl && !el.paused && !isHidden(el)) return true
  }
  return false
}

/**
 * Owns the main player's media element: its lifecycle AND whether it should
 * be playing.
 *
 * Returns a callback ref for the media element. Everything hangs off that ref
 * because the ref is the one thing React drives reliably here:
 *
 *   Next 16 parks navigated-away pages in its segment cache, which uses
 *   React's hidden-Activity semantics — effects are cleaned up and REFS ARE
 *   DETACHED, but the DOM stays in the document and a playing <video> keeps
 *   playing (verified: detach fires with isConnected true). So ref detach is
 *   the page-hidden signal and ref attach is the page-restored signal.
 *   Correspondingly, nothing may be read from `.current` inside a mount
 *   effect: after a restore that read is stale and the player would run
 *   unmanaged forever.
 *
 * Playback model — USER INTENT × SUPPRESSORS:
 *   intent      — set by any play the hook didn't initiate (autoplay, play
 *                 button, gestures, hotkeys); cleared by any pause it didn't
 *                 initiate. Enforced actions are flagged so they never
 *                 masquerade as user actions. Intent SURVIVES a hide, which
 *                 is what makes back-navigation resume where you left off.
 *   suppressors — hidden (read live off the element, never cached) and
 *                 preview (a hover preview that is actually playing).
 *
 * On real unmount the element is also released: a playing <video> removed
 * from the DOM keeps its audio alive until garbage collection.
 *
 * @param {boolean} previewActive - a hover preview claims playback
 * @returns {Function & { current: HTMLVideoElement|null }} callback ref
 */
export default function usePlayerMediaElement(previewActive) {
  const intentRef = useRef(false)
  const enforcedPauseRef = useRef(false)
  const enforcedPlayRef = useRef(false)
  const previewRef = useRef(previewActive)
  // Mutable wiring state (refs, not closure variables, so the React Compiler
  // can reason about this hook).
  const elRef = useRef(null)
  const observerRef = useRef(null)
  const pendingDetachRef = useRef(null)

  const ref = useMemo(() => {
    function sync() {
      const el = elRef.current
      if (!el) return
      const previewSuppresses = previewRef.current && hasVisiblePlayingPeer(el)
      if (isHidden(el) || previewSuppresses) {
        if (!el.paused) {
          enforcedPauseRef.current = true
          el.pause()
        }
      } else if (intentRef.current && el.paused) {
        enforcedPlayRef.current = true
        el.play().catch(() => {
          enforcedPlayRef.current = false
        })
      }
    }

    const onPlay = () => {
      if (enforcedPlayRef.current) {
        enforcedPlayRef.current = false
      } else {
        intentRef.current = true
      }
      // Correct any play that slips through while suppressed; intent is
      // remembered for when the suppressor lifts.
      sync()
    }

    const onPause = () => {
      if (enforcedPauseRef.current) {
        enforcedPauseRef.current = false
      } else {
        intentRef.current = false
      }
    }

    // Defense in depth while audible (~4/s, no timers, silent when paused).
    const onTimeUpdate = () => {
      const el = elRef.current
      if (el && !el.paused) sync()
    }

    function attach(node) {
      // A detach immediately followed by re-attach of the same node is ref
      // churn from a re-render, not a page hide — cancel the pending stop so
      // playback doesn't stutter.
      if (pendingDetachRef.current) {
        clearTimeout(pendingDetachRef.current)
        pendingDetachRef.current = null
      }
      elRef.current = node
      node.addEventListener('play', onPlay)
      node.addEventListener('pause', onPause)
      node.addEventListener('timeupdate', onTimeUpdate)
      if (typeof ResizeObserver !== 'undefined') {
        observerRef.current?.disconnect()
        const observer = new ResizeObserver(() => sync())
        observer.observe(node)
        observerRef.current = observer
      }
      // Restored page: resume if the user still wants playback.
      sync()
    }

    function detach(node) {
      node.removeEventListener('play', onPlay)
      node.removeEventListener('pause', onPause)
      node.removeEventListener('timeupdate', onTimeUpdate)
      observerRef.current?.disconnect()
      observerRef.current = null
      if (elRef.current === node) elRef.current = null

      pendingDetachRef.current = setTimeout(() => {
        pendingDetachRef.current = null
        if (refFn.current === node) return // re-attached: it was ref churn
        // Page hidden or unmounted. Stop playback — nothing manages this
        // element now and it would keep playing behind the current page.
        // Listeners are already off, so intent is untouched and a later
        // restore resumes.
        try {
          node.pause()
        } catch {
          /* already gone */
        }
        if (!node.isConnected) {
          try {
            node.removeAttribute('src')
            node.load() // aborts fetch/decode and detaches MSE
          } catch {
            /* already torn down */
          }
        }
      }, 0)
    }

    const refFn = (node) => {
      const previous = refFn.current
      if (previous && previous !== node) detach(previous)
      refFn.current = node ?? null
      if (node) attach(node)
    }
    refFn.current = null
    refFn.sync = sync
    return refFn
  }, [elRef, observerRef, pendingDetachRef, intentRef, enforcedPauseRef, enforcedPlayRef, previewRef])

  // Keep the preview suppressor current and re-evaluate on change.
  useEffect(() => {
    previewRef.current = previewActive
    ref.sync()
  }, [previewActive, ref])

  return ref
}
