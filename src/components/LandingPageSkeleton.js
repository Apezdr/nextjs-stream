import HorizontalScrollSkeleton from '@components/MediaScroll/HorizontalScrollSkeleton'

// Generic section labels mirroring the real LandingPage rows. These are static UI
// strings (not user/media data), so they are safe to render in the public shell.
const SKELETON_ROWS = [
  { key: 'recentlyWatched', label: 'Watch History' },
  { key: 'recentlyAdded', label: 'Recently Added' },
  { key: 'movie', label: 'Movies' },
  { key: 'tv', label: 'TV' },
]

/**
 * Data-free loading skeleton for the /list landing content (everything below the
 * banner). Used as the Suspense fallback in the list page so the Partial
 * Prerendering static shell can be served/streamed instantly while the
 * authenticated, user-specific content resolves in the dynamic hole.
 *
 * SECURITY: contains NO user or media data. It is rendered in the public,
 * pre-auth shell and is therefore safe to expose to unauthenticated visitors.
 * Keep it that way — never fetch or pass real data into this component.
 */
export default function LandingPageSkeleton() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-between xl:py-24 bg-[#060916e8]">
      {/* Welcome heading placeholder (mirrors WelcomeSection layout) */}
      <div className="h-auto flex w-full pt-12 lg:py-0 px-4 xl:px-0 relative">
        <ul className="grid w-full grid-cols-1 sm:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-8 sm:gap-x-6 xl:gap-x-8">
          <li className="col-span-1 sm:col-span-2">
            <div className="h-9 w-56 sm:h-10 sm:w-72 bg-gray-700 rounded animate-pulse" />
            <div className="mt-6 h-6 w-72 sm:w-96 bg-gray-700 rounded animate-pulse" />
          </li>
        </ul>
      </div>

      {/* Horizontal scroll row placeholders */}
      <div className="flex flex-col w-full mt-10">
        {SKELETON_ROWS.map((row) => (
          <div key={row.key}>
            <h2 className="text-xl font-bold text-left mt-4 ml-4">{row.label}</h2>
            <HorizontalScrollSkeleton type={row.key} />
          </div>
        ))}
      </div>
    </div>
  )
}
