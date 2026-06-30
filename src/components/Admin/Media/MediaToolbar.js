'use client'

import { useState, useTransition } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { MagnifyingGlassIcon, PlusIcon, ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/20/solid'

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

export default function MediaToolbar({ type, total, page, pageSize, q = '', sort = 'title' }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [value, setValue] = useState(q)
  const [isPending, startTransition] = useTransition()

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const addHref = `${pathname.replace(/\/$/, '')}/new`

  function pushParams(next) {
    const params = new URLSearchParams(searchParams.toString())
    if ('q' in next) {
      if (next.q) params.set('q', next.q)
      else params.delete('q')
    }
    if ('sort' in next) {
      if (next.sort && next.sort !== 'title') params.set('sort', next.sort)
      else params.delete('sort')
    }
    if ('page' in next) {
      if (next.page > 1) params.set('page', String(next.page))
      else params.delete('page')
    }
    const query = params.toString()
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname))
  }

  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          pushParams({ q: value.trim(), page: 1 })
        }}
        className="relative flex-1 sm:max-w-md"
      >
        <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
        <input
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={`Search ${type === 'tv' ? 'TV shows' : 'movies'} by title…`}
          className="block w-full rounded-md border border-gray-300 bg-white py-2 pl-10 pr-3 text-sm text-gray-900 placeholder:text-gray-400 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
        />
      </form>

      <div className="flex items-center gap-3">
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
        <div className="flex items-center gap-1 text-sm text-gray-600">
          <button
            type="button"
            disabled={page <= 1 || isPending}
            onClick={() => pushParams({ page: page - 1 })}
            className="rounded p-1 hover:bg-gray-100 disabled:opacity-40"
            aria-label="Previous page"
          >
            <ChevronLeftIcon className="h-5 w-5" />
          </button>
          <span className="tabular-nums">
            {total === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
          </span>
          <button
            type="button"
            disabled={page >= totalPages || isPending}
            onClick={() => pushParams({ page: page + 1 })}
            className="rounded p-1 hover:bg-gray-100 disabled:opacity-40"
            aria-label="Next page"
          >
            <ChevronRightIcon className="h-5 w-5" />
          </button>
        </div>

        <Link
          href={addHref}
          className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
        >
          <PlusIcon className="h-4 w-4" /> Add manual entry
        </Link>
      </div>
    </div>
  )
}
