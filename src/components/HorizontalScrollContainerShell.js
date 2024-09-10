'use client'
import { ScrollMenu } from 'react-horizontal-scrolling-menu'
import { SkeletonCard } from './MediaScroll/Card'

const HorizontalScrollContainerShell = ({ skeletonCount = 0 }) => {
  return (
    <ScrollMenu
      wrapperClassName="w-full p-4 shadow-xl rounded-xl bg-gradient-to-br from-blue-500 via-blue-400 to-blue-600"
      scrollContainerClassName="scrollbar scrollbar-thumb-rounded scrollbar-thumb-blue-200 scrollbar-track-gray-500"
    >
      {skeletonCount > 0 &&
        Array.from({ length: skeletonCount }).map((_, i) => <SkeletonCard key={i} />)}
    </ScrollMenu>
  )
}

export default HorizontalScrollContainerShell
