'use client'
import { memo } from 'react'

const Dots = ({ mediaList, currentMediaIndex, handleDotClick, progress }) => {
  return (
    <div className="absolute bottom-4 right-4 flex gap-1">
      {mediaList.map((_, index) => (
        <button
          key={index}
          className={`transition-[width] h-2 rounded-full relative ${index === currentMediaIndex ? 'bg-white w-4' : 'bg-gray-400 w-2'}`}
          onClick={() => handleDotClick(index)}
        >
          {index === currentMediaIndex && (
            <div
              className="absolute top-0 left-0 h-full bg-blue-500 rounded-full"
              style={{ width: `${progress}%` }} // Directly use the progress prop
            ></div>
          )}
        </button>
      ))}
    </div>
  )
}

Dots.displayName = 'ProgressDots'
export default memo(Dots)
