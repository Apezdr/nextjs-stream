'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react'
import { XMarkIcon, ChevronLeftIcon, ChevronRightIcon, ArrowTopRightOnSquareIcon, Squares2X2Icon } from '@heroicons/react/20/solid'
import { classNames } from '@src/utils'
import { languageName } from '@src/utils/media/detailsFacts'
import { buildArtworkTabs } from '@src/utils/media/artwork'

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300'
const QUIET_BUTTON = classNames('inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white', FOCUS_RING)

/** Grid columns and tile shape per kind: posters are tall, backdrops wide, logos transparent marks. */
const TAB_LAYOUT = {
  posters: { grid: 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5', frame: 'aspect-[2/3]', fit: 'object-cover' },
  backdrops: { grid: 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3', frame: 'aspect-[16/9]', fit: 'object-cover' },
  logos: { grid: 'grid-cols-2 sm:grid-cols-3', frame: 'aspect-[16/9]', fit: 'object-contain p-4' },
}

async function fetchImages(url) {
  const res = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Artwork request failed (${res.status})`)
  return res.json()
}

/**
 * The artwork viewer: every poster, backdrop and logo TMDB has for a
 * title, with the ones the library uses pinned first and badged. A tile
 * opens a large preview with previous/next; "Open full size" hands the
 * original to a new tab, which is how a viewer takes an image with them.
 *
 * Nothing is fetched until the dialog is open (the pages it opens from are
 * cached and shared), and the list is cached client-side after that. The
 * tiles are plain `<img>` elements on purpose: a popular title has well
 * over a hundred images, and running each through the image optimizer
 * would re-encode them all on this server for no gain — TMDB already
 * serves sized variants.
 *
 * @param {Object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {string} props.title - the title's display name
 * @param {number|string|null} [props.tmdbId]
 * @param {'movie'|'tv'} props.type
 * @param {Object} [props.inUse] - see buildArtworkTabs
 * @param {'posters'|'backdrops'|'logos'} [props.initialTab]
 */
export default function ArtworkViewer({ open, onClose, title, tmdbId = null, type, inUse = {}, initialTab = 'posters' }) {
  const [tabId, setTabId] = useState(initialTab)
  const [index, setIndex] = useState(null)
  const key = open && tmdbId ? `/api/authenticated/tmdb/images/${type}?tmdb_id=${encodeURIComponent(tmdbId)}` : null
  const { data, error, isLoading } = useSWR(key, fetchImages, { revalidateOnFocus: false, revalidateOnReconnect: false, dedupingInterval: 600000 })

  const tabs = buildArtworkTabs({ images: data, inUse })
  const active = tabs.find((tab) => tab.id === tabId) || tabs[0] || null
  const layout = active ? TAB_LAYOUT[active.id] : TAB_LAYOUT.posters
  const item = active && index != null ? active.items[index] || null : null
  const loading = Boolean(key) && isLoading && !data

  const step = (delta) => {
    if (!active || index == null) return
    setIndex((index + delta + active.items.length) % active.items.length)
  }
  // Escape steps back from the preview before it closes the dialog
  const handleClose = () => (index != null ? setIndex(null) : onClose())
  const handleKeyDown = (event) => {
    if (index == null) return
    if (event.key === 'ArrowLeft') step(-1)
    else if (event.key === 'ArrowRight') step(1)
  }

  return (
    <Dialog open={open} onClose={handleClose} className="relative z-[70]">
      <DialogBackdrop className="fixed inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="fixed inset-0 flex items-center justify-center p-3 sm:p-6">
        <DialogPanel
          onKeyDown={handleKeyDown}
          className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-[#0f1633] shadow-2xl ring-1 ring-white/10"
        >
          <div className="flex items-start justify-between gap-4 px-5 pt-5">
            <div className="min-w-0">
              <DialogTitle className="truncate text-lg font-semibold text-white">{title}</DialogTitle>
              <p className="text-sm text-white/55">Artwork</p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close artwork" className={classNames('rounded-md p-2 text-white/70 hover:bg-white/10 hover:text-white', FOCUS_RING)}>
              <XMarkIcon className="size-5" aria-hidden="true" />
            </button>
          </div>

          {tabs.length > 1 ? (
            <div role="tablist" aria-label="Artwork kind" className="mt-3 flex gap-6 border-b border-white/10 px-5">
              {tabs.map((tab) => {
                const selected = active?.id === tab.id
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => {
                      setTabId(tab.id)
                      setIndex(null)
                    }}
                    className={classNames(
                      'rounded-t pb-2 text-sm font-medium',
                      FOCUS_RING,
                      selected ? '-mb-px border-b-2 border-blue-400 text-white' : 'text-white/55 hover:text-white'
                    )}
                  >
                    {tab.label} <span className="font-normal text-white/45">· {tab.items.length}</span>
                  </button>
                )
              })}
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            {item ? (
              <div>
                <div className="flex items-center justify-center rounded-xl bg-black/40 p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element -- see the component note: TMDB serves sized variants */}
                  <img src={item.preview} alt={`${title} ${active.label.toLowerCase().replace(/s$/, '')} ${index + 1} of ${active.items.length}`} className="max-h-[58vh] w-auto max-w-full rounded-lg object-contain" />
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <p className="flex flex-wrap items-center gap-2 text-sm text-white/60">
                    <span className="tabular-nums">
                      {index + 1} of {active.items.length}
                    </span>
                    {item.width && item.height ? (
                      <span className="tabular-nums">
                        · {item.width} × {item.height}
                      </span>
                    ) : null}
                    <span>· {item.language ? languageName(item.language) : 'No text'}</span>
                    {item.badge ? <span className="rounded-full bg-blue-500/25 px-2 py-0.5 text-xs font-semibold text-blue-100">{item.badge}</span> : null}
                  </p>
                  <div className="flex flex-wrap items-center gap-1">
                    <button type="button" onClick={() => step(-1)} className={QUIET_BUTTON}>
                      <ChevronLeftIcon className="size-4" aria-hidden="true" />
                      Previous
                    </button>
                    <button type="button" onClick={() => step(1)} className={QUIET_BUTTON}>
                      Next
                      <ChevronRightIcon className="size-4" aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => setIndex(null)} className={QUIET_BUTTON}>
                      <Squares2X2Icon className="size-4" aria-hidden="true" />
                      All {active.label.toLowerCase()}
                    </button>
                    <a href={item.full} target="_blank" rel="noopener noreferrer" className={classNames(QUIET_BUTTON, 'text-blue-300')}>
                      Open full size
                      <ArrowTopRightOnSquareIcon className="size-4" aria-hidden="true" />
                    </a>
                  </div>
                </div>
              </div>
            ) : loading ? (
              <ul role="status" aria-label="Loading artwork" className={classNames('grid gap-3', layout.grid)}>
                {Array.from({ length: 10 }, (_, i) => (
                  <li key={i} className={classNames('rounded-lg bg-white/10 motion-safe:animate-pulse', layout.frame)} />
                ))}
              </ul>
            ) : active ? (
              <>
                {error ? <p className="mb-3 text-sm text-amber-200/90">The full artwork list could not be loaded. Showing what this title uses.</p> : null}
                <ul className={classNames('grid gap-3', layout.grid)}>
                  {active.items.map((tile, i) => (
                    <li key={tile.key}>
                      <button
                        type="button"
                        onClick={() => setIndex(i)}
                        aria-label={`${active.label.replace(/s$/, '')} ${i + 1}${tile.badge ? `, ${tile.badge}` : ''}`}
                        className={classNames(
                          'group relative block w-full overflow-hidden rounded-lg bg-white/10 ring-1 transition-[box-shadow]',
                          FOCUS_RING,
                          layout.frame,
                          tile.inUse ? 'ring-2 ring-blue-400' : 'ring-white/10 hover:ring-white/40'
                        )}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- see the component note: TMDB serves sized variants */}
                        <img src={tile.thumb} alt="" loading="lazy" decoding="async" className={classNames('absolute inset-0 size-full', layout.fit)} />
                        {tile.badge ? (
                          <span className="absolute left-1.5 top-1.5 rounded-full bg-blue-500 px-2 py-0.5 text-[11px] font-semibold text-white shadow">{tile.badge}</span>
                        ) : null}
                        {tile.language && tile.language !== 'en' ? (
                          <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold uppercase text-white/90">{tile.language}</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="py-10 text-center text-sm text-white/60">{error ? 'The artwork could not be loaded.' : 'No artwork is available for this title.'}</p>
            )}
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}
