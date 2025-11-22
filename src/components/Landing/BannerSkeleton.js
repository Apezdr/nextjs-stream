'use client'

export default function BannerSkeleton({ bannerCount = 3 }) {
  return (
    <div className="mt-16 md:mt-0">
      <div className="relative w-full h-auto bg-gray-900 aspect-[16/6.6] animate-pulse">
        {/* Skeleton backdrop gradient */}
        <div className="absolute inset-0 bg-gradient-to-r from-gray-800 via-gray-700 to-gray-800"></div>
        
        {/* Skeleton content area */}
        <div className="absolute bottom-8 left-8 right-8 space-y-4">
          {/* Title skeleton */}
          <div className="h-12 w-3/4 bg-gray-600 rounded"></div>
          
          {/* Description skeleton */}
          <div className="space-y-2 w-2/3">
            <div className="h-4 bg-gray-700 rounded"></div>
            <div className="h-4 bg-gray-700 rounded w-5/6"></div>
          </div>
        </div>
        
        {/* Dots skeleton - shows actual banner count */}
        <div className="absolute bottom-4 right-4 flex gap-1">
          {[...Array(bannerCount)].map((_, index) => (
            <div key={index} className="w-2 h-2 rounded-full bg-gray-600"></div>
          ))}
        </div>
      </div>
    </div>
  )
}