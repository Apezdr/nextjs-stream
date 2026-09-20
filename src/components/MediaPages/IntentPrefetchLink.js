'use client'

import Link from 'next/link'
import { useState } from 'react'

/**
 * A link that prefetches its full destination only once someone shows intent.
 *
 * For grids. With Partial Prefetching every link already gets the route's
 * shared shell for free, once per route. <Link prefetch={true}> adds the
 * link's own content, but costs a server render PER VISIBLE LINK, so on a grid
 * of hundreds of posters it renders hundreds of pages nobody opens. Here the
 * link stays on the default until it is hovered, focused or touched, then asks
 * for the full prefetch for that one destination.
 *
 * Follows the hover-triggered pattern in Next's prefetching guide.
 */
export default function IntentPrefetchLink({ children, onMouseEnter, onFocus, onTouchStart, ...props }) {
  const [hasIntent, setHasIntent] = useState(false)

  const withIntent = (handler) => (event) => {
    setHasIntent(true)
    handler?.(event)
  }

  return (
    <Link
      {...props}
      prefetch={hasIntent ? true : undefined}
      onMouseEnter={withIntent(onMouseEnter)}
      onFocus={withIntent(onFocus)}
      onTouchStart={withIntent(onTouchStart)}
    >
      {children}
    </Link>
  )
}
