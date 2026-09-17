'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { ArrowsPointingOutIcon } from '@heroicons/react/20/solid'
import { classNames } from '@src/utils'

// The viewer (dialog, tabs, image list) loads on the first click, not with the page
const ArtworkViewer = dynamic(() => import('./ArtworkViewer'), { ssr: false })

/**
 * Makes a poster the way into the artwork viewer: the poster is its
 * child, this is the button around it. Hover and focus show an expand
 * mark so it reads as something to click.
 *
 * It is the grid item in the hero, so layout classes that used to sit on
 * the poster (row span, order) go on `className`. `self-start` keeps the
 * button the poster's height rather than stretching to its grid rows,
 * which would put the focus ring around empty space.
 *
 * With no TMDB id and no in-use image there is nothing to show, so the
 * poster renders as it always did, unwrapped.
 *
 * @param {Object} props
 * @param {string} props.title - the title's display name
 * @param {number|string|null} [props.tmdbId]
 * @param {'movie'|'tv'} props.type
 * @param {Object} [props.inUse] - `{ poster, backdrop, logo }`, each `{ path, url, label? }`; see buildArtworkTabs
 * @param {'posters'|'backdrops'|'logos'} [props.initialTab]
 * @param {string} [props.className]
 * @param {import('react').ReactNode} props.children - the poster
 */
export default function ArtworkButton({ title, tmdbId = null, type, inUse = {}, initialTab = 'posters', className = '', children }) {
  const [open, setOpen] = useState(false)
  // Mount the viewer on first open and keep it, so closing keeps its cached list and tab
  const [mounted, setMounted] = useState(false)

  const hasAnything = Boolean(tmdbId) || Object.values(inUse || {}).some((entry) => entry?.url)
  if (!hasAnything) return <div className={classNames('self-start', className)}>{children}</div>

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setMounted(true)
          setOpen(true)
        }}
        aria-haspopup="dialog"
        aria-label={`View artwork for ${title}`}
        className={classNames(
          'group relative block w-fit cursor-zoom-in self-start rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-300',
          className
        )}
      >
        {children}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex items-end justify-end rounded-lg bg-black/0 p-2 opacity-0 transition-[opacity,background-color] duration-200 group-hover:bg-black/25 group-hover:opacity-100 group-focus-visible:bg-black/25 group-focus-visible:opacity-100"
        >
          <span className="rounded-full bg-black/70 p-1.5 text-white ring-1 ring-white/20">
            <ArrowsPointingOutIcon className="size-4" />
          </span>
        </span>
      </button>
      {mounted ? <ArtworkViewer open={open} onClose={() => setOpen(false)} title={title} tmdbId={tmdbId} type={type} inUse={inUse} initialTab={initialTab} /> : null}
    </>
  )
}
