'use client'

import { useMemo } from 'react'

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
 * A keyed replacement (detach, then a DIFFERENT node attaches) is an unmount
 * of the old node and is torn down like one: the new node attaching must not
 * call the old one's teardown off.
 *
 * @returns {Function & { current: HTMLVideoElement|null }} callback ref
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
        if (refFn.current === detached) return // re-attached: it was ref churn
        try {
          detached.pause()
        } catch {
          /* already gone */
        }
        if (!detached.isConnected) {
          try {
            detached.removeAttribute('src')
            // load() picks a source again from any <source> children left
            // behind, which would restart the download in a discarded element.
            for (const source of detached.querySelectorAll('source')) source.remove()
            detached.load() // aborts the fetch/decode pipeline and detaches MSE
          } catch {
            /* already torn down */
          }
        }
      }, 0)
    }
    refFn.current = null
    return refFn
  }, [])
}
