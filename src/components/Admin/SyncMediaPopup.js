'use client'

import { Dialog, Transition } from '@headlessui/react'
import { Fragment, useEffect, useMemo, useReducer, useRef, useState, useDeferredValue, useTransition } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import useSWR from 'swr'
import { classNames } from '@src/utils'

// Rule 6.3: Hoist static JSX outside the component — avoids re-creation on every render
const SYNC_ICON = (
  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 sm:mx-0 sm:h-10 sm:w-10">
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth="1.5"
      stroke="currentColor"
      className="w-6 h-6"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"
      />
    </svg>
  </div>
)

function StatusDot({ status }) {
  if (status === 'syncing') {
    return (
      <svg aria-hidden="true" className="w-3 h-3 text-blue-500 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
      </svg>
    )
  }
  if (status === 'complete') {
    return <div aria-hidden="true" className="w-2.5 h-2.5 rounded-full bg-green-500 shrink-0" />
  }
  return <div aria-hidden="true" className="w-2.5 h-2.5 rounded-full bg-gray-300 shrink-0" />
}

function AnimatedTicker({
  value,
  className = '',
  minIntervalMs = 280,
  heightClass = 'h-10',
  spring = false,
}) {
  // Display value and render key are committed together on every animation
  // frame — keeping them in one state object lets us advance both with a
  // single setState call (avoids cascading setState in the flush effect).
  const [frame, setFrame] = useState(() => ({ value: value ?? null, key: 0 }))
  const displayValue = frame.value

  const pendingValueRef = useRef(value ?? null)
  const displayedValueRef = useRef(value ?? null)
  const timerRef = useRef(null)
  const isAnimatingRef = useRef(false)
  const lastCommitRef = useRef(0)

  useEffect(() => {
    displayedValueRef.current = displayValue
  }, [displayValue])

  useEffect(() => {
    pendingValueRef.current = value ?? null

    if (!value) return
    if (value === displayedValueRef.current) return

    const flushLatest = () => {
      if (isAnimatingRef.current) return

      const next = pendingValueRef.current
      if (!next || next === displayedValueRef.current) return

      const elapsed = Date.now() - lastCommitRef.current
      const wait = Math.max(0, minIntervalMs - elapsed)

      if (timerRef.current) clearTimeout(timerRef.current)

      timerRef.current = setTimeout(() => {
        const latest = pendingValueRef.current
        if (!latest || latest === displayedValueRef.current) return

        isAnimatingRef.current = true
        lastCommitRef.current = Date.now()
        setFrame(prev => ({ value: latest, key: prev.key + 1 }))
      }, wait)
    }

    flushLatest()

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [value, minIntervalMs])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  if (!displayValue) return null

  const transition = spring
    ? {
        type: 'spring',
        stiffness: 520,
        damping: 34,
        mass: 0.7,
      }
    : {
        duration: 0.2,
        ease: [0.22, 1, 0.36, 1],
      }

  return (
    <div className={`relative min-w-0 flex-1 overflow-hidden ${heightClass}`}>
      <AnimatePresence
        mode="wait"
        initial={false}
        onExitComplete={() => {
          isAnimatingRef.current = false

          const pending = pendingValueRef.current
          const shown = displayedValueRef.current

          if (pending && pending !== shown) {
            const elapsed = Date.now() - lastCommitRef.current
            const wait = Math.max(0, minIntervalMs - elapsed)

            if (timerRef.current) clearTimeout(timerRef.current)

            timerRef.current = setTimeout(() => {
              const latest = pendingValueRef.current
              if (!latest || latest === displayedValueRef.current) return

              isAnimatingRef.current = true
              lastCommitRef.current = Date.now()
              setFrame(prev => ({ value: latest, key: prev.key + 1 }))
            }, wait)
          }
        }}
      >
        <motion.span
          key={`${frame.key}-${displayValue}`}
          className={`absolute inset-0 flex items-center min-w-0 ${className}`}
          initial={{ y: 16, opacity: 0, rotateX: -65, filter: 'blur(6px)' }}
          animate={{ y: 0, opacity: 1, rotateX: 0, filter: 'blur(0px)' }}
          exit={{ y: -16, opacity: 0, rotateX: 65, filter: 'blur(6px)' }}
          transition={transition}
          style={{
            transformOrigin: '50% 50%',
            willChange: 'transform, opacity, filter',
          }}
        >
          {displayValue}
        </motion.span>
      </AnimatePresence>
    </div>
  )
}

/** A count with a thousands separator. */
const formatCount = (n) => Number(n || 0).toLocaleString('en-US')

/** `n` and the noun, singular for one. */
const countOf = (n, singular, plural = `${singular}s`) => `${formatCount(n)} ${n === 1 ? singular : plural}`

/** A message cut to `max` characters, with an ellipsis. */
const truncate = (text, max = 160) => {
  const value = String(text ?? '')
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

/** What a server's pass did, title by title (the report's titleCounts). */
function ServerCounts({ counts, forced }) {
  const { checked, updated, unchanged, failed, failures = [] } = counts
  return (
    <div className="mt-1.5 space-y-1.5">
      <p className="text-gray-700">
        {countOf(checked, 'title')} checked: {formatCount(updated)} updated, {formatCount(unchanged)} unchanged,{' '}
        <span className={failed > 0 ? 'font-semibold text-red-700' : undefined}>{formatCount(failed)} failed</span>
      </p>
      {unchanged > 0 ? (
        <p className="text-gray-500">
          {forced
            ? 'Unchanged titles were checked in full and needed no update.'
            : 'Unchanged titles were skipped: nothing on the server changed since the last sync.'}
        </p>
      ) : null}
      {failures.length > 0 ? (
        <div>
          <h5 className="font-semibold text-red-800">Failed titles</h5>
          <ul className="mt-1 max-h-40 overflow-y-auto space-y-1 list-disc ml-4">
            {failures.map((failure) => (
              <li key={`${failure.kind}:${failure.title}`} className="text-gray-800">
                <span className="font-medium">{failure.title}</span>:{' '}
                <span className="text-red-700 break-words">{truncate(failure.error)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function ServerCard({ server, counts = null, passErrors = [], forced = false, links = [] }) {
  const [errorsExpanded, setErrorsExpanded] = useState(false)
  const syncing = server.status === 'syncing'
  // While the pass runs: the live error events. Once it is done: its report.
  const failedCount = counts ? counts.failed + passErrors.length : server.errorCount
  const hasErrors = failedCount > 0

  const cardClass = syncing
    ? 'border-blue-200 bg-blue-50'
    : hasErrors
      ? 'border-amber-200 bg-amber-50'
      : 'border-green-200 bg-green-50'

  const statusLabel = syncing ? 'Syncing' : hasErrors ? 'Done, with failures' : 'Done'

  return (
    <div className={`rounded-lg border p-2.5 text-xs transition-colors ${cardClass}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <StatusDot status={server.status} />
          <h4 className="font-semibold text-gray-800 truncate">{server.id}</h4>
        </div>
        <div className="flex items-center gap-2 shrink-0 text-gray-500">
          <span>{statusLabel}</span>
          {!counts && server.errorCount > 0 ? (
            <button
              type="button"
              onClick={() => setErrorsExpanded(e => !e)}
              aria-expanded={errorsExpanded}
              aria-controls={sectionId('errors', server.id)}
              className="text-red-600 font-medium hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            >
              {server.errorCount} error{server.errorCount !== 1 ? 's' : ''}{' '}
              <span aria-hidden="true">{errorsExpanded ? '▲' : '▼'}</span>
            </button>
          ) : null}
        </div>
      </div>

      {server.status === 'syncing' && server.currentEntity ? (
        <div className="mt-1.5 min-h-[40px]">
          <div className="flex items-center gap-1 text-gray-500 min-w-0 [perspective:800px]">
            <span className="text-gray-400 shrink-0">Processing</span>

            <AnimatedTicker
              value={server.currentEntity}
              className="font-medium text-gray-700 truncate"
              minIntervalMs={310}
              heightClass="h-10"
            />

            {server.currentOperation ? (
              <>
                <span className="text-gray-400 shrink-0">·</span>
                <AnimatedTicker
                  value={server.currentOperation}
                  className="text-gray-400 shrink-0"
                  minIntervalMs={310}
                  heightClass="h-10"
                />
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {errorsExpanded && server.errors.length > 0 ? (
        <ul id={sectionId('errors', server.id)} className="mt-2 max-h-40 overflow-y-auto space-y-1 border-t border-amber-200 pt-2">
          {server.errors.map((err, i) => (
            <li key={i} className="bg-white border border-red-100 rounded p-1.5">
              <div className="flex items-center gap-1.5 mb-0.5 min-w-0">
                {err.mediaType ? (
                  <span className="font-mono bg-red-100 text-red-700 px-1 rounded shrink-0">{err.mediaType}</span>
                ) : null}
                <span className="font-medium text-gray-800 truncate">{err.entityId}</span>
                {err.operation ? (
                  <span className="text-gray-400 shrink-0">· {err.operation}</span>
                ) : null}
              </div>
              <p className="text-red-600 break-words leading-tight">{err.error}</p>
            </li>
          ))}
        </ul>
      ) : null}

      {!syncing && counts ? <ServerCounts counts={counts} forced={forced} /> : null}

      {!syncing && links.length > 0 ? (
        <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1" aria-label={`More about ${server.id}`}>
          {links.map((link) => (
            <li key={link.target}>
              <JumpLink target={link.target}>{link.label}</JumpLink>
            </li>
          ))}
        </ul>
      ) : null}

      {!syncing && passErrors.length > 0 ? (
        <div className="mt-1.5" role="alert">
          <h5 className="font-semibold text-red-800">The pass on {server.id} stopped early</h5>
          <ul className="mt-1 list-disc ml-4 space-y-1">
            {passErrors.map((passError, i) => (
              <li key={i} className="text-red-700 break-words">{truncate(passError.error)}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

/** The id of a report section of one server, safe in an id and a fragment. */
const sectionId = (kind, serverName) => `sync-${kind}-${String(serverName).replace(/[^A-Za-z0-9_-]/g, '-')}`

/** A link from a server's card to one of its report sections further down. */
function JumpLink({ target, children }) {
  return (
    <a
      href={`#${target}`}
      className="font-medium text-blue-700 underline hover:text-blue-900"
      onClick={(event) => {
        // Scroll the dialog, not the page behind it, leave the URL alone, and
        // move focus to the section (tabIndex -1), as following a link would
        event.preventDefault()
        const section = document.getElementById(target)
        section?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
        section?.focus({ preventScroll: true })
      }}
    >
      {children}
    </a>
  )
}

/**
 * "Can't play yet on <server>": the library hides these although they have a
 * video, in a format neither the player nor the transcoder takes (run/cantPlay).
 */
function CantPlaySection({ serverName, movies, tv }) {
  const id = sectionId('cant-play', serverName)
  return (
    <section id={id} tabIndex={-1} aria-labelledby={`${id}-heading`} className="focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 mb-4 scroll-mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs">
      <h4 id={`${id}-heading`} className="text-sm font-semibold text-gray-800">
        Can&apos;t play yet on {serverName}
      </h4>
      <p className="mt-1 text-gray-600">
        These titles have a video the player can&apos;t play and the transcoder doesn&apos;t serve yet, so
        they&apos;re hidden from the library. Each one says why.
      </p>
      {movies.length > 0 ? (
        <>
          <h5 className="mt-2 font-semibold text-gray-800">Movies</h5>
          <ul className="list-disc ml-4 text-gray-700">
            {movies.map((movie) => (
              <li key={movie.title}>
                <span className="font-medium">{movie.title}</span>: {movie.reason}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {tv.length > 0 ? (
        <>
          <h5 className="mt-2 font-semibold text-gray-800">TV episodes</h5>
          <ul className="list-disc ml-4 text-gray-700">
            {tv.map((season) => (
              <li key={`${season.title}|${season.season}`}>
                <span className="font-medium">
                  {season.title}, Season {season.season}
                </span>
                <ul className="list-[circle] ml-4">
                  {season.episodes.map((episode) => (
                    <li key={episode.episode}>
                      Episode {episode.episode}: {episode.reason}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  )
}

/** "On <server> but not in the library": a write failed (run/missingMedia). */
function NotInLibrarySection({ serverName, movies, tv }) {
  const headingId = `${sectionId('not-in-library', serverName)}-heading`
  return (
    <section id={sectionId('not-in-library', serverName)} tabIndex={-1} aria-labelledby={headingId} className="focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 mb-4 scroll-mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs">
      <h4 id={headingId} className="text-sm font-semibold text-red-800">
        On {serverName} but not in the library
      </h4>
      <p className="mt-1 text-red-800">The sync could not save these titles. The next sync retries these.</p>
      {movies.length > 0 ? (
        <>
          <h5 className="mt-2 font-semibold text-gray-800">Movies</h5>
          <ul className="list-disc ml-4 text-gray-800">
            {movies.map((title) => <li key={title}>{title}</li>)}
          </ul>
        </>
      ) : null}
      {tv.length > 0 ? (
        <>
          <h5 className="mt-2 font-semibold text-gray-800">TV shows</h5>
          <ul className="list-disc ml-4 text-gray-800">
            {tv.map((show) => <li key={show.showTitle}>{show.showTitle}</li>)}
          </ul>
        </>
      ) : null}
    </section>
  )
}

/** "No video file yet on <server>": listed with artwork and metadata, but nothing to play (run/syncReport). */
function NoVideoSection({ serverName, movies, tv }) {
  const headingId = `${sectionId('no-video', serverName)}-heading`
  return (
    <section id={sectionId('no-video', serverName)} tabIndex={-1} aria-labelledby={headingId} className="focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 mb-4 scroll-mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs">
      <h4 id={headingId} className="text-sm font-semibold text-gray-800">
        No video file yet on {serverName}
      </h4>
      <p className="mt-1 text-gray-600">
        These folders have artwork and metadata but no playable video. They stay out of the library&apos;s lists and
        search until a video arrives.
      </p>
      {movies.length > 0 ? (
        <>
          <h5 className="mt-2 font-semibold text-gray-800">Movies</h5>
          <ul className="list-disc ml-4 text-gray-700">
            {movies.map((movie) => (
              <li key={movie.title}>
                <span className="font-medium">{movie.title}</span>: {movie.reason}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {tv.length > 0 ? (
        <>
          <h5 className="mt-2 font-semibold text-gray-800">TV shows</h5>
          <ul className="list-disc ml-4 text-gray-700">
            {tv.map((entry) => (
              <li key={`${entry.title}|${entry.season ?? ''}`}>
                <span className="font-medium">{entry.season ? `${entry.title}, ${entry.season}` : entry.title}</span>:{' '}
                {entry.reason}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  )
}

/** What the popup says when its sync ended without running (another was still finishing). */
const BUSY_NOTICE = 'Another sync is still finishing; try again in a moment.'

/** What the popup says when the sync it joined ended at its manifests (a webhook tick that changed nothing). */
const SKIPPED_NOTICE = 'Nothing changed on the file servers since the last sync.'

// Sync summary/outcome state — these values are all part of a single sync
// run's result and are reset together, so they live in one reducer rather than
// separate useState hooks.
const INITIAL_SUMMARY = { data: null, notReady: null, duration: null, startTime: null, error: null, notice: null }

function summaryReducer(state, action) {
  switch (action.type) {
    case 'reset':
      return INITIAL_SUMMARY
    case 'complete':
      return { ...state, data: action.data, notReady: action.notReady, duration: action.duration }
    case 'startTime':
      return { ...state, startTime: action.startTime }
    case 'error':
      return { ...state, error: action.error }
    case 'notice':
      return { ...state, notice: action.notice }
    default:
      return state
  }
}

// SWR fetcher for the in-progress sync snapshot. Preserves the exact GET request
// the autoConnect effect used to issue inline.
const fetchSyncStatus = async (url) => {
  const res = await fetch(url)
  return res.json()
}

export default function SyncMediaPopup({
  isOpen,
  setIsOpen,
  updateProcessedData,
  setLastSync,
  autoConnect = false,
}) {
  const cancelButtonRef = useRef(null)
  const esRef = useRef(null)

  const [isSyncing, startSyncTransition] = useTransition()

  const [summary, dispatchSummary] = useReducer(summaryReducer, INITIAL_SUMMARY)
  const { data: syncData, notReady: syncNotReady, duration: syncDuration, startTime: syncstartTime, error: syncError, notice: syncNotice } = summary

  const [progressCounts, setProgressCounts] = useState({ processed: 0, errors: 0 })
  const deferredCounts = useDeferredValue(progressCounts)

  const [serverStates, setServerStates] = useState({})
  // Total entities to process across all servers — drives the determinate
  // progress bar and the "processed / total" label.
  const syncTotal = useMemo(
    () => Object.values(serverStates).reduce((sum, s) => sum + (s.total || 0), 0),
    [serverStates]
  )
  // When autoConnect=true the popup was opened from the Active Processes "View Info"
  // button — we know a sync is already running, so start in connecting state immediately.
  const [isConnecting, setIsConnecting] = useState(() => autoConnect)

  // Force refresh passes every title in full, ignoring the per-server sync
  // gates (forceSync). Default off: a typical sync skips the titles whose
  // gates show nothing changed.
  const [forceRefresh, setForceRefresh] = useState(false)
  // Whether the sync this popup started was a forced one: its unchanged titles
  // were checked in full rather than skipped
  const [startedForced, setStartedForced] = useState(false)

  useEffect(() => {
    return () => { esRef.current?.close() }
  }, [])

  /**
   * Subscribe to an SSE sync stream and update component state with events.
   * Shared by both "start sync" and "join in-progress sync" code paths.
   *
   * skipReplayed — when true, replayed events are ignored (state was already
   * pre-populated from the snapshot). Only __sync_complete__ is never skipped
   * so the popup closes correctly even if sync finished during connection setup.
   *
   * operationId — the sync this popup started or joined (the route's id for
   * it). Its warm-up and completion carry it: only its completion ends the
   * popup's wait, replayed or live, and a fresh sync's progress counts only
   * from its own warm-up on. A joined sync's live events are its own: the
   * route runs one sync at a time.
   */
  const subscribeToStream = (streamUrl, { skipReplayed = false, operationId } = {}) => {
    return new Promise((resolve, reject) => {
      if (!operationId) {
        reject(new Error('The sync route answered without an operation id'))
        return
      }
      const es = new EventSource(`${streamUrl}?operationId=${encodeURIComponent(operationId)}`)
      esRef.current = es

      // Set by this sync's completion: nothing after it changes the report
      let finished = false
      // Whether the events now arriving are this sync's
      let inRun = skipReplayed
      es.onmessage = (event) => {
        if (finished) return
        let payload
        try { payload = JSON.parse(event.data) } catch { return }
        if (payload.type === 'heartbeat') return

        if (payload.entityId === '__sync_warmup__') {
          inRun = payload.data?.operationId === operationId
          return
        }
        const own = payload.data?.operationId === operationId
        if (payload.entityId === '__sync_complete__' ? !own : !inRun) return

        // When joining mid-sync with a pre-populated snapshot, skip replayed
        // events — state is already correct from the snapshot. Always process
        // __sync_complete__ so the popup closes if sync finished during connect.
        if (skipReplayed && payload.replayed && payload.entityId !== '__sync_complete__') return

        if (payload.entityId === '__sync_complete__') {
          finished = true
          es.close()
          if (payload.data?.outcome === 'busy') {
            dispatchSummary({ type: 'notice', notice: BUSY_NOTICE })
            resolve()
            return
          }
          if (payload.data?.outcome === 'failed') {
            dispatchSummary({ type: 'error', error: payload.data.error || 'the sync failed' })
            resolve()
            return
          }
          // A tick this popup joined that ended at its manifests: nothing to report
          if (payload.data?.outcome === 'skipped') {
            dispatchSummary({ type: 'notice', notice: SKIPPED_NOTICE })
          }
          const completeSummary = payload.data?.summary || {}
          dispatchSummary({
            type: 'complete',
            data: {
              missingMedia: completeSummary.missingMedia || {},
              titleCounts: completeSummary.titleCounts || {},
              cantPlay: completeSummary.cantPlay || {},
              errors: Array.isArray(completeSummary.errors) ? completeSummary.errors : [],
            },
            notReady: { noVideo: completeSummary.noVideo || {} },
            duration: completeSummary.duration ?? null,
          })
          updateProcessedData('media')
          setLastSync(new Date())
          resolve()
          return
        }

        if (payload.entityId === '__server_start__') {
          const sid = payload.serverId
          const serverTotal = payload.data?.total ?? 0
          setServerStates(prev => ({
            ...prev,
            [sid]: { id: sid, status: 'syncing', currentEntity: null, currentOperation: null, processed: 0, total: serverTotal, errorCount: 0, errors: [] },
          }))
          return
        }

        if (payload.entityId === '__server_complete__') {
          const sid = payload.serverId
          setServerStates(prev => {
            const existing = prev[sid] || { id: sid, processed: 0, errorCount: 0, errors: [] }
            return { ...prev, [sid]: { ...existing, status: 'complete', currentEntity: null, currentOperation: null } }
          })
          return
        }

        const sid = payload.serverId
        if (sid) {
          setServerStates(prev => {
            const s = prev[sid] || {
              id: sid,
              status: 'syncing',
              currentEntity: null,
              currentOperation: null,
              processed: 0,
              errorCount: 0,
              errors: [],
            }

            const next = { ...s }

            if (payload.type === 'progress' || payload.type === 'started') {
              next.currentEntity = payload.entityId || null
              next.currentOperation = payload.operation || null
            }

            if (payload.type === 'complete') {
              // Only increment per-server counts for live events — replayed events
              // would double-count on top of the snapshot-pre-populated values.
              if (!payload.replayed) next.processed = (s.processed || 0) + 1
              next.currentEntity = payload.entityId || null
              next.currentOperation = payload.operation || null
            }

            if (payload.type === 'error' && payload.error && !payload.replayed) {
              next.errorCount = (s.errorCount || 0) + 1
              next.errors = [...(s.errors || []), {
                entityId: payload.entityId,
                mediaType: payload.mediaType,
                operation: payload.operation || null,
                error: payload.error,
              }]
            }

            return { ...prev, [sid]: next }
          })
        }

        if (skipReplayed) {
          // In skip-replayed mode the snapshot is the baseline — the SSE stream's
          // own totals restart from 0 and may never reach the snapshot value, so
          // Math.max would stay frozen. Instead, count each live event directly.
          if (payload.type === 'complete') {
            setProgressCounts(prev => ({ processed: prev.processed + 1, errors: prev.errors }))
          } else if (payload.type === 'error') {
            setProgressCounts(prev => ({ processed: prev.processed, errors: prev.errors + 1 }))
          }
        } else if (payload.totals) {
          setProgressCounts(prev => ({
            processed: Math.max(prev.processed, payload.totals.processed ?? 0),
            errors: Math.max(prev.errors, payload.totals.errors ?? 0),
          }))
        }
      }

      es.onerror = () => {
        es.close()
        reject(new Error('Sync stream connection lost'))
      }
    })
  }

  // Auto-connect to an in-progress sync when the popup is opened via "View Info".
  // autoConnect=true means we already know a sync is running — the connecting
  // indicator is already visible because isConnecting was initialized from the prop.
  //
  // The status snapshot is fetched via SWR (key disabled until the popup is open
  // in autoConnect mode and no sync run is active locally). All revalidation is
  // disabled so the one-shot snapshot can't refetch and clobber live progress;
  // the connect-and-subscribe work runs in onSuccess (a callback, not an effect).
  const autoConnectedRef = useRef(false)
  useEffect(() => {
    // Allow a fresh connect each time the popup is reopened.
    if (!isOpen) autoConnectedRef.current = false
  }, [isOpen])

  useSWR(
    isOpen && autoConnect && !isSyncing && syncData === null
      ? '/api/authenticated/admin/sync-status'
      : null,
    fetchSyncStatus,
    {
      revalidateOnFocus: false,
      revalidateIfStale: false,
      revalidateOnReconnect: false,
      shouldRetryOnError: false,
      onSuccess: (status) => {
        if (autoConnectedRef.current) return
        autoConnectedRef.current = true

        if (!status.active) {
          // Sync finished between click and popup opening
          setIsConnecting(false)
          return
        }

        dispatchSummary({ type: 'startTime', startTime: status.startTime })

        // Pre-populate state from the server-side snapshot so the user immediately
        // sees all servers (including completed ones) and accurate processed counts,
        // rather than waiting for SSE replay which may be incomplete.
        if (status.snapshot) {
          setServerStates(status.snapshot.servers || {})
          setProgressCounts({
            processed: status.snapshot.totals?.processed ?? 0,
            errors: status.snapshot.totals?.errors ?? 0,
          })
        }

        startSyncTransition(async () => {
          setIsConnecting(false)
          try {
            // skipReplayed=true because snapshot already represents state at
            // connect-time — replayed events would re-animate old entities and
            // hold the counter frozen until replay catches up to snapshot value.
            await subscribeToStream(status.streamUrl, { skipReplayed: !!status.snapshot, operationId: status.operationId })
          } catch (err) {
            dispatchSummary({ type: 'error', error: err.message })
          }
        })
      },
      onError: () => {
        if (autoConnectedRef.current) return
        autoConnectedRef.current = true
        setIsConnecting(false)
      },
    }
  )

  const handleSyncClick = () => {
    dispatchSummary({ type: 'reset' })
    setProgressCounts({ processed: 0, errors: 0 })
    setServerStates({})

    startSyncTransition(async () => {
      try {
        const response = await fetch('/api/authenticated/admin/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ forceSync: forceRefresh }),
        })
        const data = await response.json()
        const { streamUrl, startTime: syncStart, alreadyRunning, operationId } = data

        if (syncStart) dispatchSummary({ type: 'startTime', startTime: syncStart })

        if (alreadyRunning) {
          // Sync was already in progress — fetch snapshot to pre-populate state,
          // same as the autoConnect path, so replay issues don't affect the counter.
          try {
            const statusRes = await fetch('/api/authenticated/admin/sync-status')
            const status = await statusRes.json()
            if (status.startTime) dispatchSummary({ type: 'startTime', startTime: status.startTime })
            if (status.snapshot) {
              setServerStates(status.snapshot.servers || {})
              setProgressCounts({
                processed: status.snapshot.totals?.processed ?? 0,
                errors: status.snapshot.totals?.errors ?? 0,
              })
            }
          } catch {
            // Snapshot fetch failed — proceed without it, replay will have to do
          }
          // The sync this popup joined, not one it started: its options are unknown
          setStartedForced(false)
          await subscribeToStream(streamUrl, { skipReplayed: true, operationId })
        } else {
          setStartedForced(forceRefresh)
          await subscribeToStream(streamUrl, { operationId })
        }
      } catch (err) {
        console.error('Sync failed:', err)
        dispatchSummary({ type: 'error', error: err.message })
      }
    })
  }

  const isComplete = !isSyncing && syncData !== null
  // The servers of the finished sync: those the stream showed, and any the
  // report counted that it did not
  const reportServers = isComplete
    ? [...new Set([...Object.keys(serverStates), ...Object.keys(syncData.titleCounts ?? {})])].map((id) => ({
        ...(serverStates[id] ?? { id, errorCount: 0, errors: [] }),
        status: 'complete',
      }))
    : []
  // Errors of the run itself, not of one server's pass
  const runErrors = isComplete ? syncData.errors.filter((e) => !e.serverId) : []
  // Per server, links from its card to its "Can't play yet" and "No video
  // file yet" sections, when they list anything
  // What the live region says: the sync's state, once it changes
  const announcement = isSyncing
    ? 'Syncing…'
    : isComplete
      ? 'Sync finished. The report is below.'
      : syncError !== null
        ? `Sync encountered an error: ${syncError}`
        : (syncNotice ?? '')
  const reportLinks = (serverId) => {
    const links = []
    // The real problem first: titles the server has that the sync could not save
    const missing = syncData?.missingMedia?.[serverId]
    const notInLibrary = (missing?.movies?.length ?? 0) + (missing?.tv?.length ?? 0)
    if (notInLibrary > 0) {
      links.push({ target: sectionId('not-in-library', serverId), label: `${formatCount(notInLibrary)} not in the library` })
    }
    const cantPlay = syncData?.cantPlay?.[serverId]?.count ?? 0
    if (cantPlay > 0) {
      links.push({ target: sectionId('cant-play', serverId), label: `${formatCount(cantPlay)} can't play yet` })
    }
    const noVideo = syncNotReady?.noVideo?.[serverId]
    const noVideoTitles = noVideo ? (noVideo.movies?.length ?? 0) + new Set((noVideo.tv ?? []).map((e) => e.title)).size : 0
    if (noVideoTitles > 0) {
      links.push({ target: sectionId('no-video', serverId), label: `${formatCount(noVideoTitles)} with no video file yet` })
    }
    return links
  }

  return (
    <Transition.Root show={isOpen} as={Fragment}>
      <Dialog
        as="div"
        className="relative z-10 text-black"
        initialFocus={cancelButtonRef}
        onClose={setIsOpen}
      >
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" />
        </Transition.Child>

        <div className="fixed inset-0 z-10 w-screen overflow-y-auto">
          <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            >
              <Dialog.Panel className="transform overflow-hidden rounded-lg bg-white px-4 pt-5 pb-4 text-left shadow-xl transition-all sm:my-8 sm:max-w-lg sm:w-full sm:p-6">
                <div className="sm:flex sm:items-start">
                  {SYNC_ICON}

                  <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left w-full">
                    <Dialog.Title
                      as="h3"
                      className="text-lg leading-6 font-medium text-gray-900"
                    >
                      Sync Media Files
                    </Dialog.Title>

                    {/* Says when the report replaces "Syncing...", for screen readers */}
                    <p className="sr-only" role="status" aria-live="polite">
                      {announcement}
                    </p>

                    <div className="mt-2">
                      <p className="text-sm text-gray-500">
                        Checks every title on each file server and updates anything that changed. This usually
                        takes about 10 seconds.
                      </p>

                      <hr className="my-4" />

                      {!isSyncing && !isConnecting && !isComplete && syncError === null ? (
                        <label className="flex items-start gap-2 mb-4 cursor-pointer text-sm">
                          <input
                            type="checkbox"
                            checked={forceRefresh}
                            onChange={(e) => setForceRefresh(e.target.checked)}
                            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span>
                            <span className="font-medium text-gray-900">Force refresh</span>
                            <span className="block text-xs text-gray-500">
                              Passes every title in full, ignoring each server&apos;s sync gates (the check
                              that skips a title when nothing on the server changed). Slower, but redoes titles
                              whose files did not change, e.g. after a settings change.
                            </span>
                          </span>
                        </label>
                      ) : null}

                      {isConnecting && !isSyncing ? (
                        <div className="mb-4">
                          <div className="flex items-center gap-2 text-sm text-gray-500 py-1">
                            <svg className="w-4 h-4 text-blue-400 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                            </svg>
                            <span>Connecting to active sync…</span>
                          </div>
                        </div>
                      ) : null}

                      {isSyncing ? (
                        <div className="mb-4">
                          {Object.keys(serverStates).length === 0 ? (
                            <div className="flex items-center gap-2 text-sm text-gray-500 py-1">
                              <svg className="w-4 h-4 text-blue-400 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                              </svg>
                              <span>Initializing sync…</span>
                            </div>
                          ) : (
                            <>
                              <div className="flex justify-between text-xs text-gray-500 mb-1">
                                <span>Syncing…</span>
                                <span>
                                  {deferredCounts.processed}{syncTotal > 0 ? `/${syncTotal}` : ''} processed
                                  {deferredCounts.errors > 0 ? (
                                    <span className="text-red-500 ml-2">{deferredCounts.errors} errors</span>
                                  ) : null}
                                </span>
                              </div>
                              <div className="w-full bg-gray-200 rounded-full h-1 overflow-hidden mb-3">
                                {syncTotal > 0 ? (
                                  <div
                                    className="h-1 bg-blue-500 rounded-full transition-all duration-300"
                                    style={{ width: `${Math.min(100, Math.round((deferredCounts.processed / syncTotal) * 100))}%` }}
                                  />
                                ) : (
                                  <div className="h-1 bg-blue-500 rounded-full animate-pulse w-full" />
                                )}
                              </div>

                              <div className="space-y-2">
                                {Object.values(serverStates).map(server => (
                                  <ServerCard key={server.id} server={server} />
                                ))}
                              </div>
                            </>
                          )}
                        </div>
                      ) : null}

                      {isComplete && reportServers.length > 0 ? (
                        <div className="mb-4 space-y-2">
                          {reportServers.map(server => (
                            <ServerCard
                              key={server.id}
                              server={server}
                              counts={syncData.titleCounts?.[server.id] ?? null}
                              passErrors={syncData.errors.filter((e) => e.serverId === server.id)}
                              forced={startedForced}
                              links={reportLinks(server.id)}
                            />
                          ))}
                        </div>
                      ) : null}

                      {isComplete && runErrors.length > 0 ? (
                        <section aria-labelledby="sync-run-errors" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs" role="alert">
                          <h4 id="sync-run-errors" className="text-sm font-semibold text-red-800">The sync reported errors</h4>
                          <ul className="mt-1 list-disc ml-4 space-y-1 text-red-700">
                            {runErrors.map((runError, i) => (
                              <li key={i} className="break-words">{truncate(runError.error)}</li>
                            ))}
                          </ul>
                        </section>
                      ) : null}

                      {syncError !== null ? (
                        <p className="text-sm text-red-600 mb-4">
                          Sync encountered an error: {syncError}
                        </p>
                      ) : null}

                      {syncNotice !== null ? <p className="text-sm text-gray-700 mb-4">{syncNotice}</p> : null}

                      {syncData !== null
                        ? Object.entries(syncData.missingMedia).map(([serverName, { tv = [], movies = [] }]) =>
                            tv.length > 0 || movies.length > 0 ? (
                              <NotInLibrarySection key={serverName} serverName={serverName} movies={movies} tv={tv} />
                            ) : null
                          )
                        : null}

                      {syncData !== null
                        ? Object.entries(syncData.cantPlay).map(([serverName, { tv = [], movies = [] }]) =>
                            tv.length > 0 || movies.length > 0 ? (
                              <CantPlaySection key={serverName} serverName={serverName} movies={movies} tv={tv} />
                            ) : null
                          )
                        : null}

                      {syncNotReady !== null
                        ? Object.entries(syncNotReady.noVideo).map(([serverName, { tv = [], movies = [] }]) =>
                            tv.length > 0 || movies.length > 0 ? (
                              <NoVideoSection key={serverName} serverName={serverName} movies={movies} tv={tv} />
                            ) : null
                          )
                        : null}

                      {syncstartTime !== null && syncDuration !== null ? (
                        <div className="mt-4 bg-gradient-to-r from-gray-50 to-gray-100 p-4 rounded-lg shadow-sm border border-gray-200">
                          <div className="space-y-3">
                            <div className="flex items-center justify-between p-3 bg-white rounded-md shadow-sm hover:shadow-md transition-shadow duration-200">
                              <div className="flex items-center">
                                <span aria-hidden="true" className="text-xl mr-2">🕒</span>
                                <span className="text-xs font-medium text-gray-600">Started</span>
                              </div>
                              <span className="text-xs font-semibold text-blue-600">
                                {new Date(syncstartTime).toLocaleString('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                  year: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  second: '2-digit',
                                  hour12: true
                                })}
                              </span>
                            </div>

                            <div className="flex items-center justify-between p-3 bg-white rounded-md shadow-sm hover:shadow-md transition-shadow duration-200">
                              <div className="flex items-center">
                                <span aria-hidden="true" className="text-xl mr-2">🏁</span>
                                <span className="text-xs font-medium text-gray-600">Ended</span>
                              </div>
                              <span className="text-xs font-semibold text-blue-600">
                                {new Date(new Date(syncstartTime).getTime() + (syncDuration * 1000)).toLocaleString('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                  year: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  second: '2-digit',
                                  hour12: true
                                })}
                              </span>
                            </div>

                            <div className="flex items-center justify-between p-3 bg-white rounded-md shadow-sm hover:shadow-md transition-shadow duration-200">
                              <div className="flex items-center">
                                <span aria-hidden="true" className="text-xl mr-2">⏱️</span>
                                <span className="text-xs font-medium text-gray-600">Duration</span>
                              </div>
                              <span className="text-xs font-semibold text-blue-600">
                                {syncDuration < 60
                                  ? `${syncDuration.toFixed(2)} seconds`
                                  : `${(syncDuration / 60).toFixed(2)} minutes`}
                              </span>
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="mt-5 sm:mt-4 sm:flex sm:flex-row-reverse">
                  <button
                    type="button"
                    className={classNames(
                      isSyncing
                        ? 'bg-gray-400 hover:bg-gray-700 focus:ring-gray-500 cursor-not-allowed'
                        : isComplete
                          ? 'bg-green-600 hover:bg-green-700 focus:ring-green-500'
                          : 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500',
                      'w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2  text-base font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 sm:ml-3 sm:w-auto sm:text-sm'
                    )}
                    onClick={isComplete ? () => setIsOpen(false) : handleSyncClick}
                    disabled={isSyncing}
                  >
                    {isComplete ? 'Done' : isSyncing ? 'Syncing...' : 'Sync'}
                  </button>
                  {!isComplete ? (
                    <button
                      type="button"
                      className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:w-auto sm:text-sm"
                      onClick={() => setIsOpen(false)}
                      ref={cancelButtonRef}
                    >
                      Cancel
                    </button>
                  ) : null}
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  )
}