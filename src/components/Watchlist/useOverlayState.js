'use client'

import { useState, useRef, useCallback } from 'react'

/**
 * Open/closed state for a Headless UI overlay (the playlist drawer, a bottom
 * sheet), plus `closeThen(fn)`: close the overlay and run `fn` only once it has
 * finished leaving. Pass `afterLeave` to the overlay's <Transition>.
 *
 * The wait matters for any action that opens another modal. While a Headless UI
 * Dialog is mounted it marks the rest of the page inert, so a modal opened in
 * the same tick as the close would render but ignore every tap.
 */
export default function useOverlayState() {
  const [open, setOpen] = useState(false)
  const pendingRef = useRef(null)

  const show = useCallback(() => {
    // Reopening mid-leave cancels the leave, so its afterLeave never fires; drop
    // the queued action rather than let a later close run it by surprise.
    pendingRef.current = null
    setOpen(true)
  }, [])

  const close = useCallback(() => setOpen(false), [])

  const closeThen = useCallback((fn) => {
    pendingRef.current = fn
    setOpen(false)
  }, [])

  const afterLeave = useCallback(() => {
    const fn = pendingRef.current
    pendingRef.current = null
    fn?.()
  }, [])

  return { open, show, close, closeThen, afterLeave }
}
