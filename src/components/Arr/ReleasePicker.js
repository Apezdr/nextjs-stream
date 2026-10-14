'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'react-toastify'
import { classNames } from '@src/utils'
import { arrServiceName, fetchReleaseSearch, grabRelease, startReleaseSearch } from './arrApi'

const POLL_MS = 2_000

/** "best" keeps the service's own order: its idea of the best release first. */
const SORTS = [
  { value: 'best', label: 'Best match', compare: null },
  { value: 'newest', label: 'Newest', compare: (a, b) => (a.ageHours ?? Infinity) - (b.ageHours ?? Infinity) },
  { value: 'largest', label: 'Largest', compare: (a, b) => (b.sizeBytes ?? -1) - (a.sizeBytes ?? -1) },
  { value: 'smallest', label: 'Smallest', compare: (a, b) => (a.sizeBytes ?? Infinity) - (b.sizeBytes ?? Infinity) },
]

export function formatSize(bytes) {
  if (typeof bytes !== 'number') return null
  const gb = bytes / 1024 ** 3
  if (gb >= 1) return `${gb.toFixed(gb >= 100 ? 0 : 1)} GB`
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`
}

export function formatAge(hours) {
  if (typeof hours !== 'number') return null
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`
  if (hours < 48) return `${Math.round(hours)} h`
  const days = Math.round(hours / 24)
  return days < 365 ? `${days} d` : `${(days / 365).toFixed(1)} y`
}

function facts(release) {
  const languages =
    release.languages.length > 0 && !(release.languages.length === 1 && release.languages[0] === 'English')
      ? release.languages.join(', ')
      : null
  return [
    release.coverage,
    release.quality,
    formatSize(release.sizeBytes),
    formatAge(release.ageHours),
    release.indexer,
    release.protocol === 'torrent' && release.seeders !== null ? `${release.seeders} seeders` : null,
    release.customFormatScore ? `Score ${release.customFormatScore > 0 ? '+' : ''}${release.customFormatScore}` : null,
    languages,
    release.edition,
  ].filter(Boolean)
}

function GrabButton({ release, grabbed, grabbing, disabled, canGrabRejected, onGrab }) {
  // A rejected release can still be grabbed, as in Radarr/Sonarr, but asks
  // twice, and only managers may: a rejection is often the title's quality
  // profile saying no, which a requester's role is limited to.
  const [confirming, setConfirming] = useState(false)
  if (grabbed) {
    return (
      <span className="shrink-0 rounded-md bg-green-500/15 px-3 py-1.5 text-xs font-semibold text-green-300">Grabbed</span>
    )
  }
  const rejected = !release.approved
  if (rejected && !canGrabRejected) {
    return <span className="shrink-0 px-2 py-1.5 text-xs text-gray-500">Managers only</span>
  }
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        if (rejected && !confirming) setConfirming(true)
        else onGrab(release)
      }}
      onBlur={() => setConfirming(false)}
      className={classNames(
        'shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50',
        !rejected && 'bg-indigo-600 text-white hover:bg-indigo-500',
        rejected && !confirming && 'text-amber-300 ring-1 ring-inset ring-amber-400/50 hover:bg-amber-500/10',
        rejected && confirming && 'bg-amber-500 text-gray-900 hover:bg-amber-400'
      )}
    >
      {grabbing ? 'Grabbing…' : rejected ? (confirming ? 'Grab anyway' : 'Grab…') : 'Grab'}
    </button>
  )
}

/**
 * The service's interactive search for one title, and a grab from its
 * results: a movie (target null), or a show's { seasonNumber } / { episodeId }.
 * `target` must keep its identity between renders: a new object searches again.
 */
