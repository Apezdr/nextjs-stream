'use client'

import { useState } from 'react'
import useSWR from 'swr'
import Image from 'next/image'
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react'
import { XMarkIcon, ChevronLeftIcon, ChevronRightIcon, ArrowTopRightOnSquareIcon, Squares2X2Icon } from '@heroicons/react/20/solid'
import { classNames } from '@src/utils'
import { languageName } from '@src/utils/media/detailsFacts'
import { buildArtworkTabs } from '@src/utils/media/artwork'

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300'
const QUIET_BUTTON = classNames('inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white', FOCUS_RING)

/** Grid columns and tile shape per kind: posters are tall, backdrops wide, logos transparent marks. */
const TAB_LAYOUT = {
  posters: { grid: 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5', frame: 'aspect-[2/3]', fit: 'object-cover', sizes: '(max-width: 640px) 33vw, (max-width: 768px) 25vw, 200px' },
  backdrops: { grid: 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3', frame: 'aspect-[16/9]', fit: 'object-cover', sizes: '(max-width: 640px) 100vw, (max-width: 768px) 50vw, 330px' },
  logos: { grid: 'grid-cols-2 sm:grid-cols-3', frame: 'aspect-[16/9]', fit: 'object-contain p-4', sizes: '(max-width: 640px) 50vw, 330px' },
  stills: { grid: 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3', frame: 'aspect-[16/9]', fit: 'object-cover', sizes: '(max-width: 640px) 100vw, (max-width: 768px) 50vw, 330px' },
}
/** The dialog is at most max-w-5xl (1024px) with 20px of padding each side */
const PREVIEW_SIZES = '(max-width: 1024px) 100vw, 980px'

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
 * cached and shared), and the list is cached client-side after that.
 *
 * Tiles and the preview go through the app's image optimizer like every
 * other image: with IMGPROXY_URL set the resize and encode run in imgproxy,
 * not this container (src/lib/imgproxy.ts); TMDB's JPEGs come out as AVIF
 * or WebP at a fraction of the size; and the result is cached, so TMDB is
 * asked once per image rather than once per viewer. A popular title has
 * well over a hundred images, so tiles stay lazy and only the visible ones
 * are requested. "Open full size" is the exception and links TMDB's
 * original directly: its point is handing over the untouched file, and the
 * optimizer would return a recompressed copy at a capped width.
 *
 * @param {Object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {string} props.title - the title's display name
 * @param {number|string|null} [props.tmdbId]
 * @param {'movie'|'tv'} props.type
 * @param {Object} [props.inUse] - see buildArtworkTabs
 * @param {{ season: number, episode: number }|null} [props.episode] - list this episode's stills (tmdbId is then the SHOW's id) instead of the title's artwork
 * @param {'posters'|'backdrops'|'logos'|'stills'} [props.initialTab]
 */
export default function ArtworkViewer({ open, onClose, title, tmdbId = null, type, inUse = {}, episode = null, initialTab = 'posters' }) {
  const [tabId, setTabId] = useState(initialTab)
  const [index, setIndex] = useState(null)
  const listUrl = episode
    ? `/api/authenticated/tmdb/episode/images?tmdb_id=${encodeURIComponent(tmdbId)}&season=${encodeURIComponent(episode.season)}&episode=${encodeURIComponent(episode.episode)}`
    : `/api/authenticated/tmdb/images/${type}?tmdb_id=${encodeURIComponent(tmdbId)}`
  const key = open && tmdbId ? listUrl : null
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
                {/* A fixed-height stage: aspect ratios vary from tall posters to wide logos, so the image is contained in it */}
                <div className="relative h-[58vh] w-full overflow-hidden rounded-xl bg-black/40">
                  <Image
                    key={item.key}
                    src={item.preview}
                    alt={`${title} ${active.label.toLowerCase().replace(/s$/, '')} ${index + 1} of ${active.items.length}`}
                    fill
                    sizes={PREVIEW_SIZES}
                    quality={90}
                    className="object-contain p-2"
                  />
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
                        <Image src={tile.thumb} alt="" fill sizes={layout.sizes} quality={75} className={layout.fit} />
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
