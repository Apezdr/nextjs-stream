'use client'

import { useRouter } from 'next/navigation'

/** "Specials" for season 0, "Season N" otherwise (kept local: tvFacts is a server module). */
const seasonOptionLabel = (n) => (n === 0 ? 'Specials' : `Season ${n}`)

/**
 * The inline "Season [1 ▾]" select beside the Episodes heading. Changing it
 * navigates to that season's page; it always renders, even for a show with
 * one season, so the heading row keeps its shape.
 *
 * @param {{ seasons: Array<{ seasonNumber: number, title?: string|null }>, current: number, routeKey: string }} props - routeKey is the already-encoded show key
 */
export default function SeasonSelector({ seasons, current, routeKey }) {
  const router = useRouter()
  const options = (seasons || []).filter((season) => season && Number.isInteger(season.seasonNumber))

  return (
    <label className="inline-flex items-center gap-2 text-sm text-white/60">
      Season
      <select
        value={String(current)}
        onChange={(event) => router.push(`/list/tv/${routeKey}/${Number(event.target.value)}`)}
        className="rounded-md border border-white/20 bg-white/5 px-2 py-1 text-sm text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300"
      >
        {options.map((season) => (
          <option key={season.seasonNumber} value={String(season.seasonNumber)} className="bg-[#0f1633] text-white">
            {seasonOptionLabel(season.seasonNumber)}
          </option>
        ))}
      </select>
    </label>
  )
}
