'use client'

import { useEffect, useState } from 'react'
import { getWatchedTime } from './watched'
import { WATCH_COMPLETION_PERCENT } from '@src/utils/watchHistory/progress'

const computeTotalRuntimeInPercentage = (metadata, videoURL, duration = false, watchedSeconds = null, mediaId = null) => {
  if (!videoURL && !mediaId) {
    return 0
  }

  // Use server-provided watchedSeconds if available, otherwise fallback to localStorage
  const watchedTimeInSeconds = (watchedSeconds !== null && watchedSeconds > 0)
    ? watchedSeconds
    : getWatchedTime(videoURL, mediaId)
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

/**
 * Whether a title counts as finished. The server's `completed` (computed at
 * join time from the catalog duration, one threshold for every client) wins
 * when present; the local percentage against the same threshold is the
 * fallback for rows the server did not annotate.
 */
export function isWatchedComplete(media, watchedWidth) {
  const serverFlag = media?.watchHistory?.completed
  if (typeof serverFlag === 'boolean') return serverFlag
  return Number.isFinite(watchedWidth) && watchedWidth >= WATCH_COMPLETION_PERCENT
}

const useWatchedWidth = (metadata, media) => {
  const [watchedWidth, setWatchedWidth] = useState(0)

  useEffect(() => {
    const checkForChanges = () => {
      // The server's progressPercent is the same number the TV app renders;
      // prefer it, then the server position, then localStorage.
      const serverPercent = media.watchHistory?.progressPercent
      const watchedSeconds = media.watchHistory?.playbackTime
        ? Math.round(media.watchHistory.playbackTime)
        : null
      const newWidth = Number.isFinite(serverPercent) && serverPercent > 0
        ? serverPercent
        : computeTotalRuntimeInPercentage(metadata, media.videoURL, media?.duration, watchedSeconds, media?.mediaId)
      if (newWidth !== watchedWidth) {
        setWatchedWidth(newWidth)
      }
    }

    checkForChanges()

    const intervalId = setInterval(checkForChanges, 5000)

    return () => {
      clearInterval(intervalId)
    }
  }, [metadata, media.videoURL, media?.mediaId, media?.duration, media.watchHistory?.playbackTime, media.watchHistory?.progressPercent, watchedWidth])

  return watchedWidth
}

export default useWatchedWidth
