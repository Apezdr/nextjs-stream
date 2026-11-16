'use client'

import useLiveProgress from '@components/WatchProgress/useLiveProgress'

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

function RuntimeText({ watchedSeconds, length, metadata, classNames }) {
  return <span className={classNames}>{formatWatchedTime(watchedSeconds, length ?? metadata?.runtime ?? 'Unknown')}</span>
}

/** The clock for a title whose position the caller did not read: read here, from the positions store. */
function LiveTotalRuntime({ length, metadata, mediaId, normalizedVideoId, watchHistory, classNames }) {
  const progress = useLiveProgress({ watchHistory, mediaId, normalizedVideoId })
  return <RuntimeText watchedSeconds={Math.round(progress.playbackTime)} length={length} metadata={metadata} classNames={classNames} />
}

/**
 * "00:41:12 - 01:58:03": how far the viewer is in a title, and its runtime.
 *
 * A surface that already reads the title's progress (a poster, through
 * useWatched) passes `watchedSeconds` and this only formats it. Without it the
 * position is read here: the newer of the item's `watchHistory` object and
 * what the positions store holds for the title, found by `mediaId` and
 * `normalizedVideoId`.
 *
 * @param {Object} props
 * @param {number} props.length - the runtime, in milliseconds
 * @param {Object} [props.metadata]
 * @param {string|null} [props.mediaId] - durable 'mid:…' identity
 * @param {string|null} [props.normalizedVideoId] - the hash of the title's file
 * @param {Object|null} [props.watchHistory] - the server's watch-history object for the title
 * @param {string} [props.classNames]
 * @param {number} [props.watchedSeconds] - the position, when the caller has read it
 */
export function TotalRuntime({ length, metadata, mediaId = null, normalizedVideoId = null, watchHistory = null, classNames, watchedSeconds }) {
  if (watchedSeconds !== undefined && watchedSeconds !== null) {
    return <RuntimeText watchedSeconds={watchedSeconds} length={length} metadata={metadata} classNames={classNames} />
  }
  return (
    <LiveTotalRuntime
      length={length}
      metadata={metadata}
      mediaId={mediaId}
      normalizedVideoId={normalizedVideoId}
      watchHistory={watchHistory}
      classNames={classNames}
    />
  )
}
