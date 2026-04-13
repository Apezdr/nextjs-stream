'use client'

import { Dialog, Transition } from '@headlessui/react'
import { Fragment, useEffect, useRef, useState, useDeferredValue, useTransition } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
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
      <svg className="w-3 h-3 text-blue-500 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
      </svg>
    )
  }
  if (status === 'complete') {
    return <div className="w-2.5 h-2.5 rounded-full bg-green-500 shrink-0" />
  }
  return <div className="w-2.5 h-2.5 rounded-full bg-gray-300 shrink-0" />
}

function AnimatedTicker({
  value,
  className = '',
  minIntervalMs = 280,
  heightClass = 'h-10',
  spring = false,
}) {
  const [displayValue, setDisplayValue] = useState(value ?? null)
  const [renderKey, setRenderKey] = useState(0)

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
        setDisplayValue(latest)
        setRenderKey(prev => prev + 1)
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
              setDisplayValue(latest)
              setRenderKey(prev => prev + 1)
            }, wait)
          }
        }}
      >
        <motion.span
          key={`${renderKey}-${displayValue}`}
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

function ServerCard({ server }) {
  const [errorsExpanded, setErrorsExpanded] = useState(false)
  const hasErrors = server.errorCount > 0

  const cardClass = server.status === 'syncing'
    ? 'border-blue-200 bg-blue-50'
    : hasErrors
      ? 'border-amber-200 bg-amber-50'
      : 'border-green-200 bg-green-50'

  const statusLabel = server.status === 'syncing'
    ? 'Syncing'
    : `Done · ${server.processed} synced`

  return (
    <div className={`rounded-lg border p-2.5 text-xs transition-colors ${cardClass}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <StatusDot status={server.status} />
          <span className="font-semibold text-gray-800 truncate">{server.id}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0 text-gray-500">
          <span>{statusLabel}</span>
          {hasErrors ? (
            <button
              onClick={() => setErrorsExpanded(e => !e)}
              className="text-red-600 font-medium hover:underline focus:outline-none"
            >
              {server.errorCount} error{server.errorCount !== 1 ? 's' : ''} {errorsExpanded ? '▲' : '▼'}
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
        <ul className="mt-2 max-h-40 overflow-y-auto space-y-1 border-t border-amber-200 pt-2">
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
    </div>
  )
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

  const [syncData, setSyncData] = useState(null)
  const [syncNotReady, setSyncNotReady] = useState(null)
  const [syncDuration, setSyncDuration] = useState(null)
  const [syncstartTime, setSyncstartTime] = useState(null)
  const [syncError, setSyncError] = useState(null)

  const [progressCounts, setProgressCounts] = useState({ processed: 0, errors: 0 })
  const deferredCounts = useDeferredValue(progressCounts)

  const [serverStates, setServerStates] = useState({})
  // When autoConnect=true the popup was opened from the Active Processes "View Info"
  // button — we know a sync is already running, so start in connecting state immediately.
  const [isConnecting, setIsConnecting] = useState(autoConnect)

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
   */
  const subscribeToStream = (streamUrl, { skipReplayed = false } = {}) => {
    return new Promise((resolve, reject) => {
      const es = new EventSource(streamUrl)
      esRef.current = es

      es.onmessage = (event) => {
        let payload
        try { payload = JSON.parse(event.data) } catch { return }
        if (payload.type === 'heartbeat') return

        // When joining mid-sync with a pre-populated snapshot, skip replayed
        // events — state is already correct from the snapshot. Always process
        // __sync_complete__ so the popup closes if sync finished during connect.
        if (skipReplayed && payload.replayed && payload.entityId !== '__sync_complete__') return

        if (payload.entityId === '__sync_complete__') {
          const summary = payload.data?.summary || {}
          setSyncData({ missingMedia: summary.missingMedia || {} })
          setSyncNotReady({ missingMp4: summary.missingMp4 || {} })
          setSyncDuration(summary.duration ?? null)
          updateProcessedData('media')
          setLastSync(new Date())
          es.close()
          resolve()
          return
        }

        if (payload.entityId === '__sync_warmup__') return

        if (payload.entityId === '__server_start__') {
          const sid = payload.serverId
          setServerStates(prev => ({
            ...prev,
            [sid]: { id: sid, status: 'syncing', currentEntity: null, currentOperation: null, processed: 0, errorCount: 0, errors: [] },
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
  useEffect(() => {
    if (!isOpen || !autoConnect || isSyncing || syncData !== null) return

    let cancelled = false

    const connect = async () => {
      try {
        const res = await fetch('/api/authenticated/admin/sync-status')
        const status = await res.json()
        if (cancelled) return

        if (!status.active) {
          // Sync finished between click and popup opening
          setIsConnecting(false)
          return
        }

        setSyncstartTime(status.startTime)

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
          if (!cancelled) setIsConnecting(false)
          try {
            // skipReplayed=true because snapshot already represents state at
            // connect-time — replayed events would re-animate old entities and
            // hold the counter frozen until replay catches up to snapshot value.
            await subscribeToStream(status.streamUrl, { skipReplayed: !!status.snapshot })
          } catch (err) {
            if (!cancelled) setSyncError(err.message)
          }
        })
      } catch {
        if (!cancelled) setIsConnecting(false)
      }
    }

    connect()
    return () => { cancelled = true }
  }, [isOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSyncClick = () => {
    setSyncData(null)
    setSyncNotReady(null)
    setSyncDuration(null)
    setSyncstartTime(null)
    setSyncError(null)
    setProgressCounts({ processed: 0, errors: 0 })
    setServerStates({})

    startSyncTransition(async () => {
      try {
        const response = await fetch('/api/authenticated/admin/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
        const data = await response.json()
        const { streamUrl, startTime: syncStart, alreadyRunning } = data

        if (syncStart) setSyncstartTime(syncStart)

        if (alreadyRunning) {
          // Sync was already in progress — fetch snapshot to pre-populate state,
          // same as the autoConnect path, so replay issues don't affect the counter.
          try {
            const statusRes = await fetch('/api/authenticated/admin/sync-status')
            const status = await statusRes.json()
            if (status.startTime) setSyncstartTime(status.startTime)
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
          await subscribeToStream(streamUrl, { skipReplayed: true })
        } else {
          await subscribeToStream(streamUrl)
        }
      } catch (err) {
        console.error('Sync failed:', err)
        setSyncError(err.message)
      }
    })
  }

  const isComplete = !isSyncing && syncData !== null

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

                    <div className="mt-2">
                      <p className="text-sm text-gray-500">
                        Are you sure you want to sync the media files? This action
                        will update your local media database with the latest files
                        from the server.
                      </p>

                      <hr className="my-4" />

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
                                  {deferredCounts.processed} processed
                                  {deferredCounts.errors > 0 ? (
                                    <span className="text-red-500 ml-2">{deferredCounts.errors} errors</span>
                                  ) : null}
                                </span>
                              </div>
                              <div className="w-full bg-gray-200 rounded-full h-1 overflow-hidden mb-3">
                                <div className="h-1 bg-blue-500 rounded-full animate-pulse w-full" />
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

                      {isComplete && Object.keys(serverStates).length > 0 ? (
                        <div className="mb-4 space-y-2">
                          {Object.values(serverStates).map(server => (
                            <ServerCard key={server.id} server={server} />
                          ))}
                        </div>
                      ) : null}

                      {syncError !== null ? (
                        <p className="text-sm text-red-600 mb-4">
                          Sync encountered an error: {syncError}
                        </p>
                      ) : null}

                      {syncData !== null ? (
                        <>
                          {Object.entries(syncData.missingMedia).map(
                            ([serverName, { tv, movies }]) => {
                              const hasTv = tv && tv.length > 0
                              const hasMovies = movies && movies.length > 0

                              if (!hasTv && !hasMovies) return null

                              return (
                                <div className="mb-4" key={serverName}>
                                  <h2 className="text-xs font-bold underline">
                                    Missing Media from <span className="text-blue-600">{serverName}</span>
                                  </h2>

                                  {hasTv ? (
                                    <div className="mt-2">
                                      <h3 className="text-xs font-bold text-center">
                                        Missing TV Shows
                                      </h3>
                                      <ul className="mt-1">
                                        {tv.map((show, showIndex) => (
                                          <li className="font-bold" key={showIndex}>
                                            {show.showTitle}
                                            <ul className="ml-4 font-normal">
                                              {show.seasons.map((season, seasonIndex) => (
                                                <li className="text-xs" key={seasonIndex}>
                                                  {typeof season === 'string' ? (
                                                    season
                                                  ) : (
                                                    <div>
                                                      <span className="font-semibold">
                                                        Season: {season.season}
                                                      </span>
                                                      <ul className="ml-8">
                                                        {season.missingEpisodes.map((episode, episodeIndex) => (
                                                          <li key={episodeIndex}>
                                                            {typeof episode === 'string'
                                                              ? episode
                                                              : episode.episodeFileName}
                                                          </li>
                                                        ))}
                                                      </ul>
                                                    </div>
                                                  )}
                                                </li>
                                              ))}
                                            </ul>
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  ) : null}

                                  {hasMovies ? (
                                    <div className="mt-3">
                                      <h3 className="text-xs font-bold text-center">
                                        Missing Movies
                                      </h3>
                                      <ul className="list-disc ml-4">
                                        {movies.map((movie, index) => (
                                          <li key={index}>{movie}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  ) : null}
                                </div>
                              )
                            }
                          )}
                        </>
                      ) : null}

                      {syncNotReady !== null ? (
                        <>
                          {Object.entries(syncNotReady.missingMp4).map(
                            ([serverName, { tv, movies }]) => {
                              const hasTv = tv && tv.length > 0
                              const hasMovies = movies && movies.length > 0

                              if (!hasTv && !hasMovies) return null

                              return (
                                <div
                                  key={serverName}
                                  className="p-4 mb-4 rounded-lg border border-gray-500"
                                >
                                  <h2 className="text-xs font-bold underline text-red-800 text-center">
                                    Missing MP4 Files on <span className="text-black">{serverName}</span>
                                  </h2>

                                  {hasMovies ? (
                                    <div className="mt-2">
                                      <h3 className="text-xs font-bold underline text-red-600 text-center">
                                        Movies
                                      </h3>
                                      <ul className="text-red-600 text-xs list-disc ml-4 mt-1">
                                        {movies.map((movie, index) => (
                                          <li key={index}>{movie}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  ) : null}

                                  {hasTv ? (
                                    <div className="mt-4">
                                      <h3 className="text-xs font-bold underline text-red-600 text-center">
                                        TV Shows
                                      </h3>
                                      <ul className="text-red-600 text-xs list-disc ml-4 mt-1">
                                        {tv.map((tvShow, index) => (
                                          <li key={index}>{tvShow}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  ) : null}
                                </div>
                              )
                            }
                          )}
                        </>
                      ) : null}

                      {syncstartTime !== null && syncDuration !== null ? (
                        <div className="mt-4 bg-gradient-to-r from-gray-50 to-gray-100 p-4 rounded-lg shadow-sm border border-gray-200">
                          <div className="space-y-3">
                            <div className="flex items-center justify-between p-3 bg-white rounded-md shadow-sm hover:shadow-md transition-shadow duration-200">
                              <div className="flex items-center">
                                <span className="text-xl mr-2">🕒</span>
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
                                <span className="text-xl mr-2">🏁</span>
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
                                <span className="text-xl mr-2">⏱️</span>
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
                        : 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500',
                      'w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2  text-base font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 sm:ml-3 sm:w-auto sm:text-sm'
                    )}
                    onClick={handleSyncClick}
                    disabled={isSyncing}
                  >
                    {isComplete ? 'Sync Complete' : isSyncing ? 'Syncing...' : 'Sync'}
                  </button>
                  <button
                    type="button"
                    className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:w-auto sm:text-sm"
                    onClick={() => setIsOpen(false)}
                    ref={cancelButtonRef}
                  >
                    Cancel
                  </button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  )
}