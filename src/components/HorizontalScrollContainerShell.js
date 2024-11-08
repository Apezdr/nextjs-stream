'use client'

import { classNames } from '@src/utils'
import SkeletonCard from '@components/MediaScroll/SkeletonCard'

const HorizontalScrollContainerShell = ({ skeletonCount = 0 }) => {
  return (
    <div className="relative my-8 w-full flex flex-col justify-center overflow-hidden max-w-[100vw]">
      {/* Carousel Container */}
      <div className="flex flex-row items-center w-full relative">
        {/* Cards Container with Framer Motion */}
        <div
          className={classNames(
            'relative flex flex-grow overflow-visible h-[22rem]',
            'justify-start'
          )}
        >
          <div
            className={classNames(
              'ml-3',
              'absolute inset-0 flex gap-x-4 justify-center items-start cards-row'
            )}
            style={{ willChange: 'transform, opacity' }}
          >
            {skeletonCount > 0 &&
              Array.from({ length: skeletonCount }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        </div>
      </div>
    </div>
  )
}

export default HorizontalScrollContainerShell
