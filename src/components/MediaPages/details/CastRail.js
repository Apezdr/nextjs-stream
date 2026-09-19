'use client'

import { useState } from 'react'
import RetryImage from '@components/RetryImage'
import { classNames, getFullImageUrl } from '@src/utils'

/** How many faces the rail shows before "See all". */
const RAIL_LIMIT = 24

/** How many faces the grid layout shows before "See all": three rows of four in a half-width column. */
const GRID_LIMIT = 12

/**
 * A thin, visible scrollbar: with it hidden nothing said the row scrolls.
 * No scroll snapping either — snapping to every 96px portrait made wheel
 * and trackpad scrolling feel throttled, re-targeting on each small move.
 */
const SCROLLBAR =
  'scrollbar-thin scrollbar-track-transparent scrollbar-thumb-rounded-full scrollbar-thumb-[rgba(255,255,255,0.22)] hover:scrollbar-thumb-[rgba(255,255,255,0.4)]'
/** The scroller bleeding to the page edges (the movie page's full-width surface). */
const BLEED_SCROLLER = `-mx-4 flex gap-4 overflow-x-auto px-4 pb-3 pt-1 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 ${SCROLLBAR}`
/** The same scroller kept inside its box, for a rail in a grid cell. */
const INSET_SCROLLER = `flex gap-4 overflow-x-auto px-1 pb-3 pt-1 ${SCROLLBAR}`
const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(6rem,1fr))] justify-items-center gap-x-4 gap-y-6'

function CastMember({ person, className = '' }) {
  const href = person.id ? `https://www.themoviedb.org/person/${person.id}` : null
  const photo = person.profile_path ? getFullImageUrl(person.profile_path, 'h632') : null
  const body = (
    <>
      <div className="relative size-20 overflow-hidden rounded-full bg-white/10 ring-1 ring-white/10 transition-[box-shadow,filter] duration-200 group-hover:brightness-110 group-hover:ring-2 group-hover:ring-white/50 group-focus-visible:ring-2 group-focus-visible:ring-blue-300">
        {photo ? (
          <RetryImage src={photo} alt="" width={80} height={80} sizes="80px" quality={90} loading="lazy" className="size-20 object-cover" />
        ) : (
          <span className="flex size-full items-center justify-center text-lg font-semibold text-white/40" aria-hidden="true">
            {initials(person.name)}
          </span>
        )}
      </div>
      <p className="mt-2 line-clamp-2 text-sm font-semibold leading-tight text-white group-hover:underline">{person.name}</p>
      {person.character ? <p className="mt-0.5 line-clamp-2 text-xs leading-tight text-white/55">{person.character}</p> : null}
    </>
  )
  const classes = classNames(
    'group flex w-24 flex-col items-center rounded-lg text-center focus-visible:outline-none',
    className
  )
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={classes}>
      {body}
    </a>
  ) : (
    <div className={classes}>{body}</div>
  )
}

function initials(name) {
  return (name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('')
}

/**
 * Cast as circular portraits on the page surface, in one of two layouts.
 *
 * - `rail` (default): a horizontal row with a thin scrollbar, for a
 *   full-width surface; "See all" opens the full list as a grid.
 * - `grid`: a wrapping grid from the start, for a column too narrow for a
 *   rail to be worth scrolling (the episode page's half-width cell). It
 *   shows the first few rows and "See all" reveals the rest; nothing
 *   scrolls sideways.
 *
 * @param {Object} props
 * @param {Array<{ id?: number, name: string, character?: string, profile_path?: string|null }>} props.cast
 * @param {string} [props.title]
 * @param {boolean} [props.hideHeading] - drop the heading row (a tab strip already names the rail); the section is labelled by `title` instead
 * @param {boolean} [props.bleed] - false keeps the scroller inside its box so the rail fits a grid cell
 * @param {'rail'|'grid'} [props.layout]
 */
export default function CastRail({ cast, title = 'Cast', hideHeading = false, bleed = true, layout = 'rail' }) {
  const [expanded, setExpanded] = useState(false)
  const people = Array.isArray(cast) ? cast.filter((p) => p && p.name) : []
  if (people.length === 0) return null

  const limit = layout === 'grid' ? GRID_LIMIT : RAIL_LIMIT
  const overflow = people.length > limit
  const shown = expanded ? people : people.slice(0, limit)
  const headingId = `cast-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  const toggle = overflow ? (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      className="rounded text-sm font-medium text-blue-300 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300"
      aria-expanded={expanded}
    >
      {expanded ? 'Show fewer' : `See all ${people.length}`}
    </button>
  ) : null

  return (
    <section aria-labelledby={hideHeading ? undefined : headingId} aria-label={hideHeading ? title : undefined}>
      {hideHeading ? null : (
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 id={headingId} className="text-lg font-semibold text-white">
            {title}
            <span className="ml-2 text-sm font-normal text-white/45">{people.length}</span>
          </h2>
          {toggle}
        </div>
      )}
      {expanded || layout === 'grid' ? (
        <ul className={GRID}>
          {shown.map((person, i) => (
            <li key={person.id ?? `${person.name}-${i}`}>
              <CastMember person={person} />
            </li>
          ))}
        </ul>
      ) : (
        <ul className={bleed ? BLEED_SCROLLER : INSET_SCROLLER}>
          {shown.map((person, i) => (
            <li key={person.id ?? `${person.name}-${i}`} className="shrink-0">
              <CastMember person={person} />
            </li>
          ))}
        </ul>
      )}
      {/* Under a tab strip the toggle sits below the faces, so switching tabs never shifts the first row */}
      {hideHeading && toggle ? <div className="mt-5 flex justify-center">{toggle}</div> : null}
    </section>
  )
}
