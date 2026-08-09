'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { MagnifyingGlassIcon, PlusIcon, ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/20/solid'
import useMediaBrowserParams from './useMediaBrowserParams'

/**
 * Search + pagination + "Add manual entry" toolbar for the media list pages.
 * Search and page are encoded in the URL (`q`, `page`) so the RSC page re-runs
 * the query server-side — no client data fetching.
 */
const SORT_OPTIONS = [
  { value: 'title', label: 'Alphabetical' },
  { value: 'added', label: 'Recently Added' },
  { value: 'release', label: 'Release Date' },
]

// Kept in step with ADMIN_PAGE_SIZES in flatMediaAdmin.js; 'all' is added
// separately because it is not a number.
const PAGE_SIZE_OPTIONS = [25, 50, 100, 250, 500]

export default function MediaToolbar({
  type,
  total,
  page,
  pageSize,
  q = '',
  sort = 'title',
  servers = [],
  serverId = '',
  quality = '',
  year = '',
  video = '',
  hdr = '',
}) {
  const [value, setValue] = useState(q)
  const [yearValue, setYearValue] = useState(year)
  const [lastUrlYear, setLastUrlYear] = useState(year)
  const yearTimerRef = useRef(null)
  const { pushParams, isPending, pathname } = useMediaBrowserParams()

  const showingAll = pageSize === 'all'
  const totalPages = showingAll ? 1 : Math.max(1, Math.ceil(total / pageSize))
  const addHref = `${pathname.replace(/\/$/, '')}/new`

  // Typing "1999" would otherwise be four navigations, each a fresh Mongo query.
  function pushYear(next) {
    setYearValue(next)
    clearTimeout(yearTimerRef.current)
    yearTimerRef.current = setTimeout(() => {
      yearTimerRef.current = null
      pushParams({ year: next, page: 1 })
    }, 400)
  }

  // Resync from the URL (back button, cleared filters). Typing never clobbers
  // itself: the URL only changes once the debounce below has fired.
  if (year !== lastUrlYear) {
    setLastUrlYear(year)
    setYearValue(year)
  }

  useEffect(() => () => clearTimeout(yearTimerRef.current), [])

  return (
    <div className="mb-4 space-y-3">
      {/* Search owns its own row: sharing one flex line with the filters and
          pagination collapsed it to icon width once the controls multiplied. */}
      <div className="flex items-center gap-3">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            pushParams({ q: value.trim(), page: 1 })
          }}
          className="relative min-w-0 flex-1"
        >
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={`Search ${type === 'tv' ? 'TV shows' : 'movies'} by title\u2026`}
            className="block w-full rounded-md border border-gray-300 bg-white py-2 pl-10 pr-3 text-sm text-gray-900 placeholder:text-gray-400 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
          />
        </form>
        <Link
          href={addHref}
          className="inline-flex shrink-0 items-center gap-1 rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
        >
          <PlusIcon className="h-4 w-4" /> Add manual entry
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-2">
        <select value={quality} onChange={(event) => pushParams({ quality: event.target.value, page: 1 })} aria-label="Filter by quality" className="rounded-md border border-gray-300 bg-white py-2 pl-3 pr-8 text-sm text-gray-900">
          <option value="">All qualities</option>
          {['4K', '1440p', '1080p', '720p', 'SD', 'Unknown'].map(value => <option key={value} value={value}>{value}</option>)}
        </select>
        <input type="number" min="1800" max="2200" value={yearValue} onChange={(event) => pushYear(event.target.value)} placeholder="Year" aria-label="Filter by year" className="w-24 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900" />
        <select value={video} onChange={(event) => pushParams({ video: event.target.value, page: 1 })} aria-label="Filter by video availability" className="rounded-md border border-gray-300 bg-white py-2 pl-3 pr-8 text-sm text-gray-900">
          <option value="">All video states</option>
          <option value="available">Video available</option>
          <option value="missing">Video missing</option>
        </select>
        <select value={hdr} onChange={(event) => pushParams({ hdr: event.target.value, page: 1 })} aria-label="Filter by HDR" className="rounded-md border border-gray-300 bg-white py-2 pl-3 pr-8 text-sm text-gray-900">
          <option value="">HDR + SDR</option>
          <option value="hdr">HDR only</option>
          <option value="sdr">SDR / none</option>
        </select>
        </div>

        <div className="flex flex-wrap items-center gap-3">
        {servers.length > 1 && (
          <label className="flex items-center gap-1 text-sm text-gray-600" title={type === 'tv' ? 'Filter by episode hosting server' : 'Filter by primary video source'}>
            <span className="sr-only sm:not-sr-only">Server</span>
            <select
              value={serverId}
              onChange={(e) => pushParams({ server: e.target.value, page: 1 })}
              aria-label="Filter by server"
              className="rounded-md border border-gray-300 bg-white py-2 pl-3 pr-8 text-sm text-gray-900 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
            >
              <option value="">All servers</option>
              {servers.map(server => (
                <option key={server.id} value={server.id}>{server.displayName}</option>
              ))}
            </select>
          </label>
        )}
        <label className="flex items-center gap-1 text-sm text-gray-600">
          <span className="sr-only sm:not-sr-only">Sort</span>
          <select
            value={sort}
            onChange={(e) => pushParams({ sort: e.target.value, page: 1 })}
            className="rounded-md border border-gray-300 bg-white py-2 pl-3 pr-8 text-sm text-gray-900 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <span className="whitespace-nowrap">Show</span>
          <select
            value={showingAll ? 'all' : String(pageSize)}
            onChange={(e) => pushParams({ size: e.target.value === '25' ? '' : e.target.value, page: 1 })}
            aria-label="Results per page"
            className="rounded-md border border-gray-300 bg-white py-2 pl-3 pr-8 text-sm text-gray-900 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={String(size)}>
                {size}
              </option>
            ))}
            <option value="all">All</option>
          </select>
        </label>
        <div className="flex items-center gap-1 text-sm text-gray-600">
          <button
            type="button"
            disabled={showingAll || page <= 1 || isPending}
            onClick={() => pushParams({ page: page - 1 })}
            className="rounded p-1 hover:bg-gray-100 disabled:opacity-40"
            aria-label="Previous page"
          >
            <ChevronLeftIcon className="h-5 w-5" />
          </button>
          <span className="tabular-nums">
            {showingAll
              ? `${total} of ${total}`
              : `${total === 0 ? 0 : (page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}
          </span>
          <button
            type="button"
            disabled={showingAll || page >= totalPages || isPending}
            onClick={() => pushParams({ page: page + 1 })}
            className="rounded p-1 hover:bg-gray-100 disabled:opacity-40"
            aria-label="Next page"
          >
            <ChevronRightIcon className="h-5 w-5" />
          </button>
        </div>
      </div>
      </div>
    </div>
  )
}
