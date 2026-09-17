import { classNames } from '@src/utils'

/**
 * The season info page's frame with nothing in it yet: the Suspense
 * fallback while a season's content resolves, so switching seasons fills
 * the layout in place instead of collapsing to a full-screen spinner.
 *
 * It mirrors TVEpisodesListComponent block for block — page frame, trail
 * row, the small-poster hero grid, the episodes header and list rows — and
 * carries the `media-details-page` marker so the lifted backdrop holds
 * steady. When you change that component's layout, change this with it.
 *
 * Server-safe; no data, no hooks.
 */

const BAR = 'block rounded bg-white/10 motion-safe:animate-pulse'

function Bar({ className }) {
  return <span className={classNames(BAR, className)} />
}

const ROW_PLACEHOLDERS = [0, 1, 2, 3, 4]

export default function SeasonPageSkeleton() {
  return (
    <div className="pt-16 w-full">
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading season"
        className="media-details-page relative mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6 lg:px-8"
      >
        <span className="sr-only">Loading season…</span>

        {/* Trail row */}
        <div className="flex min-w-0 items-center justify-between gap-4 pt-4">
          <div className="flex min-w-0 items-center gap-1.5">
            <Bar className="h-5 w-6" />
            <Bar className="h-5 w-40" />
            <Bar className="h-5 w-20" />
          </div>
        </div>

        {/* Hero: small poster left, text and actions right */}
        <header className="mt-6 grid grid-cols-[120px_minmax(0,1fr)] gap-x-5 gap-y-6 sm:mt-10 sm:gap-x-8">
          <div className="row-span-2 aspect-[2/3] w-[120px] self-start rounded-lg bg-white/10 ring-1 ring-white/10 motion-safe:animate-pulse" />
          <div className="min-w-0">
            <Bar className="h-4 w-32" />
            <Bar className="mt-2 h-8 w-56 max-w-full sm:h-12" />
            <Bar className="mt-3 h-5 w-64 max-w-full" />
            <div className="mt-3 max-w-[65ch] space-y-2">
              <Bar className="h-4 w-full" />
              <Bar className="h-4 w-3/4" />
            </div>
          </div>
          <div className="col-span-2 self-start sm:col-span-1 sm:col-start-2">
            <div className="flex flex-wrap items-center gap-3">
              <Bar className="h-12 w-full rounded-md sm:w-48" />
              <Bar className="h-12 w-40 rounded-md" />
            </div>
          </div>
        </header>

        {/* Episodes header and rows */}
        <section className="mt-10 sm:mt-14">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-baseline gap-4">
              <Bar className="h-6 w-24" />
              <Bar className="h-8 w-32 rounded-md" />
            </div>
            <Bar className="h-10 w-20 rounded-md" />
          </div>
          <ul>
            {ROW_PLACEHOLDERS.map((i) => (
              <li
                key={i}
                className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-start gap-x-4 gap-y-3 border-b border-white/10 py-5 last:border-b-0 sm:grid-cols-[2.5rem_minmax(0,220px)_1fr_auto]"
              >
                <Bar className="mt-0.5 h-4 w-6" />
                <div className="aspect-[16/9] w-full max-w-[220px] rounded-lg bg-white/5 ring-1 ring-white/10 motion-safe:animate-pulse" />
                <div className="col-start-2 min-w-0 space-y-2 sm:col-start-auto">
                  <Bar className="h-5 w-48 max-w-full" />
                  <Bar className="h-4 w-full" />
                  <Bar className="h-4 w-2/3" />
                </div>
                <Bar className="col-start-2 h-5 w-12 sm:col-start-auto sm:justify-self-end" />
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
