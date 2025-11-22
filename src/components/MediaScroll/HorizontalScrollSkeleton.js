'use client'

import SkeletonCard from './SkeletonCard'

export default function HorizontalScrollSkeleton({ type }) {
  // Show appropriate skeleton count based on type
  const defaultCount = type === 'recentlyWatched' ? 4 : 6
  
  return (
    <div className="relative my-8 w-full flex flex-col justify-center overflow-hidden max-w-[100vw]">
      <div className="flex flex-row items-center w-full relative">
        {/* Empty arrow space - matches HorizontalScroll structure */}
        <div className="w-16 h-full"></div>
        
        {/* Skeleton cards container - matches HorizontalScroll structure */}
        <div className="relative flex flex-grow overflow-visible h-[22rem] justify-center">
          <div className="flex gap-x-4 justify-center items-start">
            {Array.from({ length: defaultCount }).map((_, i) => (
              <SkeletonCard key={`skeleton-${i}`} />
            ))}
          </div>
        </div>
        
        {/* Empty arrow space - matches HorizontalScroll structure */}
        <div className="w-16 h-full"></div>
      </div>
    </div>
  )
}