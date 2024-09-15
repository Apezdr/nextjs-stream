'use client'
import { useState, useEffect, useRef, memo, useCallback, useMemo } from 'react'
import { useSwipeable } from 'react-swipeable'
import { useTimer } from 'react-timer-hook'
import { lazy } from 'react'

const Dots = lazy(() => import('./Dots'))
const BannerContent = lazy(() => import('./BannerContent'))

const BannerWithVideo = ({ mediaList }) => {
  const [currentMediaIndex, setCurrentMediaIndex] = useState(0)
  const [showVideo, setShowVideo] = useState(false)
  const isFullscreenRef = useRef(false)

  const bannerDisplayBeforeVideo = 5
  const videoDuration = 30
  const bannerDisplayAfterVideo = 10
  const totalSlideDuration = bannerDisplayBeforeVideo + videoDuration + bannerDisplayAfterVideo

  const currentStepRef = useRef(0)
  const [currentStep, setCurrentStep] = useState(0)

  const {
    seconds,
    restart: restartTimer,
    pause: pauseTimer,
    resume: resumeTimer,
    isRunning,
  } = useTimer({
    expiryTimestamp: new Date(),
    onExpire: () => handleNextStep(),
    autoStart: false,
  })

  const calculatedProgress = useMemo(() => {
    let progressSeconds = 0

    if (isRunning) {
      switch (currentStepRef.current) {
        case 0:
          progressSeconds = bannerDisplayBeforeVideo - seconds
          break
        case 1:
          progressSeconds = bannerDisplayBeforeVideo + (videoDuration - seconds)
          break
        case 2:
          progressSeconds =
            bannerDisplayBeforeVideo + videoDuration + (bannerDisplayAfterVideo - seconds)
          break
      }
    }

    return totalSlideDuration - Math.ceil(Math.min(progressSeconds, totalSlideDuration))
  }, [seconds, isRunning, totalSlideDuration])

  useEffect(() => {
    let duration = 0
    switch (currentStepRef.current) {
      case 0:
        duration = bannerDisplayBeforeVideo
        break
      case 1:
        duration = videoDuration
        break
      case 2:
        duration = bannerDisplayAfterVideo
        break
    }

    const time = new Date()
    time.setSeconds(time.getSeconds() + duration)
    restartTimer(time)
  }, [currentStep, restartTimer])

  const startSlideCycle = useCallback(() => {
    currentStepRef.current = 0
    setShowVideo(false)
    const time = new Date()
    time.setSeconds(time.getSeconds() + bannerDisplayBeforeVideo)
    restartTimer(time)
    setCurrentStep(currentStepRef.current)
  }, [restartTimer, bannerDisplayBeforeVideo])

  const cycleToNextMedia = useCallback(() => {
    setCurrentMediaIndex((prevIndex) => (prevIndex + 1) % mediaList.length)
    startSlideCycle()
  }, [mediaList.length, startSlideCycle])

  const handleDotClick = useCallback(
    (index) => {
      setCurrentMediaIndex(index)
      startSlideCycle()
    },
    [startSlideCycle]
  )

  const handleSwipe = useCallback(
    (direction) => {
      setCurrentMediaIndex((prevIndex) =>
        direction === 'LEFT'
          ? (prevIndex + 1) % mediaList.length
          : prevIndex === 0
            ? mediaList.length - 1
            : prevIndex - 1
      )
      startSlideCycle()
    },
    [mediaList.length, startSlideCycle]
  )

  const swipeHandlers = useSwipeable({
    onSwipedLeft: () => handleSwipe('LEFT'),
    onSwipedRight: () => handleSwipe('RIGHT'),
    preventDefaultTouchmoveEvent: true,
    trackMouse: true,
  })

  useEffect(() => {
    const handleFullscreenChange = () => {
      isFullscreenRef.current = !!document.fullscreenElement
      isFullscreenRef.current ? pauseTimer() : resumeTimer()
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }
  }, [pauseTimer, resumeTimer])

  useEffect(() => {
    startSlideCycle()
  }, [startSlideCycle])

  useEffect(() => {
    localStorage.setItem('videoMutedBanner', true)
  }, [])

  const handleSlideEnd = useCallback(() => {
    cycleToNextMedia()
  }, [cycleToNextMedia])

  const handleNextStep = useCallback(() => {
    switch (currentStepRef.current) {
      case 0:
        currentStepRef.current = 1
        if (mediaList[currentMediaIndex]?.metadata?.trailer_url) {
          setShowVideo(true)
        }
        break
      case 1:
        setShowVideo(false)
        currentStepRef.current = 2
        break
      default:
        handleSlideEnd()
        break
    }
    setCurrentStep(currentStepRef.current)
  }, [handleSlideEnd])

  return (
    <div {...swipeHandlers}>
      <div className="relative w-full h-[40vh] md:h-[80vh] bg-black">
        <BannerContent
          mediaList={mediaList}
          showVideo={showVideo}
          progressSeconds={calculatedProgress}
          handleDotClick={handleDotClick}
          progressCalculation={(calculatedProgress / totalSlideDuration) * 100}
          currentMediaIndex={currentMediaIndex}
        />
        <Dots
          mediaList={mediaList}
          currentMediaIndex={currentMediaIndex}
          handleDotClick={handleDotClick}
          progress={(calculatedProgress / totalSlideDuration) * 100}
          progressSeconds={calculatedProgress}
        />
      </div>
    </div>
  )
}

function areEqual(prevProps, nextProps) {
  return (
    prevProps.showVideo === nextProps.showVideo &&
    prevProps.currentMediaIndex === nextProps.currentMediaIndex &&
    prevProps.mediaList === nextProps.mediaList &&
    prevProps.pathname === nextProps.pathname
  )
}

export default memo(BannerWithVideo, areEqual)
