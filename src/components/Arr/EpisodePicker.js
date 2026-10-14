'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronRightIcon } from '@heroicons/react/20/solid'
import { classNames } from '@src/utils'
import { fetchArrEpisodes } from './arrApi'

/** How often to ask again while Sonarr is still refreshing a show it just added, and for how long. */
const POLL_MS = 2_500
const GIVE_UP_MS = 120_000

export const seasonLabel = (seasonNumber) => (seasonNumber === 0 ? 'Specials' : `Season ${seasonNumber}`)

/** Regular seasons in order, specials last: they're rarely what someone is after. */
export const bySeasonOrder = (a, b) => (a === 0) - (b === 0) || a - b

export const episodeCode = (episode) =>
  `S${String(episode.seasonNumber).padStart(2, '0')}E${String(episode.episodeNumber).padStart(2, '0')}`

/** [seasonNumber, episodes][] in season order. */
export function groupBySeason(episodes) {
  const groups = new Map()
  for (const episode of episodes) {
    const group = groups.get(episode.seasonNumber)
    if (group) group.push(episode)
    else groups.set(episode.seasonNumber, [episode])
  }
  return [...groups.entries()].sort(([a], [b]) => bySeasonOrder(a, b))
}

/**
 * Sonarr's episode list for a show (TMDB numbers some shows differently). A
 * show Sonarr has just added isn't ready until its first refresh is over: that
 * refresh applies the add's monitoring, which would undo anything done to its
 * episodes before. So this asks again until the list is `ready`.
 */
export function useSonarrEpisodes(item) {
  const [load, setLoad] = useState({ status: 'loading', episodes: [], message: null })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    let timer = null
    const startedAt = Date.now()
    const ask = async () => {
      try {
        const result = await fetchArrEpisodes(item)
        if (cancelled) return
        if (result.ready) {
          setLoad({ status: 'ready', episodes: result.episodes, message: null })
        } else if (Date.now() - startedAt > GIVE_UP_MS) {
          setLoad({ status: 'slow', episodes: [], message: null })
        } else {
          setLoad({ status: 'waiting', episodes: [], message: null })
          timer = setTimeout(ask, POLL_MS)
        }
      } catch (error) {
        if (!cancelled) setLoad({ status: 'error', episodes: [], message: error.message })
      }
    }
    ask()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [item, attempt])

  const retry = useCallback(() => {
    setLoad({ status: 'loading', episodes: [], message: null })
    setAttempt((count) => count + 1)
  }, [])

  return { ...load, retry }
}

/** What to show while useSonarrEpisodes isn't ready; null once it is. */
export function EpisodeLoadState({ load }) {
  if (load.status === 'loading' || load.status === 'waiting') {
    return (
      <p role="status" className="flex items-center gap-2 py-6 text-sm text-gray-300">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-500 border-t-indigo-400" aria-hidden="true" />
        {load.status === 'waiting' ? 'Sonarr is still loading this show’s episodes…' : 'Loading episodes…'}
      </p>
    )
  }
  if (load.status === 'slow' || load.status === 'error') {
    return (
      <div className="space-y-3 py-4 text-sm">
        <p className={load.status === 'error' ? 'text-red-400' : 'text-gray-300'} role="alert">
          {load.status === 'error'
            ? load.message
            : 'Sonarr is taking longer than usual to load the episodes. The show is added; try again in a minute.'}
        </p>
        <button
          type="button"
          onClick={load.retry}
          className="rounded-md bg-gray-700 px-3 py-1.5 font-medium text-gray-100 hover:bg-gray-600"
        >
          Try again
        </button>
      </div>
    )
  }
  if (load.episodes.length === 0) {
    return <p className="py-4 text-sm text-gray-300">Sonarr doesn’t list any episodes for this show yet.</p>
  }
  return null
}