export default function ReleasePicker({ item, target, canGrabRejected = false, onGrabbed }) {
  const service = arrServiceName(item.mediaType)
  const [search, setSearch] = useState(null)
  const [error, setError] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const [startedAt, setStartedAt] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())
  const [sort, setSort] = useState('best')
  const [hideRejected, setHideRejected] = useState(false)
  const [grabbing, setGrabbing] = useState(null)
  const [grabbedIds, setGrabbedIds] = useState(() => new Set())
  const [expired, setExpired] = useState(false)

  // Start the search (or join the same one running), then follow it.
  useEffect(() => {
    let cancelled = false
    let timer = null
    const fail = (failure) => !cancelled && setError(failure.message)
    const follow = (view) => {
      if (cancelled) return
      setSearch(view)
      if (view.state === 'searching') {
        timer = setTimeout(() => fetchReleaseSearch(view.id).then(follow, fail), POLL_MS)
      }
    }
    startReleaseSearch(item, target).then(follow, fail)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [item, target, attempt])

  const searching = !error && (!search || search.state === 'searching')
  useEffect(() => {
    if (!searching) return undefined
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [searching])

  const searchAgain = () => {
    setSearch(null)
    setError(null)
    setExpired(false)
    setGrabbedIds(new Set())
    setStartedAt(Date.now())
    setNow(Date.now())
    setAttempt((count) => count + 1)
  }

  const releases = useMemo(() => {
    const all = search?.releases ?? []
    const shown = hideRejected ? all.filter((release) => release.approved) : all
    const { compare } = SORTS.find((option) => option.value === sort)
    return compare ? [...shown].sort(compare) : shown
  }, [search, sort, hideRejected])

  const grab = async (release) => {
    setGrabbing(release.id)
    try {
      const result = await grabRelease(search.id, release.id)
      setGrabbedIds((previous) => new Set(previous).add(release.id))
      toast.success(`${service} is downloading “${result.title}”.`)
      if (!result.monitored) toast.warn(`Downloading, but ${service} couldn’t be told to keep it monitored.`)
      onGrabbed?.(result)
    } catch (failure) {
      if (failure.status === 410) setExpired(true)
      else toast.error(failure.message)
    } finally {
      setGrabbing(null)
    }
  }

  const searchAgainButton = (
    <button
      type="button"
      onClick={searchAgain}
      className="rounded-md bg-gray-700 px-3 py-1.5 text-sm font-medium text-gray-100 hover:bg-gray-600"
    >
      Search again
    </button>
  )

  if (error || search?.state === 'failed') {
    return (
      <div className="space-y-3 py-2">
        <p className="text-sm text-red-400" role="alert">
          {error ?? search.failure.message}
        </p>
        {searchAgainButton}
      </div>
    )
  }

  if (searching) {
    return (
      <div role="status" className="space-y-1 py-6 text-sm">
        <p className="flex items-center gap-2 text-gray-200">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-500 border-t-indigo-400" aria-hidden="true" />
          Searching {service}’s indexers… {Math.max(0, Math.round((now - startedAt) / 1000))} s
        </p>
        <p className="pl-6 text-xs text-gray-400">{service} waits for every indexer to answer, which can take a minute.</p>
      </div>
    )
  }

  if (search.releases.length === 0) {
    return (
      <div className="space-y-3 py-2">
        <p className="text-sm text-gray-200">No releases found on {service}’s indexers.</p>
        {searchAgainButton}
      </div>
    )
  }

  const pickId = search.releases.find((release) => release.approved)?.id
  const seconds = Math.round((Date.parse(search.finishedAt) - Date.parse(search.startedAt)) / 1000)
  const rejectedCount = search.releases.filter((release) => !release.approved).length

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <label className="flex items-center gap-2 text-gray-300">
          Sort
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value)}
            className="rounded-md border-0 bg-gray-900 py-1 pl-2 pr-8 text-sm text-white ring-1 ring-inset ring-gray-600 focus:ring-2 focus:ring-indigo-500"
          >
            {SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {rejectedCount > 0 && (
          <label className="flex cursor-pointer items-center gap-2 text-gray-300">
            <input
              type="checkbox"
              checked={hideRejected}
              onChange={(event) => setHideRejected(event.target.checked)}
              className="h-4 w-4 rounded border-gray-600 bg-gray-700 text-indigo-600 focus:ring-indigo-500"
            />
            Hide rejected ({rejectedCount})
          </label>
        )}
        <span className="ml-auto text-xs text-gray-400">
          {search.releases.length} found in {seconds} s
        </span>
        {searchAgainButton}
      </div>

      {expired && (
        <p className="rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-200" role="alert">
          These results have expired: {service} keeps them for 30 minutes. Search again to grab one.
        </p>
      )}

      <ul className="max-h-[55vh] divide-y divide-gray-700 overflow-y-auto rounded-lg ring-1 ring-white/10">
        {releases.map((release) => {
          const rejected = !release.approved
          return (
            <li key={release.id} className={classNames('px-3 py-2.5', rejected && 'bg-gray-900/40')}>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className={classNames('break-words text-sm', rejected ? 'text-gray-400' : 'text-gray-100')}>
                    {release.id === pickId && (
                      <span className="mr-1.5 rounded bg-indigo-500/20 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-200">
                        {service}’s pick
                      </span>
                    )}
                    {release.title}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-400">{facts(release).join(' · ')}</p>
                  {release.customFormats.length > 0 && (
                    <p className="mt-0.5 text-xs text-gray-500">{release.customFormats.join(', ')}</p>
                  )}
                  {rejected && release.rejections.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-xs text-amber-300/90">
                      {release.rejections.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <GrabButton
                  release={release}
                  grabbed={release.grabbed || grabbedIds.has(release.id)}
                  grabbing={grabbing === release.id}
                  // One grab at a time, and none once the service has dropped the results.
                  disabled={grabbing !== null || expired}
                  canGrabRejected={canGrabRejected}
                  onGrab={grab}
                />
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
