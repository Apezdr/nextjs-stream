// Grid columns shared by the watchlist grid and its skeletons: two posters
// across on a phone. From `lg` the 20rem sidebar is back, which is why `lg`
// holds at four columns.
export const WATCHLIST_GRID_CLASSES =
  'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4 lg:gap-6'

// Skeleton for one grid card: poster-shaped, so it holds the card's size at
// any column width
export function GridItemSkeleton() {
  return (
    <div className="bg-gray-800 rounded-lg overflow-hidden animate-pulse">
      <div className="aspect-[2/3] bg-gray-700"></div>
      <div className="p-3 sm:p-4">
        <div className="h-4 bg-gray-700 rounded w-3/4 mb-2"></div>
        <div className="h-3 bg-gray-700 rounded w-1/2"></div>
      </div>
    </div>
  )
}

// Skeleton for the sidebar summary stats section
export function SummaryStatsSkeleton() {
  return (
    <div className="bg-gray-700 rounded-lg p-4 mb-4 animate-pulse">
      <div className="grid grid-cols-2 gap-4 text-center">
        <div>
          <div className="h-8 w-8 bg-gray-600 rounded mx-auto mb-2"></div>
          <div className="h-3 bg-gray-600 rounded w-16 mx-auto"></div>
        </div>
        <div>
          <div className="h-8 w-8 bg-gray-600 rounded mx-auto mb-2"></div>
          <div className="h-3 bg-gray-600 rounded w-12 mx-auto"></div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 text-center mt-3 pt-3 border-t border-gray-600">
        <div>
          <div className="h-6 w-6 bg-gray-600 rounded mx-auto mb-2"></div>
          <div className="h-3 bg-gray-600 rounded w-10 mx-auto"></div>
        </div>
        <div>
          <div className="h-6 w-6 bg-gray-600 rounded mx-auto mb-2"></div>
          <div className="h-3 bg-gray-600 rounded w-14 mx-auto"></div>
        </div>
      </div>
    </div>
  )
}

// Skeleton for individual playlist items in the sidebar
export function PlaylistItemSkeleton() {
  return (
    <div className="rounded-lg p-3 bg-gray-700 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <div className="h-4 bg-gray-600 rounded w-24 mb-2"></div>
          <div className="h-3 bg-gray-600 rounded w-16 mb-1"></div>
          <div className="flex items-center space-x-2">
            <div className="h-3 bg-gray-600 rounded w-12"></div>
            <div className="h-3 bg-gray-600 rounded w-8"></div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Skeleton for the playlist list in the sidebar
export function PlaylistListSkeleton({ count = 3 }) {
  return (
    <div className="p-4 space-y-2">
      {Array.from({ length: count }, (_, i) => (
        <PlaylistItemSkeleton key={`playlist-skeleton-${i}`} />
      ))}
    </div>
  )
}

// Skeleton for the controls section (search, filters, etc.)
export function ControlsSkeleton() {
  return (
    <div className="bg-gray-800 border-b border-gray-700 px-4 py-3 lg:px-6 lg:py-4 animate-pulse">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between space-y-3 md:space-y-4 lg:space-y-0">
        {/* Search skeleton */}
        <div className="flex-1 md:max-w-md">
          <div className="h-10 bg-gray-700 rounded-md"></div>
        </div>

        {/* Mobile controls skeleton: type filter, sort, select */}
        <div className="flex items-center gap-2 md:hidden">
          <div className="h-10 flex-1 bg-gray-700 rounded-lg"></div>
          <div className="h-10 w-10 bg-gray-700 rounded-lg"></div>
          <div className="h-10 w-16 bg-gray-700 rounded-lg"></div>
        </div>

        {/* Controls skeleton */}
        <div className="hidden md:flex items-center space-x-4">
          {/* Select all button skeleton */}
          <div className="w-9 h-9 bg-gray-700 rounded-md"></div>
          
          {/* Filter dropdown skeleton */}
          <div className="w-24 h-9 bg-gray-700 rounded-md"></div>
          
          {/* Sort controls skeleton */}
          <div className="w-32 h-9 bg-gray-700 rounded-md"></div>
          
          {/* View mode buttons skeleton */}
          <div className="flex rounded-md overflow-hidden">
            <div className="w-9 h-9 bg-gray-700"></div>
            <div className="w-9 h-9 bg-gray-700"></div>
          </div>
        </div>
      </div>
    </div>
  )
}
// Skeleton for the header section
export function HeaderSkeleton() {
  return (
    <div className="bg-gray-800 border-b border-gray-700 px-4 py-3 lg:px-6 lg:py-4 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-7 lg:h-8 bg-gray-700 rounded w-40 lg:w-48"></div>
        <div className="flex items-center space-x-3">
          <div className="hidden lg:block h-9 w-24 bg-gray-700 rounded"></div>
          <div className="h-9 w-9 bg-gray-700 rounded"></div>
        </div>
      </div>
    </div>
  )
}


// Complete page skeleton for initial loading state
export function WatchlistPageSkeleton() {
  return (
    <div className="flex min-h-screen bg-gray-900">
      {/* Sidebar Skeleton - desktop only; phones get the playlist drawer */}
      <div className="hidden lg:flex w-80 shrink-0 bg-gray-800 border-r border-gray-700 flex-col">
        {/* Header */}
        <div className="p-6 border-b border-gray-700 animate-pulse">
          <div className="h-6 bg-gray-700 rounded w-20 mb-4"></div>
          
          {/* Summary Stats Skeleton */}
          <SummaryStatsSkeleton />

          {/* Create Playlist Button Skeleton */}
          <div className="w-full h-10 bg-gray-700 rounded-md"></div>
        </div>

        {/* Playlist List Skeleton */}
        <div className="flex-1 overflow-y-auto">
          <PlaylistListSkeleton count={4} />
        </div>
      </div>

      {/* Main Content Skeleton */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Header Skeleton */}
        <HeaderSkeleton />

        {/* Controls Skeleton */}
        <ControlsSkeleton />

        {/* Content Skeleton */}
        <div className="flex-1 p-4 lg:p-6">
          <div className={WATCHLIST_GRID_CLASSES}>
            {Array.from({ length: 12 }, (_, i) => (
              <GridItemSkeleton key={`content-skeleton-${i}`} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}