/** Pick episodes from Sonarr's own list for a show, then submit them. */
export default function EpisodePicker({ item, submitting = false, onSubmit }) {
  const load = useSonarrEpisodes(item)
  const [selected, setSelected] = useState(() => new Set())
  const [expanded, setExpanded] = useState(() => new Set())
  const seasons = useMemo(() => groupBySeason(load.episodes), [load.episodes])

  const toggleEpisode = (id) =>
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const toggleSeason = (episodes) =>
    setSelected((previous) => {
      const next = new Set(previous)
      const allChosen = episodes.every((episode) => next.has(episode.id))
      for (const episode of episodes) {
        if (allChosen) next.delete(episode.id)
        else next.add(episode.id)
      }
      return next
    })

  const toggleExpanded = (seasonNumber) =>
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(seasonNumber)) next.delete(seasonNumber)
      else next.add(seasonNumber)
      return next
    })

  const notReady = <EpisodeLoadState load={load} />
  if (load.status !== 'ready' || seasons.length === 0) return notReady

  return (
    <div className="space-y-3">
      <div className="max-h-72 overflow-y-auto rounded-lg ring-1 ring-white/10">
        {seasons.map(([seasonNumber, episodes]) => {
          const chosen = episodes.filter((episode) => selected.has(episode.id)).length
          const onDisk = episodes.filter((episode) => episode.hasFile).length
          const isOpen = seasons.length === 1 || expanded.has(seasonNumber)
          return (
            <div key={seasonNumber} className="border-b border-gray-700 last:border-b-0">
              <div className="flex items-center gap-3 px-3 py-2">
                <input
                  type="checkbox"
                  checked={chosen === episodes.length}
                  onChange={() => toggleSeason(episodes)}
                  aria-label={`Every episode of ${seasonLabel(seasonNumber)}`}
                  className="h-4 w-4 rounded border-gray-600 bg-gray-700 text-indigo-600 focus:ring-indigo-500"
                />
                <button
                  type="button"
                  onClick={() => toggleExpanded(seasonNumber)}
                  aria-expanded={isOpen}
                  className="flex min-w-0 flex-1 items-center gap-1 text-left text-sm font-medium text-gray-100"
                >
                  <ChevronRightIcon
                    className={classNames('h-4 w-4 shrink-0 text-gray-400 transition-transform', isOpen && 'rotate-90')}
                    aria-hidden="true"
                  />
                  <span className="flex-1 truncate">{seasonLabel(seasonNumber)}</span>
                  <span className="text-xs font-normal text-gray-400">
                    {chosen > 0 ? `${chosen} picked · ` : ''}
                    {onDisk}/{episodes.length} on disk
                  </span>
                </button>
              </div>
              {isOpen && (
                <ul className="pb-1">
                  {episodes.map((episode) => (
                    <li key={episode.id}>
                      <label className="flex cursor-pointer items-center gap-3 py-1.5 pl-10 pr-3 text-sm hover:bg-gray-700/40">
                        <input
                          type="checkbox"
                          checked={selected.has(episode.id)}
                          onChange={() => toggleEpisode(episode.id)}
                          className="h-4 w-4 rounded border-gray-600 bg-gray-700 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className="w-10 shrink-0 tabular-nums text-gray-400">
                          E{String(episode.episodeNumber).padStart(2, '0')}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-gray-100">{episode.title || 'TBA'}</span>
                        {episode.hasFile ? (
                          <span className="shrink-0 text-xs text-green-400">On disk</span>
                        ) : episode.airDate ? (
                          <span className="shrink-0 text-xs tabular-nums text-gray-500">{episode.airDate}</span>
                        ) : null}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => onSubmit([...selected])}
          disabled={selected.size === 0 || submitting}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting
            ? 'Starting search…'
            : selected.size === 0
              ? 'Pick episodes to get'
              : `Get ${selected.size} episode${selected.size === 1 ? '' : 's'}`}
        </button>
      </div>
    </div>
  )
}
