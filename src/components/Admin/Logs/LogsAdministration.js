'use client'

import { memo, useCallback, useLayoutEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import { ArrowDownIcon, ArrowPathIcon, ChevronRightIcon, MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/20/solid'
import { toast } from 'react-toastify'
import { buildURL } from '@src/utils'
import { formatServerLabel } from '@src/utils/serverLabel'
import { useProcessorLog } from './useProcessorLog'
import { ALL_SOURCES, describeSelection, onlyCategory } from './logSources'
import { splitMeta } from './logExport'
import SourcesPicker from './SourcesPicker'
import TimeRangePicker, { ALL_TIME, describeRange, isRelative, rangeFor } from './TimeRangePicker'
import ExportMenu from './ExportMenu'

const NO_SERVERS = Object.freeze([])
const INITIAL_FILTERS = Object.freeze({ sources: ALL_SOURCES, level: '', q: '', range: ALL_TIME })

const LEVEL_ORDER = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly']
const LEVEL_OPTIONS = [
  { value: '', label: 'All levels' },
  { value: 'error', label: 'Errors' },
  { value: 'warn', label: 'Warnings and errors' },
  { value: 'info', label: 'Info and above' },
]

/** Lines at `level` or more severe ('' = every level), from the facet counts. */
function linesAtLevel(levels, level) {
  const maxRank = LEVEL_ORDER.indexOf(level)
  return Object.entries(levels).reduce((sum, [name, count]) => {
    const rank = LEVEL_ORDER.indexOf(name)
    return !level || (rank !== -1 && rank <= maxRank) ? sum + count : sum
  }, 0)
}

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

async function copyTraceId(traceId) {
  try {
    await navigator.clipboard.writeText(traceId)
    toast.success('Trace ID copied')
  } catch (error) {
    toast.error(`Couldn't copy the trace ID: ${error.message}`)
  }
}

const LogRow = memo(function LogRow({ entry, onCategory }) {
  const [open, setOpen] = useState(false)
  const style = LEVEL_STYLES[entry.level] ?? OTHER_LEVEL_STYLE
  const { fields, traceId } = splitMeta(entry.meta)

  return (
    <li className={`px-3 py-0.5 hover:bg-white/5 ${style.row}`}>
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="flex w-4 shrink-0 justify-center self-center">
          {fields && (
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
        {traceId && (
          <button
            type="button"
            onClick={() => copyTraceId(traceId)}
            title={`Copy trace ID ${traceId} (find it in SigNoz)`}
            className="shrink-0 rounded px-1 text-[10px] uppercase tracking-wide text-gray-600 hover:text-gray-300 focus:outline-none focus-visible:ring-1 focus-visible:ring-sky-400"
          >
            trace
          </button>
        )}
      </div>
      {open && (
        <pre className="my-1 ml-7 overflow-x-auto rounded bg-black/40 p-2 text-[11px] leading-relaxed text-gray-300">
          {JSON.stringify(fields, null, 2)}
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
              <span>
                {empty ? (filtered ? 'No matching lines in this range.' : 'Nothing logged in this range.') : 'Start of the range'}
              </span>
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

function StatusLine({ log, live, searching }) {
  const { entries, facets, span, liveError, skipped, restarted, status } = log
  if (status !== 'ready') return null
  const first = entries[0]?.time
  const last = entries.at(-1)?.time
  // The counts don't apply the text search, so they only describe the whole match without one.
  const ofTotal = !searching && facets.total !== null && facets.total > entries.length

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600">
      <span>
        {entries.length.toLocaleString()}
        {ofTotal && ` of ${facets.total.toLocaleString()}`} {entries.length === 1 && !ofTotal ? 'line' : 'lines'}
        {first && last && ` · ${formatTime(first)} – ${formatTime(last)}`}
      </span>
      {span.from && <span>Log covers {formatTime(span.from)} – {formatTime(span.to)}</span>}
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

const labelClass = 'mb-1 block text-xs font-medium text-gray-700'
const selectClass =
  'block w-full rounded-md border-0 py-1.5 pl-3 pr-8 text-sm text-gray-900 ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-indigo-600'

export default function LogsAdministration() {
  const [serverId, setServerId] = useState(null)
  const [filters, setFilters] = useState(INITIAL_FILTERS)
  const [draft, setDraft] = useState('')
  const [live, setLive] = useState(true)

  const { data: servers = NO_SERVERS, error: serversError } = useSWR(
    buildURL('/api/authenticated/admin/servers'),
    fetchServers,
    { revalidateOnFocus: false }
  )
  const activeServerId = serverId ?? servers[0]?.id ?? null
  const activeServer = servers.find((server) => server.id === activeServerId)
  // A range with an end is in the past: nothing new can arrive in it.
  const following = live && !filters.range.to
  const log = useProcessorLog({ serverId: activeServerId, filters, live: following })

  const filtered = Boolean(filters.sources.tokens.length || filters.level || filters.q || filters.range.from || filters.range.to)
  const counted = log.facets.total !== null

  const setFilter = (name, value) => setFilters((current) => ({ ...current, [name]: value }))
  // Stable, so the memoized rows don't all re-render on every update.
  const showOnlyCategory = useCallback(
    (category) => setFilters((current) => ({ ...current, sources: onlyCategory(category) })),
    []
  )

  function handleSearch(event) {
    event.preventDefault()
    setFilter('q', draft.trim())
  }

  function clearSearch() {
    setDraft('')
    setFilter('q', '')
  }

  function refresh() {
    // "Last hour" means the hour before now, so a refresh moves it.
    if (isRelative(filters.range)) setFilter('range', rangeFor(filters.range.preset))
    else log.reload()
  }

  const exportContext = {
    serverId: activeServerId ?? 'server',
    server: activeServer ? activeServer.displayName || formatServerLabel(activeServer.id) : '',
    sources: describeSelection(filters.sources, log.areas),
    level: LEVEL_OPTIONS.find((option) => option.value === filters.level)?.label ?? filters.level,
    search: filters.q,
    range: describeRange(filters.range),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }

  return (
    <div className="text-gray-900">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Logs</h1>
        <p className="mt-1 text-sm text-gray-600">
          The media processor&apos;s own log, newest at the bottom. It starts over when the processor restarts; older
          history is in SigNoz.
        </p>
      </div>

      {serversError && <p className="mb-4 text-sm text-red-600">{serversError.message}</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label htmlFor="log-server" className={labelClass}>
            Server
          </label>
          <select
            id="log-server"
            value={activeServerId ?? ''}
            onChange={(event) => setServerId(event.target.value)}
            className={selectClass}
          >
            {servers.map((server) => (
              <option key={server.id} value={server.id}>
                {server.displayName || formatServerLabel(server.id)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <span className={labelClass}>Sources</span>
          <SourcesPicker
            selection={filters.sources}
            areas={log.areas}
            facetCategories={log.facets.categories}
            onChange={(sources) => setFilter('sources', sources)}
          />
        </div>

        <div>
          <label htmlFor="log-level" className={labelClass}>
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
                {counted && ` (${linesAtLevel(log.facets.levels, option.value).toLocaleString()})`}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="log-time" className={labelClass}>
            Time
          </label>
          <TimeRangePicker
            id="log-time"
            range={filters.range}
            span={log.span}
            onChange={(range) => setFilter('range', range)}
            selectClass={selectClass}
          />
        </div>
      </div>

      <div className="mb-4 mt-3 flex flex-wrap items-end gap-2">
        <form onSubmit={handleSearch} role="search" className="min-w-[16rem] flex-1">
          <label htmlFor="log-search" className="sr-only">
            Search
          </label>
          <div className="relative">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-gray-400" aria-hidden="true" />
            <input
              id="log-search"
              type="search"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Search messages and their fields, then Enter"
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

        <label
          title={filters.range.to ? 'Live needs a range that runs up to now' : undefined}
          className={`inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 ${
            filters.range.to ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-gray-50'
          }`}
        >
          <input
            type="checkbox"
            checked={following}
            disabled={Boolean(filters.range.to)}
            onChange={(event) => setLive(event.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600"
          />
          Live
        </label>
        <button
          type="button"
          onClick={refresh}
          disabled={!activeServerId || log.status === 'loading'}
          className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-60"
        >
          <ArrowPathIcon className={`h-4 w-4 ${log.status === 'loading' ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </button>
        <ExportMenu entries={log.entries} context={exportContext} />
      </div>

      <LogViewport log={log} filtered={filtered} onCategory={showOnlyCategory} />
      <StatusLine log={log} live={following} searching={Boolean(filters.q)} />
    </div>
  )
}
