'use client'

import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react'
import { XMarkIcon, CheckCircleIcon } from '@heroicons/react/24/outline'

const KIND_LABEL = { poster: 'Poster', backdrop: 'Backdrop', logo: 'Logo' }
// Thumbnail bucket per kind. Backdrops are wide; logos are usually transparent PNG.
const KIND_SIZE = { poster: 'w342', backdrop: 'w500', logo: 'w300' }
// Grid columns tuned to each aspect ratio.
const KIND_GRID = {
  poster: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4',
  backdrop: 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3',
  logo: 'grid-cols-1 sm:grid-cols-2',
}

function thumbUrl(filePath, size) {
  if (!filePath) return null
  return `https://image.tmdb.org/t/p/${size}${filePath}`
}

/**
 * Presentational TMDB image picker dialog. The parent owns fetching (in an
 * event handler, not an effect) and passes the resolved image list down, so
 * this component stays free of data side effects.
 *
 * @param {Object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {'poster'|'backdrop'|'logo'} props.kind
 * @param {Array<{file_path:string,width:number,height:number,vote_average:number,iso_639_1:string|null}>} props.images
 * @param {boolean} props.loading
 * @param {string|null} props.error
 * @param {string} [props.selected] - currently-chosen file_path (highlighted)
 * @param {(filePath: string) => void} props.onSelect
 */
export default function TmdbImagePicker({
  open,
  onClose,
  kind = 'poster',
  images = [],
  loading = false,
  error = null,
  selected = '',
  onSelect,
}) {
  const size = KIND_SIZE[kind] || 'w342'
  // Selected image first (so the in-use one is obvious), then by popularity.
  const sorted = [...images].sort((a, b) => {
    const aSel = selected && a?.file_path === selected ? 1 : 0
    const bSel = selected && b?.file_path === selected ? 1 : 0
    if (aSel !== bSel) return bSel - aSel
    return (b?.vote_average ?? 0) - (a?.vote_average ?? 0)
  })

  return (
    <Dialog open={open} onClose={onClose} className="relative z-[60]">
      <DialogBackdrop className="fixed inset-0 bg-black/50" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-lg bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
            <DialogTitle className="text-lg font-semibold text-gray-900">
              Choose {KIND_LABEL[kind] || 'image'} from TMDB
            </DialogTitle>
            <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>

          <div className="overflow-y-auto px-6 py-5">
            {loading ? (
              <p className="py-10 text-center text-sm text-gray-500">Loading images…</p>
            ) : error ? (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            ) : sorted.length === 0 ? (
              <p className="py-10 text-center text-sm text-gray-500">
                No {KIND_LABEL[kind]?.toLowerCase() || 'image'}s available for this TMDB ID.
              </p>
            ) : (
              <ul className={`grid gap-3 ${KIND_GRID[kind] || KIND_GRID.poster}`}>
                {sorted.map((img) => {
                  const isSelected = selected && selected === img.file_path
                  return (
                    <li key={img.file_path}>
                      <button
                        type="button"
                        onClick={() => onSelect?.(img.file_path)}
                        className={`group relative block w-full overflow-hidden rounded-md border ${
                          isSelected ? 'border-indigo-500 ring-2 ring-indigo-500' : 'border-gray-200 hover:border-indigo-400'
                        } ${kind === 'logo' ? 'bg-gray-200 p-3' : 'bg-gray-100'}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={thumbUrl(img.file_path, size)}
                          alt={`${KIND_LABEL[kind]} option`}
                          loading="lazy"
                          className={kind === 'logo' ? 'h-20 w-full object-contain' : 'w-full object-cover'}
                        />
                        {isSelected && (
                          <>
                            <span className="absolute right-1 top-1 rounded-full bg-white/90 text-indigo-600">
                              <CheckCircleIcon className="h-5 w-5" />
                            </span>
                            <span className="absolute left-1 top-1 rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white shadow">
                              Current
                            </span>
                          </>
                        )}
                        <span className="absolute bottom-0 left-0 right-0 flex items-center justify-between bg-black/55 px-1.5 py-0.5 text-[10px] text-white">
                          <span>{img.width}×{img.height}</span>
                          <span className="flex items-center gap-1">
                            {img.iso_639_1 ? <span className="uppercase">{img.iso_639_1}</span> : null}
                            <span>★ {(img.vote_average ?? 0).toFixed(1)}</span>
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}
