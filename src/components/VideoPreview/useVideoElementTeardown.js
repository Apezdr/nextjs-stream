'use client'

import { useMemo, useRef } from 'react'

/**
 * Stops playback when a <video> stops being managed, and releases the media
 * pipeline when it is really gone.
 *
 * Two distinct cases, both of which leak audio if ignored:
 *  - The page is parked in Next 16's segment cache. React detaches refs and
 *    runs cleanups (hidden-Activity semantics) while the DOM stays in the
 *    document — a playing element just keeps playing, now unmanaged.
 *  - The element is truly unmounted. Removing a <video> from the DOM does not
 *    pause it; audio survives until garbage collection.
 *
 * So: always pause on detach, and additionally release the source when the
 * node has actually left the document. The work is deferred a tick so ref
 * churn from a re-render (detach immediately followed by re-attach of the
 * same node) doesn't interrupt playback.
 *
 * @returns {Function & { current: HTMLVideoElement|null }} callback ref
 */
export default function useVideoElementTeardown() {
  // Mutable timer handle lives in a ref (not a closure variable) so the
  // React Compiler can reason about this hook.
  const pendingRef = useRef(null)

  return useMemo(() => {
    const refFn = (element) => {
      if (element) {
        if (pendingRef.current) {
          clearTimeout(pendingRef.current)
          pendingRef.current = null
        }
        refFn.current = element
        return
      }

      const detached = refFn.current
      refFn.current = null
      if (!detached) return

      pendingRef.current = setTimeout(() => {
        pendingRef.current = null
        if (refFn.current === detached) return // re-attached: it was ref churn
        try {
          detached.pause()
        } catch {
          /* already gone */
        }
        if (!detached.isConnected) {
          try {
            detached.removeAttribute('src')
            detached.load() // aborts the fetch/decode pipeline and detaches MSE
          } catch {
            /* already torn down */
          }
        }
      }, 0)
    }
    refFn.current = null
    return refFn
  }, [pendingRef])
}
