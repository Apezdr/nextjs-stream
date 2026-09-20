import { classNames } from '@src/utils'

/**
 * The movie info page's frame with nothing in it yet: the Suspense fallback
 * while the movie resolves, and so the route's prerendered shell, which is what
 * a link has ready before the click.
 *
 * It mirrors MovieDetailsComponent block for block — page frame, back row, the
 * poster-left hero grid, the lower panel — and carries the `media-details-page`
 * marker so the lifted backdrop holds steady. When you change that component's
 * layout, change this with it.
 *
 * Server-safe; no data, no hooks.
 */

const BAR = 'block rounded bg-white/10 motion-safe:animate-pulse'

function Bar({ className }) {
  return <span className={classNames(BAR, className)} />
}

const CAST_PLACEHOLDERS = [0, 1, 2, 3, 4, 5]

export default function MoviePageSkeleton() {
  return (
    <div className="pt-16 w-full">
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading movie"
        className="media-details-page relative mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6 lg:px-8"
      >
        <span className="sr-only">Loading movie…</span>

        {/* Back row */}
        <div className="flex items-center justify-between gap-4 pt-4">
          <Bar className="h-5 w-36" />
        </div>

        {/* Hero: poster left, text and actions right */}
        <header className="mt-6 grid grid-cols-[120px_minmax(0,1fr)] gap-x-5 gap-y-6 sm:mt-10 sm:grid-cols-[170px_minmax(0,1fr)] sm:gap-x-8 lg:grid-cols-[220px_minmax(0,1fr)]">
          <div className="aspect-[2/3] w-full self-start rounded-lg bg-white/10 ring-1 ring-white/10 motion-safe:animate-pulse sm:row-span-2" />
          <div className="min-w-0">
            <Bar className="h-4 w-40" />
            <Bar className="mt-2 h-8 w-72 max-w-full sm:h-12" />
            <Bar className="mt-3 h-5 w-64 max-w-full" />
            <div className="mt-4 max-w-[65ch] space-y-2">
              <Bar className="h-4 w-full" />
              <Bar className="h-4 w-full" />
              <Bar className="h-4 w-2/3" />
            </div>
          </div>
          <div className="col-span-2 self-start sm:col-span-1 sm:col-start-2">
            <div className="flex flex-wrap items-center gap-3">
              <Bar className="h-12 w-full rounded-md sm:w-48" />
              <Bar className="h-12 w-32 rounded-md" />
              <Bar className="h-12 w-32 rounded-md" />
            </div>
          </div>
        </header>

        {/* Lower panel: cast, then details */}
        <div className="mt-10 space-y-12 rounded-2xl bg-[#070b1d]/65 px-4 py-8 ring-1 ring-white/5 sm:mt-14 sm:px-6 lg:px-8">
          <div>
            <Bar className="h-6 w-16" />
            <div className="mt-4 flex gap-4 overflow-hidden">
              {CAST_PLACEHOLDERS.map((i) => (
                <div key={i} className="w-28 shrink-0">
                  <div className="aspect-[2/3] w-full rounded-lg bg-white/5 motion-safe:animate-pulse" />
                  <Bar className="mt-2 h-4 w-20" />
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-3">
            <Bar className="h-6 w-32" />
            <Bar className="h-4 w-full max-w-xl" />
            <Bar className="h-4 w-full max-w-lg" />
            <Bar className="h-4 w-full max-w-md" />
          </div>
        </div>
      </div>
    </div>
  )
}
