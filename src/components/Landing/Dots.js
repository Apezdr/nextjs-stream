'use client'
import { memo } from 'react'

const Dots = ({ mediaList, currentMediaIndex, handleDotClick, progress, progressSeconds }) => {
  return (
    <div className="absolute bottom-4 right-4 flex gap-1">
      {mediaList &&
        !mediaList.error &&
        mediaList.map((_, index) => (
          <button
            key={index}
            className={`transition-[width] h-2 rounded-full relative hover:bg-gray-600 ${index === currentMediaIndex ? 'bg-[#515151b5] w-10' : 'bg-gray-400 w-2'}`}
            onClick={() => handleDotClick(index)}
          >
            {index === currentMediaIndex && (
              <>
                <div
                  className="absolute top-0 left-0 h-full bg-gradient-to-r from-cyan-600 to-blue-500 rounded-full transition-[width] duration-200"
                  style={{ width: `${progress}%` }} // Directly use the progress prop
                ></div>
                <span className="absolute w-full h-full text-center text-white -bottom-3 left-0 text-[8px] leading-[0.5rem] select-none">
                  {progressSeconds > 0 ? progressSeconds : ''}
                </span>
              </>
            )}
          </button>
        ))}
    </div>
  )
}

const areEqual = (prevProps, nextProps) => {
  return (
    prevProps.mediaList === nextProps.mediaList &&
    prevProps.currentMediaIndex === nextProps.currentMediaIndex &&
    prevProps.progress === nextProps.progress &&
    prevProps.progressSeconds === nextProps.progressSeconds
  )
}

Dots.displayName = 'ProgressDots'
export default memo(Dots, areEqual)
