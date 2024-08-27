'use client'
import { memo, useEffect, useState } from 'react'

const Dots = ({ mediaList, currentMediaIndex, handleDotClick, progress, setProgressUpdateRef }) => {
  const [localProgress, setLocalProgress] = useState(progress)

  useEffect(() => {
    setProgressUpdateRef((newProgress) => setLocalProgress(Math.min(newProgress, 100)))
  }, [setProgressUpdateRef])

  useEffect(() => {
    setLocalProgress(Math.min(progress, 100))
  }, [progress])

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
              key={localProgress === 0 ? 'reset' : 'progress'}
              className="absolute top-0 left-0 h-full bg-blue-500 rounded-full"
              style={{ width: `${localProgress}%` }}
            ></div>
          )}
        </button>
      ))}
    </div>
  )
}
Dots.displayName = 'ProgressDots'
export default memo(Dots)
