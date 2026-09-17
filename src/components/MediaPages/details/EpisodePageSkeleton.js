import { classNames } from '@src/utils'

/**
 * The episode info page's frame with nothing in it yet: the Suspense
 * fallback while an episode's cached content resolves.
 *
 * It mirrors TVEpisodeDetailsComponent block for block — same page frame,
 * same hero grid, same 16:9 still, same nav row and two-column surface — so
 * going from one episode to the next fills the layout in instead of
 * collapsing the page to a spinner and reflowing it back. When you change
 * that component's layout, change this with it. It carries the
 * `media-details-page` marker too, so the lifted backdrop does not flicker
 * between the two.
 *
 * Server-safe; no data, no hooks.
 */

const BAR = 'block rounded bg-white/10 motion-safe:animate-pulse'

function Bar({ className }) {
  return <span className={classNames(BAR, className)} />
}

const CAST_PLACEHOLDERS = [0, 1, 2, 3, 4, 5, 6, 7]
const FACT_PLACEHOLDERS = ['w-24', 'w-40', 'w-16', 'w-36', 'w-28', 'w-44', 'w-32', 'w-20']

export default function EpisodePageSkeleton() {
  return (
    <div className="pt-16 w-full">
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading episode"
        className="media-details-page relative mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6 lg:px-8"
      >
        <span className="sr-only">Loading episode…</span>

        {/* Trail row */}
        <div className="flex min-w-0 items-center justify-between gap-4 pt-4">
          <div className="flex min-w-0 items-center gap-1.5">
            <Bar className="h-5 w-6" />
            <Bar className="h-5 w-40" />
            <Bar className="h-5 w-16" />
            <Bar className="h-5 w-20" />
          </div>
        </div>

        {/* Hero: text left, still right at lg; still first on phones */}
        <header className="mt-6 grid gap-6 sm:mt-10 lg:grid-cols-[minmax(0,55fr)_minmax(0,45fr)] lg:gap-x-10">
          <div className="min-w-0 lg:col-start-1 lg:row-start-1">
            <Bar className="h-4 w-44" />
            <Bar className="mt-2 h-8 w-3/4 sm:h-12" />
            <Bar className="mt-3 h-5 w-64 max-w-full" />
            <div className="mt-3 max-w-[65ch] space-y-2">
              <Bar className="h-4 w-full" />
              <Bar className="h-4 w-11/12" />
              <Bar className="h-4 w-2/3" />
            </div>
          </div>

          <div className="order-first lg:order-none lg:col-start-2 lg:row-span-2 lg:row-start-1">
            <div className="relative aspect-[16/9] overflow-hidden rounded-lg bg-white/5 ring-1 ring-white/10 motion-safe:animate-pulse" />
            <div className="mt-2 flex justify-end">
              <Bar className="h-5 w-36" />
            </div>
          </div>

          <div className="self-start lg:col-start-1 lg:row-start-2">
            <div className="flex flex-wrap items-center gap-3">
              <Bar className="h-12 w-full rounded-md sm:w-44" />
              <Bar className="h-12 w-28 rounded-md" />
              <Bar className="h-12 w-28 rounded-md" />
            </div>
          </div>
        </header>

        {/* Previous / all / next */}
        <div className="mt-8 grid grid-cols-3 items-center gap-4 py-4">
          <Bar className="h-5 w-32" />
          <Bar className="h-5 w-28 justify-self-center" />
          <Bar className="h-5 w-40 max-w-full justify-self-end" />
        </div>

        {/* Surface: cast tabs left, facts panel right */}
        <div className="mt-10 grid gap-8 rounded-2xl bg-[#070b1d]/65 px-4 py-8 ring-1 ring-white/5 sm:mt-14 sm:px-6 lg:grid-cols-2 lg:px-8">
          <div>
            <div className="mb-4 flex gap-6 border-b border-white/10 pb-2">
              <Bar className="h-5 w-28" />
              <Bar className="h-5 w-28" />
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(6rem,1fr))] justify-items-center gap-x-4 gap-y-6">
              {CAST_PLACEHOLDERS.map((i) => (
                <div key={i} className="flex w-24 flex-col items-center">
                  <span className="block size-20 rounded-full bg-white/10 motion-safe:animate-pulse" />
                  <Bar className="mt-2 h-4 w-20" />
                  <Bar className="mt-1 h-3 w-14" />
                </div>
              ))}
            </div>
          </div>
          <div>
            <Bar className="mb-4 h-6 w-36" />
            <div className="grid grid-cols-[minmax(6.5rem,max-content)_1fr] gap-x-6 gap-y-3 rounded-xl bg-white/5 p-5 ring-1 ring-white/10">
              {FACT_PLACEHOLDERS.map((width, i) => (
                <div key={i} className="contents">
                  <Bar className="h-5 w-20" />
                  <Bar className={classNames('h-5', width)} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
