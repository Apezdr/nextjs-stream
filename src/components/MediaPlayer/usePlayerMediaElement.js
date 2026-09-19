'use client'

import { useEffect, useMemo, useRef } from 'react'

/**
 * True when the element isn't watchable: detached, zero-size, or not rendered.
 *
 * Picture-in-Picture and remote playback (Cast / AirPlay) are deliberately
 * exempt — in both the element is legitimately off-screen while still being
 * the thing the user is watching, and pausing it would be a bug.
 */
function isHidden(el) {
  if (typeof document !== 'undefined' && document.pictureInPictureElement === el) return false
  // Native RemotePlayback (AirPlay). Note this does NOT cover Google Cast:
  // that path swaps `remote` on the media HOST, not on this raw element, so
  // el.remote stays 'disconnected' throughout a cast session. Harmless here —
  // the page is on screen while casting, so isHidden is false anyway.
  if (el.remote?.state === 'connected') return false
  if (!el.isConnected) return true
  const rect = el.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return true
  return typeof el.checkVisibility === 'function' ? !el.checkVisibility() : false
}

/**
 * Whether some other media element is on screen and playing right now — i.e.
 * a hover preview really is speaking for the page.
 *
 * The coordinator's claim alone can't be trusted: a preview claims playback on
 * hover and releases on mouse-leave, but navigating away mid-hover fires no
 * mouse-leave, so the claim latches and would mute the player forever once the
 * user navigates back.
 */
function hasVisiblePlayingPeer(selfEl) {
  for (const el of document.querySelectorAll('video, audio')) {
    if (el !== selfEl && !el.paused && !isHidden(el)) return true
  }
  return false
}

/**
 * Owns the main player's media element.
 *
 * Scope is deliberately small: the player subtree is unmounted while its page
 * is parked in Next's segment cache (see MainVideoPlayer), so this hook does
 * not have to police a hidden-but-alive element. It handles the two things
 * that remain:
 *
 *  1. Teardown — a <video> removed from the DOM keeps its audio alive until
 *     garbage collection, so pause it and release the source on unmount.
 *  2. The hover-preview suppressor — pause while an episode-thumbnail preview
 *     is genuinely playing on screen, and resume when it stops.
 *
 * `wasPlayingRef` records whether the suppressor is what interrupted playback,
 * so a video the user deliberately paused is never resumed behind their back.
 *
 * @param {boolean} previewActive - a hover preview claims playback
 * @returns {Function & { current: HTMLVideoElement|null }} callback ref
 */
export default function usePlayerMediaElement(previewActive) {
  const previewRef = useRef(previewActive)
  const wasPlayingRef = useRef(false)
  const elRef = useRef(null)

  const ref = useMemo(() => {
    function sync() {
      const el = elRef.current
      if (!el) return
      if (previewRef.current && hasVisiblePlayingPeer(el)) {
        if (!el.paused) {
          wasPlayingRef.current = true
          el.pause()
        }
      } else if (wasPlayingRef.current && el.paused && !isHidden(el)) {
        wasPlayingRef.current = false
        el.play().catch(() => {})
      }
    }

    const refFn = (node) => {
      const previous = refFn.current
      if (previous && previous !== node) release(previous)
      refFn.current = node ?? null
      elRef.current = node ?? null
      if (!node) {
        // Unmount. Deferred a tick so React StrictMode's simulated detach —
        // where the node never leaves the document — stays a no-op.
        setTimeout(() => {
          if (refFn.current === previous) return // re-attached: it was ref churn
          release(previous)
        }, 0)
      }
    }

    function release(node) {
      if (!node) return
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
    }

    refFn.current = null
    refFn.sync = sync
    return refFn
  }, [elRef, previewRef, wasPlayingRef])

  // Keep the preview suppressor current and re-evaluate on change.
  useEffect(() => {
    previewRef.current = previewActive
    ref.sync()
  }, [previewActive, ref])

  return ref
}
