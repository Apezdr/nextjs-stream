import Link from 'next/link'
import { ChevronLeftIcon } from '@heroicons/react/20/solid'
import { classNames } from '@src/utils'

/**
 * The primitives every info page is built from: the breadcrumb, the meta line
 * with its quality chips, a section heading and the label/value panel.
 * All server-renderable; nothing here reads per-user state.
 */

/**
 * "← Back to movies" in the top-left corner.
 */
export function Breadcrumb({ href, children, className = '' }) {
  return (
    <Link
      href={href}
      className={classNames(
        'inline-flex min-w-0 max-w-full items-center gap-1 rounded-md py-1.5 pl-1 pr-2.5 text-sm font-medium text-white/70 transition-colors',
        'hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300',
        className
      )}
    >
      <ChevronLeftIcon className="size-5" aria-hidden="true" />
      {children}
    </Link>
  )
}

/**
 * A small uppercase chip: DOLBY VISION, HDR10, 4K, PG-13.
 */
export function Chip({ children, tone = 'outline', className = '' }) {
  return (
    <span
      className={classNames(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase leading-4 tracking-wide',
        tone === 'solid' ? 'bg-white/90 text-slate-900' : 'border border-white/35 text-white/90',
        className
      )}
    >
      {children}
    </span>
  )
}

/**
 * `2012 · 3h 2m · PG-13 · [4K] [HDR10]`
 *
 * @param {{ items: Array<string|null|undefined>, chips?: string[], className?: string }} props
 */
export function MetaLine({ items, chips = [], className = '' }) {
  const parts = (items || []).filter(Boolean)
  if (parts.length === 0 && chips.length === 0) return null
  return (
    <p className={classNames('flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm text-white/75', className)}>
      {parts.map((part, i) => (
        <span key={`${part}-${i}`} className="inline-flex items-center gap-x-2">
          {i > 0 ? (
            <span className="text-white/35" aria-hidden="true">
              ·
            </span>
          ) : null}
          {part}
        </span>
      ))}
      {chips.length > 0 ? (
        <span className="inline-flex items-center gap-1.5">
          {parts.length > 0 ? (
            <span className="text-white/35" aria-hidden="true">
              ·
            </span>
          ) : null}
          {chips.map((chip) => (
            <Chip key={chip}>{chip}</Chip>
          ))}
        </span>
      ) : null}
    </p>
  )
}

/**
 * Section heading with an optional count or trailing action.
 */
export function SectionHeading({ id, children, aside = null, className = '' }) {
  return (
    <div className={classNames('mb-4 flex items-baseline justify-between gap-4', className)}>
      <h2 id={id} className="text-lg font-semibold text-white">
        {children}
      </h2>
      {aside}
    </div>
  )
}

/**
 * Label / value rows for the technical facts. Rows come from
 * `movieFacts` / `episodeFacts`; extra rows (the watched-by count, which is
 * an async server component) are passed as children.
 *
 * @param {{ id?: string, title?: string, rows: Array<{ label: string, value: string|string[], note?: string }>, children?: import('react').ReactNode }} props
 */
export function DetailsPanel({ id = 'details', title = 'Details', rows, children = null }) {
  if ((!rows || rows.length === 0) && !children) return null
  return (
    <section aria-labelledby={`${id}-heading`}>
      <SectionHeading id={`${id}-heading`}>{title}</SectionHeading>
      <dl className="grid grid-cols-[minmax(6.5rem,max-content)_1fr] gap-x-6 gap-y-3 rounded-xl bg-white/5 p-5 text-sm ring-1 ring-white/10">
        {rows.map((row) => (
          <FactRow key={row.label} label={row.label} note={row.note}>
            {Array.isArray(row.links) && row.links.length > 0 ? (
              <LinkList links={row.links} />
            ) : Array.isArray(row.value) ? (
              row.value.join(', ')
            ) : (
              row.value
            )}
          </FactRow>
        ))}
        {children}
      </dl>
    </section>
  )
}

/**
 * External links inside a FactRow (IMDb, TMDB, an official site), each
 * opening in a new tab.
 */
function LinkList({ links }) {
  return (
    <span className="flex flex-wrap gap-x-4 gap-y-1">
      {links.map((link) => (
        <a
          key={link.href}
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded text-blue-300 underline-offset-2 hover:text-white hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300"
        >
          {link.label}
        </a>
      ))}
    </span>
  )
}

/**
 * One dt/dd pair inside DetailsPanel.
 */
export function FactRow({ label, note = null, children }) {
  return (
    <>
      <dt className="text-white/50">{label}</dt>
      <dd className="min-w-0 break-words text-white/90">
        {children}
        {note ? <span className="mt-0.5 block text-xs text-white/45">{note}</span> : null}
      </dd>
    </>
  )
}
