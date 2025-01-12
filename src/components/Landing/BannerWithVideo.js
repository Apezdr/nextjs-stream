'use client'

import { useState, useEffect, useCallback, useMemo, memo, Suspense } from 'react'
import { useSwipeable } from 'react-swipeable'
import { useTimer } from 'react-timer-hook'
import { lazy } from 'react'

// Lazy load components
const Dots = lazy(() => import('./Dots'))
const Loading = lazy(() => import('@src/app/loading'))
const BannerContent = lazy(() => import('./BannerContent'))

// Define steps for clarity
const STEP = {
  IMAGE: 0,
  VIDEO: 1,
  AFTER_VIDEO: 2,
}

// Duration constants (in seconds)
const BANNER_DISPLAY_BEFORE_VIDEO = 5
const VIDEO_DURATION = 30
const BANNER_DISPLAY_AFTER_VIDEO = 10
const TOTAL_SLIDE_DURATION =
  BANNER_DISPLAY_BEFORE_VIDEO + VIDEO_DURATION + BANNER_DISPLAY_AFTER_VIDEO

const BannerWithVideo = ({ mediaList }) => {
  // State variables
  const [currentMediaIndex, setCurrentMediaIndex] = useState(0)
  const [currentStep, setCurrentStep] = useState(STEP.IMAGE)
  const [showVideo, setShowVideo] = useState(false)
  const [isImageReady, setIsImageReady] = useState(false)
  const [isVideoReady, setIsVideoReady] = useState(false)

  // Timer for managing slide transitions
  const {
    seconds,
    restart: restartTimer,
    pause: pauseTimer,
    resume: resumeTimer,
  } = useTimer({
    expiryTimestamp: new Date(),
    onExpire: () => handleNextStep(),
    autoStart: false,
  })

  // Calculate progress for progress bar
  const calculatedProgress = useMemo(() => {
    let progressSeconds = 0

    switch (currentStep) {
      case STEP.IMAGE:
        progressSeconds = isImageReady ? BANNER_DISPLAY_BEFORE_VIDEO - seconds : 0
        break
      case STEP.VIDEO:
        progressSeconds = isVideoReady
          ? BANNER_DISPLAY_BEFORE_VIDEO + (VIDEO_DURATION - seconds)
          : BANNER_DISPLAY_BEFORE_VIDEO
        break
      case STEP.AFTER_VIDEO:
        progressSeconds =
          BANNER_DISPLAY_BEFORE_VIDEO + VIDEO_DURATION + (BANNER_DISPLAY_AFTER_VIDEO - seconds)
        break
      default:
        progressSeconds = 0
    }

    progressSeconds = Math.max(progressSeconds, 0)

    return TOTAL_SLIDE_DURATION - Math.ceil(Math.min(progressSeconds, TOTAL_SLIDE_DURATION))
  }, [seconds, currentStep, isImageReady, isVideoReady])

  // Helper function to get duration for the current step
  const getDurationForStep = useCallback((step) => {
    switch (step) {
      case STEP.IMAGE:
        return BANNER_DISPLAY_BEFORE_VIDEO
      case STEP.VIDEO:
        return VIDEO_DURATION
      case STEP.AFTER_VIDEO:
        return BANNER_DISPLAY_AFTER_VIDEO
      default:
        return 0
    }
  }, [])

  // Helper function to restart the timer for the current step
  const restartTimerForStep = useCallback(
    (step) => {
      const duration = getDurationForStep(step)
      const time = new Date()
      time.setSeconds(time.getSeconds() + duration)
      restartTimer(time)
    },
    [restartTimer, getDurationForStep]
  )

  // Restart the timer when currentStep changes
  useEffect(() => {
    restartTimerForStep(currentStep)
  }, [currentStep, restartTimerForStep])

  // Pause or resume the timer based on readiness of image/video
  useEffect(() => {
    if (
      (currentStep === STEP.IMAGE && !isImageReady) ||
      (currentStep === STEP.VIDEO && !isVideoReady)
    ) {
      pauseTimer()
    } else {
      resumeTimer()
    }
  }, [currentStep, isImageReady, isVideoReady, pauseTimer, resumeTimer])

  // Start the slide cycle from the beginning
  const startSlideCycle = useCallback(() => {
    setCurrentStep(STEP.IMAGE)
    setShowVideo(false)
    setIsImageReady(false)
    setIsVideoReady(false)
  }, [])

  // Move to the next media item
  const cycleToNextMedia = useCallback(() => {
    setCurrentMediaIndex((prevIndex) => (prevIndex + 1) % mediaList.length)
    startSlideCycle()
  }, [mediaList.length, startSlideCycle])

  // Handle dot click to select a specific media item
  const handleDotClick = useCallback(
    (index) => {
      if (index === currentMediaIndex) {
        setCurrentStep(STEP.IMAGE)
        setShowVideo(false)
        setIsVideoReady(false)
        restartTimerForStep(STEP.IMAGE)
      } else {
        setCurrentMediaIndex(index)
        restartTimerForStep(currentStep)
        startSlideCycle()
      }
    },
    [currentMediaIndex, restartTimerForStep, currentStep, startSlideCycle]
  )

  // Handle swipe gestures to change media items
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

  // Configure swipe handlers
  const swipeHandlers = useSwipeable({
    onSwipedLeft: () => handleSwipe('LEFT'),
    onSwipedRight: () => handleSwipe('RIGHT'),
    preventDefaultTouchmoveEvent: true,
    trackMouse: true,
    delta: { left: 20, right: 20 },
    swipeDuration: 250,
  })

  // Pause or resume timer when entering or exiting fullscreen mode
  const handleFullscreenChange = useCallback(() => {
    const isFullscreen = !!document.fullscreenElement
    isFullscreen ? pauseTimer() : resumeTimer()
  }, [pauseTimer, resumeTimer])

  useEffect(() => {
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }
  }, [handleFullscreenChange])

  // Pause or resume timer based on page visibility
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        pauseTimer()
      } else {
        resumeTimer()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [pauseTimer, resumeTimer])

  // Start the slide cycle when the component mounts
  useEffect(() => {
    startSlideCycle()
  }, [startSlideCycle])

  // Mute video by default
  useEffect(() => {
    localStorage.setItem('videoMutedBanner', true)
  }, [])

  // Handle when the slide ends and move to the next media item
  const handleSlideEnd = useCallback(() => {
    cycleToNextMedia()
  }, [cycleToNextMedia])

  // Handle when the video is ready to play
  const handleVideoReady = useCallback(() => {
    setIsVideoReady(true)
  }, [])

  // Handle when the image has loaded
  const handleImageLoad = useCallback(() => {
    setIsImageReady(true)
  }, [])

  // Handle the transition to the next step
  const handleNextStep = useCallback(() => {
    switch (currentStep) {
      case STEP.IMAGE:
        if (mediaList[currentMediaIndex]?.metadata?.trailer_url) {
          setCurrentStep(STEP.VIDEO)
          setIsVideoReady(false)
          setShowVideo(true)
        } else {
          setCurrentStep(STEP.AFTER_VIDEO)
          restartTimerForStep(STEP.AFTER_VIDEO)
        }
        break
      case STEP.VIDEO:
        setCurrentStep(STEP.AFTER_VIDEO)
        restartTimerForStep(STEP.AFTER_VIDEO) // Restart the timer for AFTER_VIDEO immediately
        setShowVideo(false)
        break
      case STEP.AFTER_VIDEO:
        handleSlideEnd() // Move to the next slide after AFTER_VIDEO duration
        break
      default:
        handleSlideEnd()
        break
    }
  }, [currentStep, currentMediaIndex, handleSlideEnd, mediaList, restartTimerForStep])

  return (
    <div {...swipeHandlers} className='mt-16 md:mt-0'>
      <div className="relative w-full h-auto bg-black aspect-[16/6.6]">
        <Suspense
          fallback={
            <div className="w-full h-full bg-black flex items-center justify-center text-white">
              <Loading fullscreenClasses={false} />
            </div>
          }
        >
          <BannerContent
            mediaList={mediaList}
            showVideo={showVideo}
            progressSeconds={calculatedProgress}
            handleDotClick={handleDotClick}
            progressCalculation={(calculatedProgress / TOTAL_SLIDE_DURATION) * 100}
            currentMediaIndex={currentMediaIndex}
            onVideoReady={handleVideoReady}
            onImageLoad={handleImageLoad}
          />
        </Suspense>
        <Suspense
          fallback={
            <div className="absolute bottom-4 right-4 flex gap-1">
              {[...Array(1)].map((_, index) => (
                <div key={index} className="w-2 h-2 rounded-full bg-gray-400"></div>
              ))}
            </div>
          }
        >
          <Dots
            mediaList={mediaList}
            currentMediaIndex={currentMediaIndex}
            handleDotClick={handleDotClick}
            progress={(calculatedProgress / TOTAL_SLIDE_DURATION) * 100}
            progressSeconds={calculatedProgress}
          />
        </Suspense>
      </div>
    </div>
  )
}

export default memo(BannerWithVideo)
