'use client'

import { memo, useCallback, useLayoutEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import { ArrowDownIcon, ArrowPathIcon, ChevronRightIcon, MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/20/solid'
import { buildURL } from '@src/utils'
import { formatServerLabel } from '@src/utils/serverLabel'
import { useProcessorLog } from './useProcessorLog'

const NO_SERVERS = Object.freeze([])
const NO_FILTERS = Object.freeze({ category: '', level: '', q: '' })

const LEVEL_OPTIONS = [
  { value: '', label: 'All levels' },
  { value: 'error', label: 'Errors' },
  { value: 'warn', label: 'Warnings and errors' },
  { value: 'info', label: 'Info and above' },
]

const LEVEL_STYLES = {
  error: { label: 'text-red-400', row: 'bg-red-500/10' },
  warn: { label: 'text-amber-300', row: 'bg-amber-400/5' },
  info: { label: 'text-sky-300', row: '' },
}
const OTHER_LEVEL_STYLE = { label: 'text-gray-400', row: '' }

const rowTime = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})
const fullTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'long' })

const formatTime = (iso, format = rowTime) => (iso ? format.format(new Date(iso)) : '')

async function fetchServers(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Couldn't load the server list (HTTP ${response.status})`)
  return response.json()
}

const LogRow = memo(function LogRow({ entry, onCategory }) {
  const [open, setOpen] = useState(false)
  const style = LEVEL_STYLES[entry.level] ?? OTHER_LEVEL_STYLE

  return (
    <li className={`px-3 py-0.5 hover:bg-white/5 ${style.row}`}>
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="flex w-4 shrink-0 justify-center self-center">
          {entry.meta && (
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              aria-label={open ? 'Hide fields' : 'Show fields'}
              className="rounded text-gray-500 hover:text-gray-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-sky-400"
            >
              <ChevronRightIcon className={`h-4 w-4 transition-transform ${open ? 'rotate-90' : ''}`} />
            </button>
          )}
        </span>
        <time
          dateTime={entry.time ?? undefined}
          title={formatTime(entry.time, fullTime)}
          className="shrink-0 tabular-nums text-gray-500"
        >
          {formatTime(entry.time) || '—'}
        </time>
        <span className={`w-12 shrink-0 font-semibold uppercase ${style.label}`}>{entry.level ?? 'raw'}</span>
        {entry.category ? (
          <button
            type="button"
            onClick={() => onCategory(entry.category)}
            title={`Show only ${entry.category}`}
            className="max-w-[12rem] shrink-0 truncate text-violet-300 hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-sky-400"
          >
            {entry.category}
          </button>
        ) : (
          <span className="shrink-0 text-gray-600">—</span>
        )}
        <span className="min-w-0 basis-full whitespace-pre-wrap break-words pl-7 text-gray-100 sm:basis-0 sm:flex-1 sm:pl-0">
          {entry.message}
        </span>
      </div>
      {open && (
        <pre className="my-1 ml-7 overflow-x-auto rounded bg-black/40 p-2 text-[11px] leading-relaxed text-gray-300">
          {JSON.stringify(entry.meta, null, 2)}
        </pre>
      )}
    </li>
  )
})

/**
 * The scrolling log. Follows the newest line while scrolled to the bottom,
 * holds its place otherwise, and keeps the view still when older lines load
 * above it.
 */
