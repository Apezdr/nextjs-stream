'use client'

import { useEffect, useState } from 'react'
import { Menu, useContainer } from './videojs'
import { classNames } from '@src/utils'

/**
 * The player's side drawer, shared by Settings and Chapters: a menu whose popup
 * is docked to the player's right edge at full height, or a bottom sheet on
 * portrait phones.
 *
 * The popup is a top-layer popover that the menu positions next to its button
 * with inline styles. `.player-drawer` (player.css) overrides them with
 * !important to dock it instead, at offsets measured from the player container
 * while open. The player is `aspect-video max-h-dvh`, not the viewport, so a
 * viewport dock would miss it on any window that isn't 16:9. The drawer covers
 * the right end of the control bar while open, as players' drawers do; the
 * close button, Escape or a click on the video dismisses it.
 */

/** CSS variables that dock the drawer to the player's box while it is open. */
function useDockStyle(open) {
  const container = useContainer()
  const [box, setBox] = useState(null)

  useEffect(() => {
    if (!open || !container) return undefined
    const measure = () => {
      const rect = container.getBoundingClientRect()
      setBox({
        top: rect.top,
        right: window.innerWidth - rect.right,
        bottom: window.innerHeight - rect.bottom,
      })
    }
    // A ResizeObserver reports once on observe, so this also takes the first
    // measurement.
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [open, container])

  if (!box) return undefined
  return {
    '--dock-top': `${Math.max(0, box.top)}px`,
    '--dock-right': `${Math.max(0, box.right)}px`,
    '--dock-bottom': `${Math.max(0, box.bottom)}px`,
  }
}

// Below the sm breakpoint the drawer is a content-height bottom sheet.
const SHEET_QUERY = '(max-width: 639.98px)'

/**
 * The bottom sheet's height, following the page on top so it can animate.
 *
 * Every page shares one grid cell, so left alone the sheet is as tall as the
 * tallest page mounted: it jumped up the moment a taller page mounted, before
 * that page had slid in, and snapped down when it unmounted after sliding out.
 * Instead the sheet gets an explicit pixel height (which transitions in every
 * browser; `auto` does not), set to the natural height of the page arriving or
 * staying, so it grows and shrinks in step with the push. On phones the pages
 * are `self-start`, so each one's box is its content (capped at the sheet);
 * past the cap its list scrolls, and the overflow is counted back in. Null on
 * the drawer, whose height comes from the dock.
 */
function useSheetHeight(popup) {
  const [height, setHeight] = useState(null)

  useEffect(() => {
    if (!popup) return undefined
    const sheet = window.matchMedia(SHEET_QUERY)
    const naturalHeight = (page) => {
      const list = page.querySelector(':scope > .drawer-list')
      return page.offsetHeight + (list ? list.scrollHeight - list.clientHeight : 0)
    }
    const measure = () => {
      if (!sheet.matches) return setHeight(null)
      const pages = [...popup.children]
      const arriving = pages.filter((p) => p.hasAttribute('data-submenu') && !p.hasAttribute('data-ending-style')).pop()
      const page = arriving ?? pages.find((p) => !p.hasAttribute('data-submenu'))
      // Clamped to the sheet's own max-height, so a long list's growth ends
      // where the sheet does instead of easing toward a height it never shows.
      // The height is border-box, so the sheet's own border is added back.
      const cap = parseFloat(getComputedStyle(popup).maxHeight) || Infinity
      const border = popup.offsetHeight - popup.clientHeight
      if (page) setHeight(Math.min(naturalHeight(page) + border, cap))
    }
    // Pages resize as their rows change; a page mounting, or starting to
    // leave, changes which one the sheet follows. A ResizeObserver reports on
    // observe, which also takes the first measurement.
    const resize = new ResizeObserver(measure)
    const observePages = () => {
      resize.disconnect()
      for (const page of popup.children) resize.observe(page)
    }
    const mutations = new MutationObserver(() => {
      observePages()
      measure()
    })
    mutations.observe(popup, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-ending-style'] })
    observePages()
    sheet.addEventListener('change', measure)
    return () => {
      resize.disconnect()
      mutations.disconnect()
      sheet.removeEventListener('change', measure)
    }
  }, [popup])

  return height
}

/**
 * Wires a Menu.Root + Menu.Popup up as the drawer:
 * `const { onOpenChange, setPopup, style } = useDrawer()`, then
 * `<Menu.Root onOpenChange={onOpenChange}>` and
 * `<Menu.Popup ref={setPopup} className={drawerClass} style={style}>`.
 * Destructure it: the React Compiler treats an object holding a ref as a
 * ref, so reading its other fields during render would be flagged.
 */
export function useDrawer() {
  const [open, setOpen] = useState(false)
  const [popup, setPopup] = useState(null)
  const dockStyle = useDockStyle(open)
  const sheetHeight = useSheetHeight(popup)
  return {
    onOpenChange: (next) => setOpen(next),
    setPopup,
    style: sheetHeight == null ? dockStyle : { ...dockStyle, height: `${sheetHeight}px` },
  }
}

export const drawerClass = classNames(
  // A one-cell grid: every page sits in the same cell, so during a drill-in
  // the page leaving and the page arriving are both on screen.
  // p-0: the popover UA style pads every [popover] by 0.25em, which shrank the
  // grid by 8px and made each list scroll by that much on the sheet.
  'player-drawer z-30 grid grid-cols-1 grid-rows-[minmax(0,1fr)] overflow-hidden p-0 border-white/10 bg-neutral-950/95 font-sans text-white shadow-2xl outline-none backdrop-blur-md',
  // The menu stamps data-starting-style on the first frame of opening and
  // data-ending-style while closing (and waits for the transition before it
  // unmounts), so the closed position goes on those and the open one is the
  // default. data-open is already present at mount, so keying on it never animates.
  // Height animates on phones (useSheetHeight), on the push's own curve.
  'transition-[opacity,transform,height] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] data-[ending-style]:opacity-0 data-[starting-style]:opacity-0',
  // Portrait phones: a bottom sheet that slides up.
  'max-h-[75dvh] w-full rounded-t-2xl border-t data-[ending-style]:translate-y-full data-[starting-style]:translate-y-full',
  // sm and up: a full-height drawer that slides in from the player's right edge.
  'sm:max-h-none sm:w-[clamp(20rem,28vw,26rem)] sm:rounded-none sm:border-l sm:border-t-0',
  'sm:data-[ending-style]:translate-x-full sm:data-[ending-style]:translate-y-0 sm:data-[starting-style]:translate-x-full sm:data-[starting-style]:translate-y-0',
  // Reduced motion: fade only, and the sheet's height changes at once.
  'motion-reduce:transition-opacity motion-reduce:data-[ending-style]:translate-x-0 motion-reduce:data-[ending-style]:translate-y-0 motion-reduce:data-[starting-style]:translate-x-0 motion-reduce:data-[starting-style]:translate-y-0'
)

// A page of the drawer (a Menu.Content). Phones: `self-start`, so each page's
// box is its own content for useSheetHeight to read. The drawer stretches
// pages to its full height.
export const pageClass =
  'flex max-h-full min-h-0 flex-col self-start outline-none [grid-area:1/1] sm:self-stretch'

export const listClass =
  'drawer-list flex min-h-0 flex-col gap-0.5 overflow-y-auto overscroll-contain px-2 pb-2'

// Rows ease in on a short stagger as their page appears (player.css). On the
// element whose children are the rows.
export const staggerClass = 'drawer-stagger'

// Highlight is :hover for the pointer and :focus-visible for the keyboard, NOT
// the menu's data-highlighted. The menu moves focus and data-highlighted to the
// selected option whenever a page opens, mouse or keyboard alike, so styling
// it lit the selected row on every click-through and then jumped to whatever
// row slid in under the cursor. After a click that focus move is not
// :focus-visible, so the only highlight left is the cursor's own hover.
export const rowClass =
  'group flex w-full cursor-pointer select-none items-center gap-3 rounded-xl px-3 py-2.5 text-left outline-none ring-inset ring-blue-400 hover:bg-white/10 focus-visible:bg-white/10 focus-visible:ring-2'

/** A page's title. The page needs `relative` for the close button. */
export function DrawerTitle({ children }) {
  return <h2 className="px-5 pb-2 pt-4 text-lg font-semibold">{children}</h2>
}

/**
 * The close button, drawn in the title's corner but placed last in the page's
 * DOM, so opening the drawer highlights the first row rather than it.
 * Selecting an item closes its own menu, here the whole drawer.
 */
export function DrawerClose({ label }) {
  return (
    <Menu.Item
      aria-label={label}
      className="absolute right-3 top-3 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-white/70 outline-none ring-blue-400 hover:bg-white/10 hover:text-white focus-visible:bg-white/10 focus-visible:ring-2"
    >
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </Menu.Item>
  )
}

export function Pill({ tone = 'neutral', children }) {
  return (
    <span
      className={classNames(
        'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none tracking-wide',
        tone === 'hdr' ? 'bg-amber-300 text-black' : 'bg-blue-500/80 text-white'
      )}
    >
      {children}
    </span>
  )
}
