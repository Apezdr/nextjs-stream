'use client'

import { useRef, useState } from 'react'
import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { classNames } from '@src/utils'
import { searchScopeTitlesAction } from '@src/utils/actions/roles'
import { EMPTY_SCOPE, MOVIE_RATINGS, TV_RATINGS } from '@src/lib/roles/libraryScope'

const inputClass =
  'block w-full rounded-xl border-0 bg-slate-950/60 px-3 py-2 text-sm text-white ring-1 ring-inset ring-white/15 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500'
const checkboxClass = 'h-4 w-4 rounded border-gray-600 bg-gray-800 text-indigo-500 focus:ring-indigo-500'
const quietButton =
  'inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-slate-300 hover:bg-white/10 hover:text-white disabled:opacity-50'

const TYPE_LABEL = { movie: 'Movie', tv: 'Show' }
const keyOf = (title) => `${title.mediaType}:${title.originalTitle}`

/** One line for a role's card: what its holders see. */
export function describeLibraryScope(scope) {
  if (!scope) return null
  const parts = []
  if (scope.movieRatingCap) parts.push(`movies up to ${scope.movieRatingCap}`)
  if (scope.tvRatingCap) parts.push(`shows up to ${scope.tvRatingCap}`)
  if (scope.titles.length > 0) parts.push(`${scope.titles.length} picked title${scope.titles.length === 1 ? '' : 's'}`)
  return parts.length > 0 ? parts.join(' · ') : 'Nothing yet: its holders see no titles'
}

function CapSelect({ label, value, ratings, onChange }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-200">{label}</span>
      <select value={value ?? ''} onChange={(event) => onChange(event.target.value || null)} className={inputClass}>
        <option value="">None (only picked titles)</option>
        {ratings.map((rating) => (
          <option key={rating} value={rating}>
            {rating} and below
          </option>
        ))}
      </select>
    </label>
  )
}

function TitlePicker({ titles, onAdd }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState(null)
  const latest = useRef(0)
  const picked = new Set(titles.map(keyOf))

  const search = async (event) => {
    event.preventDefault()
    const asked = ++latest.current
    setSearching(true)
    setError(null)
    try {
      const result = await searchScopeTitlesAction(query)
      if (asked === latest.current) setResults(result.titles)
    } catch {
      if (asked === latest.current) setError('Couldn’t search the library. Try again.')
    } finally {
      if (asked === latest.current) setSearching(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') search(event)
          }}
          placeholder="Find a movie or show in the library"
          aria-label="Find a title to pick"
          className={inputClass}
        />
        <button type="button" onClick={search} disabled={searching || !query.trim()} className={quietButton}>
          <MagnifyingGlassIcon className="h-4 w-4" aria-hidden="true" />
          {searching ? 'Searching…' : 'Search'}
        </button>
      </div>
      {error && (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
      {results.length > 0 && (
        <ul className="max-h-64 space-y-1 overflow-y-auto rounded-xl bg-slate-950/40 p-2 ring-1 ring-white/10">
          {results.map((title) => {
            const already = picked.has(keyOf(title))
            return (
              <li key={keyOf(title)} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-slate-200">
                  {title.title}
                  {title.year && <span className="text-slate-400"> ({title.year})</span>}
                  <span className="text-slate-500">
                    {' '}
                    · {TYPE_LABEL[title.mediaType]}
                    {title.rating ? ` · ${title.rating}` : ' · unrated'}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={already}
                  onClick={() => onAdd(title)}
                  className={classNames(quietButton, 'shrink-0 py-1')}
                >
                  {already ? 'Picked' : 'Pick'}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/**
 * A role's library scope: limit what its holders see to titles under a movie
 * and a TV rating cap, plus titles picked by hand. Off, the role doesn't touch
 * the library. Unrated titles count only when picked.
 *
 * @param {{ value: object|null, onChange: (scope: object|null) => void }} props
 */
export default function LibraryScopeEditor({ value, onChange }) {
  const limited = value !== null && value !== undefined
  const scope = limited ? value : null
  const set = (changes) => onChange({ ...scope, ...changes })

  return (
    <div className="rounded-xl bg-slate-950/40 p-4 ring-1 ring-white/10">
      <label className="flex cursor-pointer items-start gap-2">
        <input
          type="checkbox"
          checked={limited}
          onChange={(event) => onChange(event.target.checked ? { ...EMPTY_SCOPE, titles: [] } : null)}
          className={classNames(checkboxClass, 'mt-0.5')}
        />
        <span>
          <span className="text-sm font-medium text-white">Limit the library</span>
          <span className="block text-xs text-slate-400">
            Holders see and play only these titles, nowhere else in the app. With several limited roles they get every
            title any of them allows. Admins always see everything.
          </span>
        </span>
      </label>
      {limited && (
        <div className="mt-4 space-y-4 border-t border-white/10 pt-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <CapSelect
              label="Movies rated"
              value={scope.movieRatingCap}
              ratings={MOVIE_RATINGS}
              onChange={(movieRatingCap) => set({ movieRatingCap })}
            />
            <CapSelect
              label="Shows rated"
              value={scope.tvRatingCap}
              ratings={TV_RATINGS}
              onChange={(tvRatingCap) => set({ tvRatingCap })}
            />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-200">Picked titles</p>
            <p className="text-xs text-slate-400">
              In the library for these holders whatever their rating. A show brings its seasons and episodes.
            </p>
            {scope.titles.length > 0 && (
              <ul className="space-y-1">
                {scope.titles.map((title) => (
                  <li key={keyOf(title)} className="flex items-center justify-between gap-3 text-sm text-slate-200">
                    <span className="min-w-0 truncate">
                      {title.originalTitle}
                      <span className="text-slate-500"> · {TYPE_LABEL[title.mediaType]}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => set({ titles: scope.titles.filter((other) => keyOf(other) !== keyOf(title)) })}
                      className={classNames(quietButton, 'shrink-0 py-1')}
                      aria-label={`Remove ${title.originalTitle}`}
                    >
                      <XMarkIcon className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <TitlePicker
              titles={scope.titles}
              onAdd={({ mediaType, originalTitle }) =>
                set({ titles: [...scope.titles, { mediaType, originalTitle, access: 'play' }] })
              }
            />
          </div>
        </div>
      )}
    </div>
  )
}
