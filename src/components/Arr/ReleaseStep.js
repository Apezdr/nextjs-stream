'use client'

import { useMemo, useState } from 'react'
import { EpisodeLoadState, episodeCode, groupBySeason, seasonLabel, useSonarrEpisodes } from './EpisodePicker'
import ReleasePicker from './ReleasePicker'

// A movie has one thing to search for. A constant, so the picker searches once.
const MOVIE_TARGET = null

const selectClass =
  'block w-full rounded-md border-0 bg-gray-900 px-3 py-2 text-sm text-white ring-1 ring-inset ring-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500'

/**
 * Sonarr searches a season or one episode, so choose which first, from
 * Sonarr's own episode list (a show it has just added waits for its first
 * refresh). Each Search press runs a fresh search.
 */
function ShowReleases({ item, defaultSeason, onGrabbed }) {
  const load = useSonarrEpisodes(item)
  const seasons = useMemo(() => groupBySeason(load.episodes), [load.episodes])
  const [season, setSeason] = useState(null)
  const [episodeId, setEpisodeId] = useState('')
  const [target, setTarget] = useState(null)
  const [searchCount, setSearchCount] = useState(0)

  if (load.status !== 'ready' || seasons.length === 0) return <EpisodeLoadState load={load} />

  const seasonNumbers = seasons.map(([number]) => number)
  const chosenSeason =
    season ??
    (seasonNumbers.includes(defaultSeason) ? defaultSeason : seasonNumbers.find((number) => number > 0) ?? seasonNumbers[0])
  const episodes = seasons.find(([number]) => number === chosenSeason)?.[1] ?? []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-gray-200">Season</span>
          <select
            value={chosenSeason}
            onChange={(event) => {
              setSeason(Number(event.target.value))
              setEpisodeId('')
            }}
            className={selectClass}
          >
            {seasonNumbers.map((number) => (
              <option key={number} value={number}>
                {seasonLabel(number)}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 flex-1 text-sm">
          <span className="mb-1 block font-medium text-gray-200">Search for</span>
          <select value={episodeId} onChange={(event) => setEpisodeId(event.target.value)} className={selectClass}>
            <option value="">The whole season</option>
            {episodes.map((episode) => (
              <option key={episode.id} value={episode.id}>
                {episodeCode(episode)} · {episode.title || 'TBA'}
                {episode.hasFile ? ' (on disk)' : ''}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => {
            setTarget(episodeId ? { episodeId: Number(episodeId) } : { seasonNumber: chosenSeason })
            setSearchCount((count) => count + 1)
          }}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
        >
          Search
        </button>
      </div>
      {target && <ReleasePicker key={searchCount} item={item} target={target} onGrabbed={onGrabbed} />}
    </div>
  )
}

/** Pick a release by hand: the dialog step after "Pick a release…". */
export default function ReleaseStep({ item, defaultSeason, onGrabbed, onDone }) {
  return (
    <div className="space-y-4">
      {item.mediaType === 'movie' ? (
        <ReleasePicker item={item} target={MOVIE_TARGET} onGrabbed={onGrabbed} />
      ) : (
        <ShowReleases item={item} defaultSeason={defaultSeason} onGrabbed={onGrabbed} />
      )}
      <div className="flex justify-end border-t border-gray-700 pt-3">
        <button
          type="button"
          onClick={onDone}
          className="rounded-md px-4 py-2 text-sm font-medium text-gray-300 hover:bg-gray-700 hover:text-white"
        >
          Done
        </button>
      </div>
    </div>
  )
}
