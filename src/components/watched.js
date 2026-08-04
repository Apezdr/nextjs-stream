'use client'

import { cache, useMemo } from 'react'
import { getPlaybackStorageKey, readWithLegacyFallback } from '@src/utils/playbackStorageKey'

export function getWatchedTime(videoURL, mediaId = null) {
  if (typeof window === 'undefined') return 0
  // Stable identity key when resolved; falls back to (and migrates forward
  // from) the legacy videoURL key.
  const stableKey = getPlaybackStorageKey({ mediaId, videoURL })
  const savedData = JSON.parse(readWithLegacyFallback(stableKey, videoURL))
  const savedTime = savedData ? Math.round(parseFloat(savedData.playbackTime)) : 0
  return savedTime
}

function convertRuntime(runtimeMs) {
  if (typeof runtimeMs !== 'number') {
    console.log('runtimeMs is not a number:', runtimeMs)
    return '00:00:00' // Return a default value or handle the error as needed
  }

  // Convert milliseconds to seconds
  const totalSeconds = Math.floor(runtimeMs / 1000)

  // Calculate hours, minutes, and seconds
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  // Format the string with leading zeros
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds
    .toString()
    .padStart(2, '0')}`
}

export function formatWatchedTime(watchedSeconds, totalRuntime) {
  const watchedHours = Math.floor(watchedSeconds / 3600)
  const watchedMinutes = Math.floor((watchedSeconds % 3600) / 60)
  const watchedSecondsRemaining = watchedSeconds % 60

  const formattedWatched = `${watchedHours.toString().padStart(2, '0')}:${watchedMinutes
    .toString()
    .padStart(2, '0')}:${watchedSecondsRemaining.toString().padStart(2, '0')}`
  return `${formattedWatched} - ${convertRuntime(totalRuntime)}`
}

export function TotalRuntime({ length, metadata, videoURL, mediaId = null, classNames, watchedSeconds }) {
  const displayTime = useMemo(() => {
    // Prefer server-provided watchedSeconds, fallback to localStorage
    const watchedTimeInSeconds = (watchedSeconds !== undefined && watchedSeconds !== null)
      ? watchedSeconds
      : getWatchedTime(videoURL, mediaId)
    const formattedDisplayTime = formatWatchedTime(
      watchedTimeInSeconds,
      length ?? metadata?.runtime ?? 'Unknown'
    )
    return formattedDisplayTime
  }, [length, metadata, videoURL, mediaId, watchedSeconds])

  return <span className={classNames}>{displayTime}</span>
}

export const totalRuntimeInPercentage = cache((length, metadata, videoURL, mediaId = null) => {
  if (!videoURL && !mediaId) {
    return 0
  }

  const watchedTimeInSeconds = getWatchedTime(videoURL, mediaId)
  let totalRuntimeInSeconds = 0

  if (length) {
    // Assuming 'length' is a property for movies, in ms to seconds
    totalRuntimeInSeconds = length / 1000
  } else if (metadata?.runtime) {
    // Assuming 'runtime' is a property for TV episodes, in minutes
    totalRuntimeInSeconds = metadata.runtime * 60
  }

  if (totalRuntimeInSeconds === 0) {
    return 0
  }

  return (watchedTimeInSeconds / totalRuntimeInSeconds) * 100
})
