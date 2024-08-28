'use client'
import { useState, useEffect, memo, useCallback } from 'react'
import { useTimer } from 'react-timer-hook'
import { useSwipeable } from 'react-swipeable' // Import useSwipeable
import BannerContent from './BannerContent'
import { usePathname } from 'next/navigation'

const BannerWithVideo = ({ mediaList }) => {
  const pathname = usePathname()
  const [currentMediaIndex, setCurrentMediaIndex] = useState(0)
  const [showVideo, setShowVideo] = useState(false)
  const [videoEnded, setVideoEnded] = useState(false)

  const videoDuration = 30 // Duration of the video in seconds
  const cycleDelay = 10 // Delay before cycling to next media in seconds
  const progressDuration = 40 // Duration of progress in seconds

  const {
    seconds: videoSeconds,
    start: startVideoTimer,
    pause: pauseVideoTimer,
    restart: restartVideoTimer,
  } = useTimer({
    expiryTimestamp: new Date(), // Provide an initial expiry timestamp
    autoStart: false, // Start manually
    onExpire: () => handleVideoEnd(),
  })

  const {
    seconds: cycleSeconds,
    start: startCycleTimer,
    pause: pauseCycleTimer,
    restart: restartCycleTimer,
  } = useTimer({
    expiryTimestamp: new Date(), // Provide an initial expiry timestamp
    autoStart: false, // Start manually
    onExpire: () => cycleToNextMedia(),
  })

  const {
    seconds: progressSeconds,
    start: startProgressTimer,
    restart: restartProgressTimer,
  } = useTimer({
    expiryTimestamp: new Date(), // Provide an initial expiry timestamp
    autoStart: false,
  })

  useEffect(() => {
    restartProgressTimer(new Date(Date.now() + progressDuration * 1000)) // Start progress timer when media changes
  }, [currentMediaIndex])

  useEffect(() => {
    const showVideoTimer = setTimeout(() => {
      setShowVideo(true)
      restartVideoTimer(new Date(Date.now() + videoDuration * 1000)) // Start video timer when the video is shown
    }, 3000)

    return () => clearTimeout(showVideoTimer)
  }, [currentMediaIndex, showVideo])

  const handleVideoEnd = useCallback(() => {
    setShowVideo(false)
    setVideoEnded(true)
    pauseVideoTimer()
    restartCycleTimer(new Date(Date.now() + cycleDelay * 1000)) // Start the cycle timer after video ends
  }, [pauseVideoTimer, restartCycleTimer])

  const cycleToNextMedia = useCallback(() => {
    setCurrentMediaIndex((prevIndex) => (prevIndex + 1) % mediaList.length)
    setShowVideo(false)
    setVideoEnded(false)
    restartCycleTimer(new Date(Date.now() + cycleDelay * 1000))
    restartProgressTimer(new Date(Date.now() + progressDuration * 1000))
  }, [mediaList.length, restartCycleTimer, restartProgressTimer])

  const handleDotClick = useCallback(
    (index) => {
      pauseVideoTimer() // Pause the video timer
      pauseCycleTimer() // Pause the cycle timer
      restartProgressTimer(new Date(Date.now() + progressDuration * 1000)) // Reset progress timer
      setCurrentMediaIndex(index)
      setShowVideo(false)
      setVideoEnded(false)
      startProgressTimer() // Restart progress timer for the new media
    },
    [pauseVideoTimer, pauseCycleTimer, restartProgressTimer, startProgressTimer]
  )

  const handleSwipe = useCallback(
    (direction) => {
      pauseVideoTimer() // Pause the video timer
      pauseCycleTimer() // Pause the cycle timer

      if (direction === 'LEFT') {
        setCurrentMediaIndex((prevIndex) => (prevIndex + 1) % mediaList.length)
      } else if (direction === 'RIGHT') {
        setCurrentMediaIndex((prevIndex) =>
          prevIndex === 0 ? mediaList.length - 1 : prevIndex - 1
        )
      }

      setShowVideo(false)
      setVideoEnded(false)
      restartCycleTimer(new Date(Date.now() + cycleDelay * 1000)) // Reset cycle timer
      restartProgressTimer(new Date(Date.now() + progressDuration * 1000)) // Reset progress timer
    },
    [pauseVideoTimer, pauseCycleTimer, restartCycleTimer, restartProgressTimer, mediaList.length]
  )

  const swipeHandlers = useSwipeable({
    onSwipedLeft: () => handleSwipe('LEFT'),
    onSwipedRight: () => handleSwipe('RIGHT'),
    preventDefaultTouchmoveEvent: true,
    trackMouse: true, // Enable mouse swiping for desktop
  })

  useEffect(() => {
    localStorage.setItem('videoMutedBanner', true) // Set muted initially for banner video
  }, [])

  const currentMedia = mediaList[currentMediaIndex]

  return (
    pathname === '/list' && (
      <div {...swipeHandlers}>
        <BannerContent
          currentMedia={currentMedia}
          showVideo={showVideo}
          videoEnded={videoEnded}
          handleVideoEnd={handleVideoEnd}
          handleDotClick={handleDotClick}
          progressSeconds={((progressDuration - progressSeconds) / progressDuration) * 100} // Calculate progress from 0% to 100%
          mediaList={mediaList}
          currentMediaIndex={currentMediaIndex}
          setCurrentMediaIndex={setCurrentMediaIndex}
        />
      </div>
    )
  )
}

export default memo(BannerWithVideo)
