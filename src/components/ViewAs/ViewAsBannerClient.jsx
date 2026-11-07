'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react'
import { EyeIcon, PencilSquareIcon } from '@heroicons/react/24/outline'
import { toast } from 'react-toastify'
import { reloadOnViewAsSwitch, setViewAsWrites, signOutOfViewAs, stopViewAs } from './viewAsClient'

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
 * Asks before writes go on: from then on what the admin does lands on the
 * user's account. In the page, never window.confirm. Turning writes off needs
 * no asking.
 */
function ConfirmWrites({ open, viewingAs, onConfirm, onCancel }) {
  return (
    <Dialog open={open} onClose={onCancel} className="relative z-50">
      <DialogBackdrop className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="w-full max-w-sm rounded-2xl bg-[#0f1633] p-6 shadow-2xl ring-1 ring-white/10">
          <DialogTitle className="text-lg font-semibold text-white">Write as {viewingAs}?</DialogTitle>
          <p className="mt-2 text-sm text-white/75">
            What you do from now on lands on {viewingAs}’s account: watch progress and watched marks, watchlists and
            playlists, notifications, and Radarr or Sonarr requests. Sign-in, account and device changes stay blocked.
          </p>
          <p className="mt-2 text-sm text-white/75">It lasts until you turn it off or stop viewing as.</p>
          <div className="mt-5 flex justify-end gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-full px-4 py-2 text-sm font-semibold text-white/80 outline-none ring-white/60 hover:text-white focus-visible:ring-2"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white outline-none ring-white/60 hover:bg-red-500 focus-visible:ring-2"
            >
              Allow writes
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}

/**
 * The bar, from the server's session (ViewAsBanner): viewingAs is the user's
 * name, or null in an admin's tab, which only listens for another tab's start
 * or stop and reloads. writesOn is the session's setting; the switch changes
 * it on the server and reloads.
 */
export default function ViewAsBannerClient({ viewingAs, writesOn = false }) {
  const pathname = usePathname()
  const [busy, setBusy] = useState(false)
  // Stop failed: signing out is the way out that's left
  const [stuck, setStuck] = useState(false)
  const [confirming, setConfirming] = useState(false)

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

  const switchWrites = async (enabled) => {
    setConfirming(false)
    setBusy(true)
    const result = await setViewAsWrites(enabled)
    if (result.ok) return // the page reloads
    toast.error(`Couldn’t turn writes ${enabled ? 'on' : 'off'}: ${result.error}`)
    setBusy(false)
  }

  const onSwitch = () => (writesOn ? switchWrites(false) : setConfirming(true))

  const button = [
    'shrink-0 rounded-full bg-black/80 font-semibold outline-none ring-black transition hover:bg-black focus-visible:ring-2 disabled:cursor-wait disabled:opacity-60',
    writesOn ? 'text-red-50' : 'text-amber-100',
    compact ? 'px-2.5 py-1' : 'px-3 py-1.5 text-xs',
  ].join(' ')
  const Icon = writesOn ? PencilSquareIcon : EyeIcon

  // z-[45]: over the page's own fixed bars (the watchlist's selection bar is
  // z-40), under dialogs and bottom sheets (z-50). An open dialog makes the
  // rest of the page inert anyway, so the bar couldn't be used over one, and
  // on a phone it would hide a sheet's last action.
  return (
    <>
      <div
        role="status"
        style={style}
        className={[
          'fixed left-1/2 z-[45] flex max-w-[92vw] -translate-x-1/2 items-center rounded-full border shadow-lg shadow-black/40',
          writesOn ? 'border-red-200/60 bg-red-600 text-white' : 'border-amber-200/60 bg-amber-400 text-black',
          compact
            ? 'gap-2 py-1 pl-3 pr-1 text-xs opacity-80 transition-opacity hover:opacity-100 focus-within:opacity-100'
            : 'gap-3 py-1.5 pl-4 pr-1.5 text-sm',
        ].join(' ')}
      >
        <Icon className={compact ? 'h-3.5 w-3.5 shrink-0' : 'h-4 w-4 shrink-0'} aria-hidden="true" />
        <span className="min-w-0 truncate">
          {writesOn ? 'Writing as' : 'Viewing as'} <span className="font-semibold">{viewingAs}</span>
        </span>
        <span aria-hidden="true">·</span>
        {/* Both states named, the current one bold: on, the bar is red too */}
        <button
          type="button"
          role="switch"
          aria-checked={writesOn}
          onClick={onSwitch}
          disabled={busy}
          title={writesOn ? 'Back to read-only' : 'Let your actions land on this account'}
          className={`${button} flex items-center gap-1`}
        >
          <span className={writesOn ? 'font-normal opacity-60' : ''}>Read-only</span>
          <span aria-hidden="true">·</span>
          <span className={writesOn ? '' : 'font-normal opacity-60'}>Writes on</span>
        </button>
        <button type="button" onClick={stop} disabled={busy} className={button}>
          Stop
        </button>
        {stuck ? (
          <button type="button" onClick={signOut} disabled={busy} className={button}>
            Sign out
          </button>
        ) : null}
      </div>
      <ConfirmWrites
        open={confirming}
        viewingAs={viewingAs}
        onConfirm={() => switchWrites(true)}
        onCancel={() => setConfirming(false)}
      />
    </>
  )
}
