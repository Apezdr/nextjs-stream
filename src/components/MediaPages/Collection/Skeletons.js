// Collection Page Skeleton Components
// Phase 2: Streaming & Suspense - Progressive loading UI

export function CollectionHeaderSkeleton() {
  return (
    <div className="relative min-h-96">
      {/* Background skeleton */}
      <div className="absolute inset-0 bg-gradient-to-b from-gray-800 to-gray-900 animate-pulse" />
      
      {/* Content skeleton */}
      <div className="relative min-h-96 flex items-end">
        <div className="w-full px-4 md:px-8 py-6 pt-24 pb-8">
          <div className="max-w-7xl mx-auto">
            {/* Breadcrumb skeleton */}
            <div className="mb-6 animate-pulse">
              <div className="flex items-center text-sm">
                <div className="h-4 w-16 bg-gray-700 rounded"></div>
                <div className="mx-3 h-4 w-4 bg-gray-700 rounded"></div>
                <div className="h-4 w-24 bg-gray-700 rounded"></div>
              </div>
            </div>

            <div className="text-center md:text-left">
              {/* Title skeleton */}
              <div className="h-12 md:h-16 w-3/4 bg-gray-700 rounded-lg mb-4 animate-pulse"></div>

              {/* Stats skeleton */}
              <div className="flex flex-wrap justify-center md:justify-start gap-4 mb-6">
                <div className="h-8 w-24 bg-gray-700 rounded-full animate-pulse"></div>
                <div className="h-8 w-32 bg-gray-700 rounded-full animate-pulse"></div>
              </div>

              {/* Overview skeleton */}
              <div className="max-w-3xl mx-auto md:mx-0 space-y-3">
                <div className="h-4 bg-gray-700 rounded animate-pulse"></div>
                <div className="h-4 bg-gray-700 rounded w-5/6 animate-pulse"></div>
                <div className="h-4 bg-gray-700 rounded w-4/6 animate-pulse"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function MovieGridSkeleton({ count = 12 }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-6">
      {Array.from({ length: count }, (_, i) => (
        <MovieCardSkeleton key={i} />
      ))}
    </div>
  )
}

export function MovieCardSkeleton() {
  return (
    <div className="group relative animate-pulse">
      <div className="relative rounded-xl overflow-hidden">
        {/* Poster skeleton */}
        <div className="aspect-[2/3] relative bg-gray-800">
          <div className="absolute inset-0 bg-gradient-to-t from-gray-900 via-transparent to-transparent" />
          
          {/* Top badges skeleton */}
          <div className="absolute top-3 left-3 right-3 flex justify-between items-start">
            <div className="flex flex-col gap-2">
              <div className="h-6 w-12 bg-gray-700 rounded-full"></div>
              <div className="h-6 w-16 bg-gray-700 rounded-full"></div>
            </div>
            <div className="h-6 w-20 bg-gray-700 rounded-full"></div>
          </div>

          {/* Movie info skeleton */}
          <div className="absolute bottom-0 left-0 right-0 p-4">
            <div className="h-4 bg-gray-700 rounded mb-2"></div>
            <div className="h-3 w-16 bg-gray-700 rounded"></div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function FilterControlsSkeleton() {
  return (
    <div className="sticky top-16 z-20 bg-gray-900/95 backdrop-blur-xl border-b border-gray-800">
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-4">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          {/* Filter pills skeleton */}
          <div className="flex flex-wrap gap-2 animate-pulse">
            <div className="h-8 w-24 bg-gray-700 rounded-full"></div>
            <div className="h-8 w-28 bg-gray-700 rounded-full"></div>
            <div className="h-8 w-32 bg-gray-700 rounded-full"></div>
          </div>

          {/* Controls skeleton */}
          <div className="flex items-center gap-4 animate-pulse">
            <div className="flex bg-gray-800 rounded-lg p-1">
              <div className="h-8 w-8 bg-gray-700 rounded"></div>
              <div className="h-8 w-8 bg-gray-700 rounded"></div>
            </div>
            <div className="h-8 w-32 bg-gray-700 rounded"></div>
          </div>
        </div>

        {/* Results count skeleton */}
        <div className="mt-4">
          <div className="h-4 w-48 bg-gray-700 rounded animate-pulse"></div>
        </div>
      </div>
    </div>
  )
}

export function TimelineViewSkeleton({ count = 6 }) {
  return (
    <div className="relative">
      <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-gradient-to-b from-indigo-600 via-indigo-500 to-indigo-600" />

      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="relative flex items-center mb-8 animate-pulse">
          <div className="absolute left-6 w-4 h-4 bg-gray-700 rounded-full border-4 border-gray-950 z-10" />

          <div className="ml-16 flex-1">
            <div className="bg-gray-900/50 backdrop-blur-sm rounded-xl p-6 border border-gray-800">
              <div className="flex gap-6">
                <div className="flex-shrink-0">
                  <div className="w-24 h-36 bg-gray-800 rounded-lg"></div>
                </div>

                <div className="flex-1">
                  <div className="flex items-start justify-between mb-2">
                    <div className="h-6 w-48 bg-gray-700 rounded"></div>
                    <div className="h-5 w-12 bg-gray-700 rounded"></div>
                  </div>

                  <div className="flex items-center gap-4 mb-4">
                    <div className="h-4 w-16 bg-gray-700 rounded"></div>
                    <div className="h-4 w-20 bg-gray-700 rounded"></div>
                    <div className="h-6 w-24 bg-gray-700 rounded-full"></div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="h-4 w-20 bg-gray-700 rounded"></div>
                    <div className="h-4 w-4 bg-gray-700 rounded"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export function CollectionSummarySkeleton() {
  return (
    <div className="bg-gray-900/50 border-y border-gray-800 animate-pulse">
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-6">
        <div className="flex flex-wrap justify-center gap-8">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="text-center">
              <div className="h-8 w-16 bg-gray-700 rounded mb-2"></div>
              <div className="h-4 w-20 bg-gray-700 rounded"></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function FeaturedContributorsSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-6 w-48 bg-gray-700 rounded mb-4"></div>
      <div className="flex gap-4 overflow-hidden">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex-shrink-0">
            <div className="w-16 h-16 bg-gray-700 rounded-full mb-2"></div>
            <div className="h-3 w-16 bg-gray-700 rounded"></div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Comprehensive page skeleton for initial load
export function CollectionPageSkeleton() {
  return (
    <div className="min-h-screen bg-gray-950">
      <CollectionHeaderSkeleton />
      <CollectionSummarySkeleton />
      
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-6">
        <FeaturedContributorsSkeleton />
      </div>

      <FilterControlsSkeleton />

      <div className="max-w-7xl mx-auto px-4 md:px-8 py-8">
        <MovieGridSkeleton count={12} />
      </div>
    </div>
  )
}