'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

/** How long the pointer has to rest on a link before it counts as intent. */
const HOVER_DWELL_MS = 120

/**
 * A link that prefetches its full destination only once someone shows intent.
 *
 * For grids and lists. With Partial Prefetching every link already gets the
 * route's shared shell (the page skeleton) for free, once per route.
 * <Link prefetch={true}> adds the link's own content, but costs a server render
 * PER VISIBLE LINK, so on a grid of hundreds of posters it renders hundreds of
 * pages nobody opens. Here the link stays on the default until someone rests
 * the pointer on it, focuses it or touches it, then asks for the full prefetch
 * for that one destination.
 *
 * Hover waits HOVER_DWELL_MS first: a pointer crossing a list on its way
 * somewhere else passes over many links, and each one would be a server
 * render. Focus and touch are deliberate, so they count at once.
 *
 * Follows the hover-triggered pattern in Next's prefetching guide. Takes the
 * same props as next/link; safe to render from a Server Component as long as
 * the props are serializable (no handlers).
 */
export default function IntentPrefetchLink({ children, onMouseEnter, onMouseLeave, onFocus, onTouchStart, ...props }) {
  const [hasIntent, setHasIntent] = useState(false)
  const dwellTimer = useRef(null)

  useEffect(() => () => clearTimeout(dwellTimer.current), [])

  return (
    <Link
      {...props}
      prefetch={hasIntent ? true : undefined}
      onMouseEnter={(event) => {
        if (!hasIntent) dwellTimer.current = setTimeout(() => setHasIntent(true), HOVER_DWELL_MS)
        onMouseEnter?.(event)
      }}
      onMouseLeave={(event) => {
        clearTimeout(dwellTimer.current)
        onMouseLeave?.(event)
      }}
      onFocus={(event) => {
        setHasIntent(true)
        onFocus?.(event)
      }}
      onTouchStart={(event) => {
        setHasIntent(true)
        onTouchStart?.(event)
      }}
    >
      {children}
    </Link>
  )
}
