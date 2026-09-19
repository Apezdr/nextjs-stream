'use client'

import { useLayoutEffect, useRef, useState } from 'react'

/**
 * Whether the surrounding React `<Activity>` boundary is currently visible.
 *
 * Next 16 (`cacheComponents`) does not unmount the page you navigate away
 * from — it parks it in `<Activity mode="hidden">`, which keeps the DOM and
 * state alive, hides it with `display: none`, and runs effect cleanups.
 * React exposes no API for reading that state from inside the subtree, so it
 * is derived from the one thing Activity does drive deterministically:
 * effect lifecycle. Setup means visible; cleanup means hidden.
 *
 * `useLayoutEffect` (not `useEffect`) because the transition is about the UI
 * being visually hidden, so the flip must land synchronously before paint —
 * the same reasoning React and Next give for pausing media in a layout
 * cleanup. Setting state from a cleanup is the pattern Next documents for
 * resetting transient UI (see "Preserving UI state"); hidden trees still
 * re-render, at lower priority.
 *
 * @param {{ withReshown?: boolean }} [options] pass `withReshown` to get the
 *   `{ visible, reshown }` pair instead of the bare boolean
 * @returns {boolean|{ visible: boolean, reshown: boolean }} false while parked
 *   in a hidden Activity boundary; `reshown` is true from the first re-show
 *   on, which is how a caller tells a fresh mount (server props are current)
 *   from a return to a cached page (server props are frozen at render time)
 */
export default function useActivityVisible(options = {}) {
  const [visible, setVisible] = useState(true)
  const [reshown, setReshown] = useState(false)
  // Refs survive hide/show cycles, so this stays true after the first mount
  // and lets us tell a genuine re-show from the initial mount.
  const mountedOnceRef = useRef(false)

  useLayoutEffect(() => {
    if (mountedOnceRef.current) {
      // Re-shown after having been hidden. Setting state here is the point of
      // the hook: Activity gives no other signal, and the one extra render it
      // costs happens only on a re-show. The rule below assumes an effect that
      // could derive its value during render — this one cannot.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVisible(true)
      setReshown(true)
    } else {
      mountedOnceRef.current = true
    }
    return () => setVisible(false)
  }, [])

  return options.withReshown ? { visible, reshown } : visible
}
