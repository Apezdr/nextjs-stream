'use client'

import { useEffect, useState } from 'react'
import { getWatchedTime } from './watched'

const computeTotalRuntimeInPercentage = (metadata, videoURL, length = false) => {
  if (!videoURL) {
    return 0
  }

  const watchedTimeInSeconds = getWatchedTime(videoURL)
  let totalRuntimeInSeconds = 0

  if (length) {
    totalRuntimeInSeconds = Math.floor(length / 1000)
  } else if (metadata?.runtime) {
    totalRuntimeInSeconds = metadata.runtime * 60
  }

  if (totalRuntimeInSeconds === 0) {
    return 0
  }

  return (watchedTimeInSeconds / totalRuntimeInSeconds) * 100
}

const useWatchedWidth = (metadata, media) => {
  const [watchedWidth, setWatchedWidth] = useState(0)

  useEffect(() => {
    const checkForChanges = () => {
      const newWidth = computeTotalRuntimeInPercentage(metadata, media.videoURL, media?.length)
      if (newWidth !== watchedWidth) {
        setWatchedWidth(newWidth)
      }
    }

    checkForChanges()

    const intervalId = setInterval(checkForChanges, 5000)

    return () => {
      clearInterval(intervalId)
    }
  }, [metadata, media.videoURL, media?.length, watchedWidth])

  return watchedWidth
}

export default useWatchedWidth
