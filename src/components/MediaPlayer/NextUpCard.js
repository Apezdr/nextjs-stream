'use client'
import { useMediaState } from '@vidstack/react'
import Image from 'next/image'
import Link from 'next/link'
import { memo, useEffect, useRef, useState, useMemo, useCallback } from 'react'

function NextUpCard({
  mediaTitle,
  season_number,
  nextEpisodeNumber,
  nextEpisodeThumbnail,
  nextEpisodeThumbnailBlurhash,
  nextEpisodeTitle,
  hasNextEpisode,
  mediaLength,
}) {
  const currentPlaybackTime = useMediaState('currentTime')
  const playbackTimeRef = useRef(currentPlaybackTime)
  const [isHovering, setIsHovering] = useState(false)
  const [remainingTime, setRemainingTime] = useState(15000)
  const [timerInitialized, setTimerInitialized] = useState(false)
  const timerRef = useRef(null)
  const intervalRef = useRef(null)

  const progressBarWidth = useMemo(() => {
    return `${(1 - remainingTime / 15000) * 100}%`
  }, [remainingTime])

  useEffect(() => {
    if (playbackTimeRef.current !== currentPlaybackTime) {
      playbackTimeRef.current = currentPlaybackTime
    }
  }, [currentPlaybackTime])

  const startTimer = useCallback(
    (duration) => {
      clearTimeout(timerRef.current)
      clearInterval(intervalRef.current)
      setRemainingTime(duration)

      let endTime = Date.now() + duration
      timerRef.current = setTimeout(() => {
        window.location.href = `/list/tv/${mediaTitle}/${season_number}/${nextEpisodeNumber}`
      }, duration)

      intervalRef.current = setInterval(() => {
        let timeLeft = endTime - Date.now()
        setRemainingTime(Math.max(timeLeft, 0))
        if (timeLeft <= 0) {
          clearInterval(intervalRef.current)
        }
      }, 1000)
    },
    [mediaTitle, season_number, nextEpisodeNumber]
  )

  useEffect(() => {
    if (
      mediaLength &&
      playbackTimeRef.current * 1000 > mediaLength - 35000 &&
      hasNextEpisode &&
      !isHovering &&
      !timerInitialized
    ) {
      startTimer(15000)
      setTimerInitialized(true)
    }
  }, [hasNextEpisode, isHovering, timerInitialized, mediaLength, startTimer])

  useEffect(() => {
    return () => {
      clearTimeout(timerRef.current)
      clearInterval(intervalRef.current)
    }
  }, [])

  const handleMouseOver = useCallback(() => {
    setIsHovering(true)
    clearTimeout(timerRef.current)
    clearInterval(intervalRef.current)
  }, [])

  const handleMouseOut = useCallback(() => {
    setIsHovering(false)
    if (currentPlaybackTime * 1000 > mediaLength - 35000 && hasNextEpisode && !timerInitialized) {
      startTimer(remainingTime)
      setTimerInitialized(true)
    }
  }, [
    currentPlaybackTime,
    mediaLength,
    hasNextEpisode,
    timerInitialized,
    startTimer,
    remainingTime,
  ])

  return (
    mediaLength && hasNextEpisode &&
    currentPlaybackTime * 1000 > mediaLength - 35000 && (
      <NextUpCardContent
        mediaTitle={mediaTitle}
        progressBarWidth={progressBarWidth}
        nextEpisodeThumbnail={nextEpisodeThumbnail}
        nextEpisodeThumbnailBlurhash={nextEpisodeThumbnailBlurhash}
        nextEpisodeTitle={nextEpisodeTitle}
        season_number={season_number}
        nextEpisodeNumber={nextEpisodeNumber}
      />
    )
  )
}

const NextUpCardContent = memo(
  ({
    mediaTitle,
    progressBarWidth,
    nextEpisodeThumbnail,
    nextEpisodeThumbnailBlurhash,
    nextEpisodeTitle,
    season_number,
    nextEpisodeNumber,
  }) => {
    return (
      <Link
        href={`/list/tv/${mediaTitle}/${season_number}/${nextEpisodeNumber}/play?start=0`}
        className="group pointer-events-auto max-h-20"
      >
        <div className="absolute rounded-lg bottom-10 right-4 z-10 flex flex-col items-center justify-center py-12 w-40 h-52 bg-black group-hover:bg-gray-900 bg-opacity-50">
          <div
            className="h-1 bg-blue-500 absolute top-0 left-0 transition-[width]"
            style={{ width: progressBarWidth }}
          ></div>
          <h5 className="font-sans font-bold text-white mb-2">Next Up:</h5>
          <Image
            src={nextEpisodeThumbnail}
            alt={nextEpisodeTitle}
            className="!w-auto !h-auto rounded-lg opacity-50 group-hover:opacity-100 max-h-full max-w-32"
            placeholder={nextEpisodeThumbnailBlurhash ? "blur" : "empty"}
            blurDataURL={nextEpisodeThumbnailBlurhash}
            width={128}
            height={180}
          />
          <h5 className="font-sans text-white mt-2 text-base">
            S{season_number} EP{nextEpisodeNumber}
          </h5>
          <h5 className="font-sans font-bold text-white mt-0 text-center">{nextEpisodeTitle}</h5>
        </div>
      </Link>
    )
  }
)
NextUpCardContent.displayName = 'NextUpCardContent'

export default memo(NextUpCard)
