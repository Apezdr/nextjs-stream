'use client'
import Image from 'next/image'
import Link from 'next/link'
import { useMemo } from 'react'

const ROTATIONS = [-12, -6, 0, 6, 12]

export default function PosterFan({ seasons = [], showTitle, targetSeasonNumber = null }) {
  const items = useMemo(() => {
    // Smart season selection: pick seasons closest to the target season
    let selectedSeasons = []

    if (targetSeasonNumber && seasons.length > 5) {
      // Sort seasons by distance from target season
      const seasonsWithDistance = seasons.map((season) => ({
        ...season,
        distance: Math.abs(season.seasonNumber - targetSeasonNumber),
      }))

      // Sort by distance (closest first), then by season number for ties
      seasonsWithDistance.sort((a, b) => {
        if (a.distance === b.distance) {
          return a.seasonNumber - b.seasonNumber
        }
        return a.distance - b.distance
      })

      // Take the 5 closest seasons
      selectedSeasons = seasonsWithDistance.slice(0, 5).map(({ distance, ...season }) => season)

      // Sort the selected seasons by season number for logical display order
      selectedSeasons.sort((a, b) => a.seasonNumber - b.seasonNumber)
    } else {
      // Fallback: use first 5 seasons if no target or few seasons
      selectedSeasons = seasons.slice(0, 5)
    }

    // Center-fan algorithm: distribute seasons from center outward
    const count = selectedSeasons.length
    const positions = Array(5).fill(null)

    if (count === 0) return positions

    // Define center-fan position mapping based on count
    const fanMappings = {
      1: [2], // center only
      2: [1, 3], // slightly left and right of center
      3: [1, 2, 3], // left, center, right
      4: [0, 1, 3, 4], // skip center, use outer positions
      5: [0, 1, 2, 3, 4], // use all positions
    }

    const positionsToUse = fanMappings[count] || fanMappings[5]

    // Place seasons in the determined positions
    selectedSeasons.forEach((season, index) => {
      positions[positionsToUse[index]] = season
    })

    return positions
  }, [seasons, targetSeasonNumber])

  return (
    <div className="relative mx-auto w-full max-w-5xl">
      <div className="pointer-events-none absolute inset-0 -z-10 rounded-[28px] bg-black/30 backdrop-blur-md" />
      <div
        className="flex items-end justify-center gap-3 py-8 sm:gap-6"
        role="list"
        aria-label="Available seasons"
      >
        {items.map((s, i) => {
          if (!s) return <div key={`pad-${i}`} className="w-24 sm:w-32" />
          const rot = ROTATIONS[Math.min(i, ROTATIONS.length - 1)]
          const isAvailable = s.isAvailable !== false // Default to true for backward compatibility

          // Build the season URL directly (only used if available)
          const seasonUrl = `/list/tv/${showTitle}/${s.seasonNumber}`

          // Format air date for display
          const formatAirDate = (airDate) => {
            if (!airDate) return null
            try {
              const date = new Date(airDate)
              return date.getFullYear()
            } catch {
              return null
            }
          }

          const airYear = formatAirDate(s.airDate)

          // Different treatment for available vs missing seasons
          if (!isAvailable) {
            // Missing season - non-clickable with greyscale treatment
            return (
              <div
                key={s.id}
                className="group relative w-24 sm:w-32 md:w-40 aspect-[2/3] origin-bottom transition-all duration-300 ease-out
                           [transform-style:preserve-3d] cursor-not-allowed
                           hover:scale-105"
                style={{ rotate: `${rot}deg` }}
                aria-label={`${s.title || 'Season'} ${s.seasonNumber} - Not in library`}
              >
                <div className="absolute -inset-2 rounded-xl opacity-0 group-hover:opacity-50 transition shadow-lg" />
                <Image
                  src={s.posterUrl}
                  alt={`${s.title || 'Season'} ${s.seasonNumber} - Not available`}
                  fill
                  sizes="(max-width: 640px) 96px, (max-width: 1024px) 128px, 160px"
                  className="rounded-xl object-cover shadow-lg ring-1 ring-white/5 
                             grayscale contrast-50 opacity-60"
                  priority={i === 2}
                />
                {/* Air date label at top */}
                {airYear && (
                  <div className="pointer-events-none absolute -top-[18px] left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-2 py-1 text-xs text-white/70 backdrop-blur">
                    {airYear}
                  </div>
                )}
                {/* Lock icon overlay for missing seasons */}
                <div className="absolute top-2 right-2 w-4 h-4 bg-black/80 rounded-full flex items-center justify-center">
                  <svg className="w-2.5 h-2.5 text-white/80" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                  </svg>
                </div>
                <div
                  className="w-max pointer-events-none absolute -bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/30 px-3 py-1 text-xs text-white/60 opacity-0 backdrop-blur
                              transition group-hover:opacity-100"
                >
                  S{s.seasonNumber} • Not in library
                </div>
              </div>
            )
          }

          // Available season - clickable with normal treatment
          return (
            <Link
              key={s.id}
              href={seasonUrl}
              className="group relative w-24 sm:w-32 md:w-40 aspect-[2/3] origin-bottom transition-all duration-300 ease-out
                         [transform-style:preserve-3d] block
                         hover:!rotate-0 focus-visible:!rotate-0 hover:scale-110 focus-visible:scale-110"
              style={{ rotate: `${rot}deg` }}
              aria-label={`Open ${s.title || 'Season'} ${s.seasonNumber}`}
            >
              <div className="absolute -inset-2 rounded-xl opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition shadow-2xl" />
              <Image
                src={s.posterUrl}
                alt={`${s.title || 'Season'} ${s.seasonNumber}`}
                fill
                sizes="(max-width: 640px) 96px, (max-width: 1024px) 128px, 160px"
                className="rounded-xl object-cover shadow-lg ring-1 ring-white/10"
                priority={i === 2}
              />
              {/* Air date label at top */}
              {airYear && (
                <div className="pointer-events-none absolute -top-[18px] left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-2 py-1 text-xs text-white backdrop-blur">
                  {airYear}
                </div>
              )}
              <div
                className="w-max pointer-events-none absolute -bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs text-white opacity-0 backdrop-blur
                              transition group-hover:opacity-100 group-focus-visible:opacity-100"
              >
                S{s.seasonNumber}
                {s.episodeCount ? ` • ${s.episodeCount} eps` : ''}
              </div>
            </Link>
          )
        })}
      </div>
      {/* Mobile reel fallback */}
      <div className="mt-4 grid grid-cols-[auto_1fr_auto] items-center gap-3 sm:hidden">
        <span className="text-xs text-white/60">Swipe</span>
        <div className="h-px bg-white/10" />
        <span className="text-xs text-white/60">More</span>
      </div>
    </div>
  )
}
