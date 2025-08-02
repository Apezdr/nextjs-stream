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

// Skeleton for the main content header (playlist title and description)
export function HeaderSkeleton() {
  return (
    <div className="bg-gray-800 border-b border-gray-700 px-6 py-4 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          {/* Back button skeleton */}
          <div className="w-6 h-6 bg-gray-700 rounded"></div>
          
          {/* Title skeleton */}
          <div className="h-8 bg-gray-700 rounded w-48"></div>
          
          {/* Description skeleton */}
          <div className="h-4 bg-gray-700 rounded w-32"></div>
        </div>
        
        <div className="flex items-center space-x-2">
          {/* Item count skeleton */}
          <div className="h-4 bg-gray-700 rounded w-16"></div>
          
          {/* Refresh button skeleton */}
          <div className="w-9 h-9 bg-gray-700 rounded-md"></div>
        </div>
      </div>
    </div>
  )
}

// Skeleton for the controls section (search, filters, etc.)
export function ControlsSkeleton() {
  return (
    <div className="bg-gray-800 border-b border-gray-700 px-6 py-4 animate-pulse">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between space-y-4 lg:space-y-0">
        {/* Search skeleton */}
        <div className="flex-1 max-w-md">
          <div className="h-10 bg-gray-700 rounded-md"></div>
        </div>

        {/* Controls skeleton */}
        <div className="flex items-center space-x-4">
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

// Complete page skeleton for initial loading state
export function WatchlistPageSkeleton() {
  return (
    <div className="flex min-h-screen bg-gray-900">
      {/* Sidebar Skeleton */}
      <div className="w-80 bg-gray-800 border-r border-gray-700 flex flex-col">
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
      <div className="flex-1 flex flex-col">
        {/* Header Skeleton */}
        <HeaderSkeleton />

        {/* Controls Skeleton */}
        <ControlsSkeleton />

        {/* Content Skeleton */}
        <div className="flex-1 p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
            {Array.from({ length: 12 }, (_, i) => (
              <div
                key={`content-skeleton-${i}`}
                className="bg-gray-800 rounded-lg p-4 animate-pulse"
              >
                <div className="w-full h-64 bg-gray-700 rounded mb-4"></div>
                <div className="h-4 bg-gray-700 rounded w-3/4 mb-2"></div>
                <div className="h-3 bg-gray-700 rounded w-1/2"></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}