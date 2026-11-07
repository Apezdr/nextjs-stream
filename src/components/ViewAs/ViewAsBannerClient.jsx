'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { EyeIcon } from '@heroicons/react/24/outline'
import { toast } from 'react-toastify'
import { reloadOnViewAsSwitch, signOutOfViewAs, stopViewAs } from './viewAsClient'

const isWatchPage = (pathname) =>
  /^\/list\/movie\/[^/]+\/play$/.test(pathname) || /^\/list\/tv\/[^/]+\/\d+\/\d+\/play$/.test(pathname)

/**
 * Where the bar sits. On a watch page the player's controls run along the
 * bottom, so it moves to the top, below the system status banner (which
 * publishes where it ends as --system-banner-bottom, as the Cast chip reads
 * it), and shrinks to a chip that stays out of the picture until hovered.
 * Like the Cast chip it lives outside the player, so the player's own
 * fullscreen covers it; leaving fullscreen brings it back.
 *
 * @param {string} pathname
 * @returns {{ compact: boolean, style: object }}
 */
export function viewAsBarPlacement(pathname) {
  const compact = isWatchPage(pathname || '')
  return {
    compact,
    style: compact ? { top: 'calc(var(--system-banner-bottom, 0px) + 0.75rem)' } : { bottom: '1rem' },
  }
}

/** Why Stop failed, in words. */
const stopError = (result) =>
  result.status === 401 ? 'This view-as session has already ended.' : `Couldn’t stop viewing as: ${result.error}`

/**
 * The bar, from the server's session (ViewAsBanner): viewingAs is the user's
 * name, or null in an admin's tab, which only listens for another tab's start
 * or stop and reloads.
 */
export default function ViewAsBannerClient({ viewingAs }) {
  const pathname = usePathname()
  const [busy, setBusy] = useState(false)
  // Stop failed: signing out is the way out that's left
  const [stuck, setStuck] = useState(false)

  useEffect(() => reloadOnViewAsSwitch(), [])

  if (!viewingAs) return null
  const { compact, style } = viewAsBarPlacement(pathname)

  const stop = async () => {
    setBusy(true)
    const result = await stopViewAs()
    if (result.ok) return // the page is leaving
    toast.error(stopError(result))
    setStuck(true)
    setBusy(false)
  }

  const signOut = async () => {
    setBusy(true)
    const result = await signOutOfViewAs()
    if (result.ok) return
    toast.error(`Couldn’t sign out: ${result.error}`)
    setBusy(false)
  }

  const button =
    'shrink-0 rounded-full bg-black/80 font-semibold text-amber-100 outline-none ring-black transition hover:bg-black focus-visible:ring-2 disabled:cursor-wait disabled:opacity-60'

  return (
    <div
      role="status"
      style={style}
      className={[
        'fixed left-1/2 z-[60] flex max-w-[92vw] -translate-x-1/2 items-center rounded-full border border-amber-200/60 bg-amber-400 text-black shadow-lg shadow-black/40',
        compact
          ? 'gap-2 py-1 pl-3 pr-1 text-xs opacity-80 transition-opacity hover:opacity-100 focus-within:opacity-100'
          : 'gap-3 py-1.5 pl-4 pr-1.5 text-sm',
      ].join(' ')}
    >
      <EyeIcon className={compact ? 'h-3.5 w-3.5 shrink-0' : 'h-4 w-4 shrink-0'} aria-hidden="true" />
      <span className="min-w-0 truncate">
        Viewing as <span className="font-semibold">{viewingAs}</span>
      </span>
      <span aria-hidden="true">·</span>
      <button
        type="button"
        onClick={stop}
        disabled={busy}
        className={`${button} ${compact ? 'px-2.5 py-1' : 'px-3 py-1.5 text-xs'}`}
      >
        Stop
      </button>
      {stuck ? (
        <button
          type="button"
          onClick={signOut}
          disabled={busy}
          className={`${button} ${compact ? 'px-2.5 py-1' : 'px-3 py-1.5 text-xs'}`}
        >
          Sign out
        </button>
      ) : null}
    </div>
  )
}
