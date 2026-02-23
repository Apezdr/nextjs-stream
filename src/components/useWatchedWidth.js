'use client'

import { useEffect, useState } from 'react'
import { getWatchedTime } from './watched'

const computeTotalRuntimeInPercentage = (metadata, videoURL, duration = false, watchedSeconds = null) => {
  if (!videoURL) {
    return 0
  }

  // Use server-provided watchedSeconds if available, otherwise fallback to localStorage
  const watchedTimeInSeconds = (watchedSeconds !== null && watchedSeconds > 0)
    ? watchedSeconds
    : getWatchedTime(videoURL)
  let totalRuntimeInSeconds = 0

  if (duration) {
    totalRuntimeInSeconds = Math.floor(duration / 1000)
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
      // Prefer server-provided watchHistory.playbackTime if available
      const watchedSeconds = media.watchHistory?.playbackTime
        ? Math.round(media.watchHistory.playbackTime)
        : null
      const newWidth = computeTotalRuntimeInPercentage(metadata, media.videoURL, media?.duration, watchedSeconds)
      if (newWidth !== watchedWidth) {
        setWatchedWidth(newWidth)
      }
    }

    checkForChanges()

    const intervalId = setInterval(checkForChanges, 5000)

    return () => {
      clearInterval(intervalId)
    }
  }, [metadata, media.videoURL, media?.duration, media.watchHistory?.playbackTime, watchedWidth])

  return watchedWidth
}

export default useWatchedWidth
