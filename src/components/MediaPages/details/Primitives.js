import Link from 'next/link'
import { ChevronLeftIcon } from '@heroicons/react/20/solid'
import { classNames } from '@src/utils'

/**
 * The primitives every info page is built from: the breadcrumb and the
 * trail, the meta line with its chips, a section heading, the label/value
 * panel and the button class strings the client pieces share.
 * All server-renderable; nothing here reads per-user state.
 */

/**
 * The filled primary button ("Play" / "Resume") at its two sizes, and the
 * outline secondary beside it.
 *
 * They live here, in a module without 'use client', so a server component
 * that wants a matching button (an in-app link styled as a secondary, say)
 * gets the real string: an export of a 'use client' module is a client
 * reference on the server. PrimaryPlayButton and ActionRow re-export them
 * for client consumers.
 */
const PRIMARY_BASE =
  'inline-flex items-center justify-center rounded-md bg-blue-500 font-semibold text-white shadow-lg shadow-blue-900/40 transition-colors hover:bg-blue-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300'
export const PRIMARY_CLASSES = `${PRIMARY_BASE} h-12 px-6 text-base gap-2`
export const PRIMARY_CLASSES_SM = `${PRIMARY_BASE} h-9 px-4 text-sm gap-1.5`
export const SECONDARY_CLASSES =
  'inline-flex h-12 items-center gap-2 rounded-md border border-white/25 px-4 text-sm font-medium text-white transition-colors hover:border-white/50 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300'

/** The focus ring every link on the info pages shares. */
const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300'

/** A text link inside a fact row (IMDb, TMDB, the show a season belongs to). */
const FACT_LINK_CLASSES =
  'rounded text-blue-300 underline-offset-2 hover:text-white hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300'

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
 * The breadcrumb trail above a hero: "TV / Preacher / Season 1". Items with
 * an href link back up the hierarchy; the last item is the page itself and
 * is never a link. Long labels truncate rather than wrap.
 *
 * @param {{ items: Array<{ label: string, href?: string|null }>, className?: string }} props
 */
export function Trail({ items, className = '' }) {
  const crumbs = (items || []).filter((item) => item && item.label)
  if (crumbs.length === 0) return null
  const last = crumbs.length - 1
  return (
    <nav aria-label="Breadcrumb" className={className || undefined}>
      <ol className="flex min-w-0 items-center gap-1.5 text-sm">
        {crumbs.map((item, i) => (
          <li key={`${item.label}-${i}`} className="min-w-0 truncate">
            {i > 0 ? (
              <span aria-hidden="true" className="mr-1.5 text-white/35">
                /
              </span>
            ) : null}
            {item.href && i < last ? (
              <Link href={item.href} className={classNames('rounded text-white/70 hover:text-white', FOCUS_RING)}>
                {item.label}
              </Link>
            ) : (
              <span className="truncate text-white" aria-current={i === last ? 'page' : undefined}>
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}

const CHIP_BASE = 'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase leading-4 tracking-wide'
const CHIP_TONES = {
  outline: 'border border-white/35 text-white/90',
  solid: 'bg-white/90 text-slate-900',
}
/** A status chip reads in title case ("Ended", "In production"): the same frame without the uppercase. */
const STATUS_CHIP =
  'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold leading-4 normal-case tracking-normal border border-white/35 text-white/90'

/**
 * A small uppercase chip: DOLBY VISION, HDR10, 4K, PG-13. `tone="status"`
 * keeps the text as written, for a show's "Ended" / "Returning".
 *
 * @param {{ children: import('react').ReactNode, tone?: 'outline'|'solid'|'status', className?: string }} props
 */
export function Chip({ children, tone = 'outline', className = '' }) {
  return (
    <span className={tone === 'status' ? classNames(STATUS_CHIP, className) : classNames(CHIP_BASE, CHIP_TONES[tone] || CHIP_TONES.outline, className)}>
      {children}
    </span>
  )
}

/**
 * `2012 · 3h 2m · PG-13 · [4K] [HDR10]`
 *
 * Chips are plain strings (outline, uppercase) or `{ label, tone }` for a
 * status chip beside the quality ones.
 *
 * @param {{ items: Array<string|null|undefined>, chips?: Array<string|{ label: string, tone?: 'outline'|'solid'|'status' }>, className?: string }} props
 */
export function MetaLine({ items, chips = [], className = '' }) {
  const parts = (items || []).filter(Boolean)
  const chipItems = (chips || []).map((chip) => (typeof chip === 'string' ? { label: chip } : chip)).filter((chip) => chip && chip.label)
  if (parts.length === 0 && chipItems.length === 0) return null
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
      {chipItems.length > 0 ? (
        <span className="inline-flex items-center gap-1.5">
          {parts.length > 0 ? (
            <span className="text-white/35" aria-hidden="true">
              ·
            </span>
          ) : null}
          {chipItems.map((chip) => (
            <Chip key={chip.label} tone={chip.tone}>
              {chip.label}
            </Chip>
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
 * `movieFacts` / `episodeFacts` / `showFacts`; extra rows (the watched-by
 * count, which is an async server component) are passed as children.
 *
 * A row with `links` renders them instead of its value: external by default
 * (a new tab), or in-app with `external: false` (the show a season belongs
 * to), which stays in the page.
 *
 * @param {{ id?: string, title?: string, rows: Array<{ label: string, value: string|string[], note?: string, links?: Array<{ label: string, href: string, external?: boolean }> }>, children?: import('react').ReactNode }} props
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
 * Links inside a FactRow: external ones (IMDb, TMDB, an official site) open
 * in a new tab; `external: false` renders an in-app link.
 */
function LinkList({ links }) {
  return (
    <span className="flex flex-wrap gap-x-4 gap-y-1">
      {links.map((link) =>
        link.external === false ? (
          <Link key={link.href} href={link.href} className={FACT_LINK_CLASSES}>
            {link.label}
          </Link>
        ) : (
          <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer" className={FACT_LINK_CLASSES}>
            {link.label}
          </a>
        )
      )}
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
