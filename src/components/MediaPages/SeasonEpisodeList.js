'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import EpisodeRow from './details/EpisodeRow'
import ViewToggle, { useStoredView } from './details/ViewToggle'
import SeasonSelector from './details/SeasonSelector'
import EpisodeActionDialog from './details/EpisodeActionDialog'

/**
 * The episodes section of a season page: the heading with the season
 * selector, the list/grid toggle, the rows, and the one action dialog they
 * all share. The rows keep their own progress live; marking an episode
 * watched refreshes the server-rendered parts (next-up, tile status).
 *
 * @param {Object} props
 * @param {Array<Object>} props.episodes - EpisodeRowData, built by the season page
 * @param {Array<{ seasonNumber: number, title?: string|null }>} props.seasons - seasons the selector offers
 * @param {number} props.current - this season's number
 * @param {string} props.routeKey - the show's already-encoded route key
 */
export default function SeasonEpisodeList({ episodes, seasons, current, routeKey }) {
  const [view, setView] = useStoredView()
  const [active, setActive] = useState(null)
  const router = useRouter()
  const rowKey = (episode) => episode._id || `${episode.seasonNumber}-${episode.episodeNumber}`

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-baseline gap-4">
          <h2 id="episodes-heading" className="text-lg font-semibold text-white">
            Episodes
          </h2>
          <SeasonSelector seasons={seasons} current={current} routeKey={routeKey} />
        </div>
        <ViewToggle value={view} onChange={setView} />
      </div>
      {view === 'grid' ? (
        <ul className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-3 xl:grid-cols-4">
          {episodes.map((episode) => (
            <EpisodeRow key={rowKey(episode)} episode={episode} view="grid" onActions={setActive} />
          ))}
        </ul>
      ) : (
        <ul>
          {episodes.map((episode) => (
            <EpisodeRow key={rowKey(episode)} episode={episode} view="list" onActions={setActive} />
          ))}
        </ul>
      )}
      <EpisodeActionDialog open={Boolean(active)} episode={active} onClose={() => setActive(null)} onMarked={() => router.refresh()} />
    </>
  )
}
