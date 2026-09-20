import MediaListGridSkeleton from '@components/MediaPages/MediaListGridSkeleton'

/**
 * The TV and movie browse pages' frame with nothing in it yet: the Suspense
 * fallback while the session and the filters resolve, and so those routes'
 * prerendered shell, which is what a link has ready before the click.
 *
 * It mirrors the outer markup of TVListView / MovieListView (page frame, the
 * grid, the header cell) around the grid skeleton those views already use for
 * their own inner boundary. When you change that frame, change this with it.
 *
 * Server-safe; no data, no hooks.
 */
export default function MediaListPageSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading library"
      className="flex min-h-screen flex-col items-center justify-between xl:p-24 bg-[#060916e8]"
    >
      <span className="sr-only">Loading library…</span>
      <div className="h-auto flex items-center justify-center py-32 lg:py-0 px-4 xl:px-0 sm:mt-20">
        <ul className="grid grid-cols-1 gap-x-4 gap-y-8 sm:gap-x-6 sm:grid-cols-2 xl:grid-cols-4 xl:gap-x-8">
          <li>
            <div className="mx-auto h-8 w-56 rounded bg-gray-800 animate-pulse" />
            <div className="mx-auto mt-4 h-8 w-32 rounded bg-gray-800 animate-pulse" />
          </li>
          <MediaListGridSkeleton />
        </ul>
      </div>
    </div>
  )
}
