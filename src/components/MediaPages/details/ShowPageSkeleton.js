import { classNames } from '@src/utils'

/**
 * The show info page's frame with nothing in it yet: the Suspense fallback
 * while the show resolves, and so the route's prerendered shell, which is what
 * a link has ready before the click.
 *
 * It mirrors TVShowSeasonsListComponent block for block — page frame, trail
 * row, the hero grid (poster left on small screens, right on large), the
 * seasons grid — and carries the `media-details-page` marker so the lifted
 * backdrop holds steady. When you change that component's layout, change this
 * with it.
 *
 * Server-safe; no data, no hooks.
 */

const BAR = 'block rounded bg-white/10 motion-safe:animate-pulse'

function Bar({ className }) {
  return <span className={classNames(BAR, className)} />
}

const SEASON_PLACEHOLDERS = [0, 1, 2, 3]

export default function ShowPageSkeleton() {
  return (
    <div className="pt-16 w-full">
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading show"
        className="media-details-page relative mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6 lg:px-8"
      >
        <span className="sr-only">Loading show…</span>

        {/* Trail row */}
        <div className="flex min-w-0 items-center justify-between gap-4 pt-4">
          <div className="flex min-w-0 items-center gap-1.5">
            <Bar className="h-5 w-6" />
            <Bar className="h-5 w-40" />
          </div>
        </div>

        {/* Hero: text, poster and actions in the page's own grid */}
        <header className="mt-6 grid grid-cols-[120px_minmax(0,1fr)] gap-x-5 gap-y-6 sm:mt-10 sm:grid-cols-[170px_minmax(0,1fr)] sm:gap-x-8 lg:grid-cols-[minmax(0,1fr)_230px] lg:gap-x-10">
          <div className="col-start-2 row-start-1 min-w-0 lg:col-start-1">
            <Bar className="h-4 w-36" />
            <Bar className="mt-2 h-8 w-72 max-w-full sm:h-12" />
            <Bar className="mt-3 h-5 w-64 max-w-full" />
            <div className="mt-4 max-w-[65ch] space-y-2">
              <Bar className="h-4 w-full" />
              <Bar className="h-4 w-full" />
              <Bar className="h-4 w-2/3" />
            </div>
          </div>
          <div className="col-start-1 row-start-1 sm:row-span-2 lg:col-start-2">
            <div className="aspect-[2/3] w-[120px] rounded-lg bg-white/10 ring-1 ring-white/10 motion-safe:animate-pulse sm:w-[170px] lg:w-[230px]" />
          </div>
          <div className="col-span-2 row-start-2 self-start sm:col-span-1 sm:col-start-2 lg:col-start-1">
            <div className="flex flex-wrap items-center gap-3">
              <Bar className="h-12 w-full rounded-md sm:w-48" />
              <Bar className="h-12 w-32 rounded-md" />
            </div>
            <Bar className="mt-3 h-4 w-56 max-w-full" />
          </div>
        </header>

        {/* Seasons */}
        <section className="mt-10 sm:mt-14">
          <Bar className="mb-4 h-6 w-24" />
          <ul className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
            {SEASON_PLACEHOLDERS.map((i) => (
              <li key={i}>
                <div className="aspect-[2/3] w-full rounded-lg bg-white/5 ring-1 ring-white/10 motion-safe:animate-pulse" />
                <Bar className="mt-3 h-5 w-24" />
                <Bar className="mt-1.5 h-4 w-32" />
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
