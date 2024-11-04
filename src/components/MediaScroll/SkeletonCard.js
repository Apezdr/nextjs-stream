import { memo } from 'react'

const SkeletonCard = memo(() => (
  <div className="w-32 md:w-36 lg:w-48 flex-shrink-0">
    <div className="animate-pulse">
      <div className="aspect-[2/3] h-72 bg-gray-300 rounded-lg w-full"></div>
      <div className="mt-2 bg-gray-300 h-4 w-3/4 mx-auto rounded"></div>
      <div className="mt-1 bg-gray-300 h-3 w-1/2 mx-auto rounded"></div>
    </div>
  </div>
))

SkeletonCard.displayName = 'SkeletonCard'

export default SkeletonCard
