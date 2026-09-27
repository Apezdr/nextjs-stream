'use client'

import { Dialog, DialogBackdrop, DialogPanel, DialogTitle, Transition } from '@headlessui/react'
import { classNames } from '@src/utils'

/**
 * True when a menu should open as a bottom sheet instead of an anchored
 * dropdown: below Tailwind's `lg` breakpoint (where the watchlist drops its
 * sidebar), or on a device with no hover, i.e. touch. Read at click time, so
 * the server and client render the same markup and nothing needs reconciling.
 */
export function prefersSheet() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(max-width: 1023px), (hover: none)').matches
}

/**
 * A panel that slides up from the bottom of the screen: the watchlist's mobile
 * stand-in for its dropdown menus. Headless UI Dialog, so focus is trapped,
 * Escape or a backdrop tap closes it, and the page behind it can't scroll.
 *
 * `afterLeave` runs once the sheet has finished sliding away; see
 * useOverlayState's `closeThen` for why actions that open a modal wait for it.
 */
export default function BottomSheet({ open, onClose, afterLeave, title, description, children }) {
  return (
    <Transition show={open} afterLeave={afterLeave}>
      <Dialog onClose={onClose} className="relative z-50">
        <DialogBackdrop
          transition
          className="fixed inset-0 bg-black/60 transition-opacity duration-200 ease-out data-[closed]:opacity-0"
        />
        <div className="fixed inset-x-0 bottom-0 flex justify-center">
          <DialogPanel
            transition
            className={classNames(
              'w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-t-2xl bg-gray-800 shadow-2xl ring-1 ring-white/10',
              'pb-[max(0.75rem,env(safe-area-inset-bottom))]',
              'transition-transform duration-200 ease-out data-[closed]:translate-y-full'
            )}
          >
            <div className="px-4 pb-2 pt-3">
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-gray-600" aria-hidden="true" />
              {title && <DialogTitle className="truncate text-base font-semibold text-white">{title}</DialogTitle>}
              {description && <p className="mt-0.5 truncate text-sm text-gray-400">{description}</p>}
            </div>
            {children}
          </DialogPanel>
        </div>
      </Dialog>
    </Transition>
  )
}

/** One full-width row in a sheet's action list. */
export function SheetAction({ onClick, icon, children, tone = 'default', disabled = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={classNames(
        'flex w-full items-center gap-3 px-4 py-3 text-left text-base transition-colors active:bg-gray-700 disabled:opacity-50',
        tone === 'danger' && 'text-red-400',
        tone === 'accent' && 'text-blue-400',
        tone === 'warning' && 'text-orange-400',
        tone === 'default' && 'text-gray-100'
      )}
    >
      {icon && <span className="flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden="true">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  )
}