function LogViewport({ log, filtered, onCategory }) {
  const { entries, status, error, older, loadingOlder, olderError, scannedFrom, loadOlder } = log
  const scrollerRef = useRef(null)
  const lastLayoutRef = useRef({ firstId: null, lastId: null, height: 0 })
  const [pinned, setPinned] = useState(true)

  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const previous = lastLayoutRef.current
    const firstId = entries[0]?.id ?? null
    const lastId = entries.at(-1)?.id ?? null
    const has = (id) => id !== null && entries.some((entry) => entry.id === id)

    if (previous.firstId !== firstId && has(previous.firstId)) {
      // Older lines went in above: keep what was on screen where it was.
      scroller.scrollTop += scroller.scrollHeight - previous.height
    } else if (pinned || !has(previous.lastId)) {
      // Following the log, or a new log (filters, server, restart): show the newest.
      scroller.scrollTop = scroller.scrollHeight
    }
    lastLayoutRef.current = { firstId, lastId, height: scroller.scrollHeight }
  }, [entries, pinned])

  function handleScroll(event) {
    const scroller = event.currentTarget
    const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 32
    if (atBottom !== pinned) setPinned(atBottom)
  }

  function jumpToNewest() {
    const scroller = scrollerRef.current
    scroller.scrollTop = scroller.scrollHeight
    setPinned(true)
  }

  const empty = status === 'ready' && entries.length === 0

  return (
    <div className="relative">
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        role="log"
        aria-live="off"
        aria-label="Processor log"
        aria-busy={status === 'loading'}
        className="h-[65vh] min-h-[20rem] overflow-y-auto rounded-lg bg-gray-950 py-2 font-mono text-xs leading-5 text-gray-200 shadow-inner"
      >
        {status === 'ready' && (
          <div className="flex flex-wrap items-center justify-center gap-3 px-3 pb-2 text-gray-500">
            {older ? (
              <>
                {filtered && scannedFrom && (
                  <span>
                    {empty ? 'No matching lines' : 'Matches shown'} back to {formatTime(scannedFrom)}.
                  </span>
                )}
                <button
                  type="button"
                  onClick={loadOlder}
                  disabled={loadingOlder}
                  className="rounded border border-gray-700 px-3 py-1 text-gray-300 hover:border-gray-500 hover:text-white disabled:cursor-wait disabled:opacity-60"
                >
                  {loadingOlder ? 'Loading…' : filtered ? 'Search further back' : 'Load older lines'}
                </button>
              </>
            ) : (
              <span>{empty ? (filtered ? 'No matching lines in the log.' : 'The log is empty.') : 'Start of the log'}</span>
            )}
            {olderError && <span className="text-red-400">{olderError}</span>}
          </div>
        )}

        {status === 'loading' && <p className="px-3 text-gray-400">Loading the log…</p>}
        {status === 'error' && (
          <p className="mx-3 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-red-300">
            Couldn&apos;t load the log: {error}
          </p>
        )}

        <ol>
          {entries.map((entry) => (
            <LogRow key={entry.id} entry={entry} onCategory={onCategory} />
          ))}
        </ol>
      </div>

      {!pinned && entries.length > 0 && (
        <button
          type="button"
          onClick={jumpToNewest}
          className="absolute bottom-4 right-6 inline-flex items-center gap-1 rounded-full bg-sky-600 px-3 py-1.5 text-xs font-medium text-white shadow-lg hover:bg-sky-500"
        >
          <ArrowDownIcon className="h-4 w-4" aria-hidden="true" />
          Newest
        </button>
      )}
    </div>
  )
}

function StatusLine({ log, live }) {
  const { entries, liveError, skipped, restarted, status } = log
  if (status !== 'ready') return null
  const first = entries[0]?.time
  const last = entries.at(-1)?.time

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600">
      <span>
        {entries.length.toLocaleString()} {entries.length === 1 ? 'line' : 'lines'}
        {first && last && ` · ${formatTime(first)} – ${formatTime(last)}`}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className={`h-2 w-2 rounded-full ${live ? 'animate-pulse bg-green-500' : 'bg-gray-400'}`} aria-hidden="true" />
        {live ? 'Live: checks for new lines every 5 seconds' : 'Live updates paused'}
      </span>
      {liveError && <span className="text-amber-700">Live update failed ({liveError}); retrying.</span>}
      {skipped && <span className="text-amber-700">Some lines were skipped while the page was behind.</span>}
      {restarted && <span className="text-amber-700">The processor restarted, so its log started over.</span>}
    </div>
  )
}

const selectClass =
  'block w-full rounded-md border-0 py-1.5 pl-3 pr-8 text-sm text-gray-900 ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-indigo-600'

