'use client'

import { useState } from 'react'
import RetryImage from '@components/RetryImage'
import { classNames, getFullImageUrl } from '@src/utils'

/** How many faces the rail shows before "See all". */
const RAIL_LIMIT = 24

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
 * Cast as a horizontal row of circular portraits on the page surface — no
 * box, no inner scrollbar — with "See all" opening the full list as a grid.
 *
 * @param {{ cast: Array<{ id?: number, name: string, character?: string, profile_path?: string|null }>, title?: string }} props
 */
export default function CastRail({ cast, title = 'Cast' }) {
  const [expanded, setExpanded] = useState(false)
  const people = Array.isArray(cast) ? cast.filter((p) => p && p.name) : []
  if (people.length === 0) return null

  const overflow = people.length > RAIL_LIMIT
  const shown = expanded ? people : people.slice(0, RAIL_LIMIT)
  const headingId = `cast-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`

  return (
    <section aria-labelledby={headingId}>
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 id={headingId} className="text-lg font-semibold text-white">
          {title}
          <span className="ml-2 text-sm font-normal text-white/45">{people.length}</span>
        </h2>
        {overflow ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="rounded text-sm font-medium text-blue-300 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300"
            aria-expanded={expanded}
          >
            {expanded ? 'Show fewer' : `See all ${people.length}`}
          </button>
        ) : null}
      </div>
      {expanded ? (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(6rem,1fr))] justify-items-center gap-x-4 gap-y-6">
          {shown.map((person, i) => (
            <li key={person.id ?? `${person.name}-${i}`}>
              <CastMember person={person} />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 py-1 scroll-px-4 scrollbar-none sm:-mx-6 sm:px-6 sm:scroll-px-6 lg:-mx-8 lg:px-8 lg:scroll-px-8">
          {shown.map((person, i) => (
            <li key={person.id ?? `${person.name}-${i}`} className="shrink-0 snap-start">
              <CastMember person={person} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
