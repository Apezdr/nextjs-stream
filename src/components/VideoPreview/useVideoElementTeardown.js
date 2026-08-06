'use client'

import { useMemo } from 'react'

/**
 * Stops playback and releases the media pipeline when a <video> element is
 * REALLY removed from the document.
 *
 * Removing a video element from the DOM does NOT pause it — a playing element
 * keeps its audio (and network/decode pipeline) alive until garbage
 * collection, and references held by player stores delay that indefinitely.
 * The result is ghost audio layered under the next mount.
 *
 * Implemented as a callback ref (React invokes it with null at detach — the
 * exact teardown moment, including key-based element swaps). The teardown is
 * deferred a tick and gated on `isConnected` so React StrictMode's simulated
 * unmount/remount (where the DOM node never leaves the document) doesn't nuke
 * the src out from under the surviving instance.
 *
 * The returned function also maintains a `.current` property so callers can
 * keep using it like a regular ref object for imperative access.
 *
 * @returns {Function & { current: HTMLVideoElement|null }} hybrid ref
 */
export default function useVideoElementTeardown() {
  return useMemo(() => {
    const refFn = (element) => {
      if (element) {
        refFn.current = element
        return
      }
      const detached = refFn.current
      refFn.current = null
      if (!detached) return
      setTimeout(() => {
        // Still in the document => StrictMode's simulated detach; leave it be.
        if (detached.isConnected) return
        try {
          detached.pause()
          detached.removeAttribute('src')
          detached.load() // aborts the fetch/decode pipeline and detaches MSE
        } catch {
          /* already torn down */
        }
      }, 0)
    }
    refFn.current = null
    return refFn
  }, [])
}