export default function LogsAdministration() {
  const [serverId, setServerId] = useState(null)
  const [filters, setFilters] = useState(NO_FILTERS)
  const [draft, setDraft] = useState('')
  const [live, setLive] = useState(true)

  const { data: servers = NO_SERVERS, error: serversError } = useSWR(
    buildURL('/api/authenticated/admin/servers'),
    fetchServers,
    { revalidateOnFocus: false }
  )
  const activeServerId = serverId ?? servers[0]?.id ?? null
  const log = useProcessorLog({ serverId: activeServerId, filters, live })

  const filtered = Boolean(filters.category || filters.level || filters.q)
  const categories =
    filters.category && !log.categories.includes(filters.category)
      ? [filters.category, ...log.categories]
      : log.categories

  const setFilter = (name, value) => setFilters((current) => ({ ...current, [name]: value }))
  // Stable, so the memoized rows don't all re-render on every update.
  const showCategory = useCallback((category) => setFilters((current) => ({ ...current, category })), [])

  function handleServerChange(event) {
    setServerId(event.target.value)
    // Categories are per processor.
    setFilter('category', '')
  }

  function handleSearch(event) {
    event.preventDefault()
    setFilter('q', draft.trim())
  }

  function clearSearch() {
    setDraft('')
    setFilter('q', '')
  }

  return (
    <div className="text-gray-900">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Logs</h1>
        <p className="mt-1 text-sm text-gray-600">
          The media processor&apos;s own log, newest at the bottom. Older history is in SigNoz.
        </p>
      </div>

      {serversError && <p className="mb-4 text-sm text-red-600">{serversError.message}</p>}

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,14rem)_minmax(0,14rem)_minmax(0,12rem)_minmax(0,1fr)_auto]">
        <div>
          <label htmlFor="log-server" className="mb-1 block text-xs font-medium text-gray-700">
            Server
          </label>
          <select id="log-server" value={activeServerId ?? ''} onChange={handleServerChange} className={selectClass}>
            {servers.map((server) => (
              <option key={server.id} value={server.id}>
                {server.displayName || formatServerLabel(server.id)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="log-category" className="mb-1 block text-xs font-medium text-gray-700">
            Category
          </label>
          <select
            id="log-category"
            value={filters.category}
            onChange={(event) => setFilter('category', event.target.value)}
            className={selectClass}
          >
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="log-level" className="mb-1 block text-xs font-medium text-gray-700">
            Level
          </label>
          <select
            id="log-level"
            value={filters.level}
            onChange={(event) => setFilter('level', event.target.value)}
            className={selectClass}
          >
            {LEVEL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <form onSubmit={handleSearch} role="search" className="sm:col-span-2 lg:col-span-1">
          <label htmlFor="log-search" className="mb-1 block text-xs font-medium text-gray-700">
            Search
          </label>
          <div className="relative">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-gray-400" aria-hidden="true" />
            <input
              id="log-search"
              type="search"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Text in a message or its fields, then Enter"
              maxLength={200}
              className="block w-full rounded-md border-0 py-1.5 pl-8 pr-8 text-sm text-gray-900 ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-indigo-600 [&::-webkit-search-cancel-button]:hidden"
            />
            {(draft || filters.q) && (
              <button
                type="button"
                onClick={clearSearch}
                aria-label="Clear search"
                className="absolute right-2 top-1.5 rounded text-gray-400 hover:text-gray-700"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            )}
          </div>
        </form>

        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-1">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50">
            <input
              type="checkbox"
              checked={live}
              onChange={(event) => setLive(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600"
            />
            Live
          </label>
          <button
            type="button"
            onClick={log.reload}
            disabled={!activeServerId || log.status === 'loading'}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-60"
          >
            <ArrowPathIcon className={`h-4 w-4 ${log.status === 'loading' ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </button>
        </div>
      </div>

      <LogViewport log={log} filtered={filtered} onCategory={showCategory} />
      <StatusLine log={log} live={live} />
    </div>
  )
}
