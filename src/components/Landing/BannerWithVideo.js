'use client'
import { useState, useEffect, memo, useCallback, useRef } from 'react'
import BannerContent from './BannerContent'
import { usePathname } from 'next/navigation'

const BannerWithVideo = ({ mediaList }) => {
  const pathname = usePathname()
  const [currentMediaIndex, setCurrentMediaIndex] = useState(0)
  const [showVideo, setShowVideo] = useState(false)
  const [videoEnded, setVideoEnded] = useState(false)
  const [resetProgress, setResetProgress] = useState(false)
  const progressRef = useRef(0)
  const progressUpdateRef = useRef(null)
  const intervalRef = useRef(null)

  const progressDuration = 43000 // 43 seconds for full progress

  useEffect(() => {
    let timer
    if (!showVideo) {
      timer = setTimeout(() => {
        setShowVideo(true)
      }, 3000) // Show the video after 3 seconds
    }

    return () => clearTimeout(timer)
  }, [currentMediaIndex, showVideo])

  useEffect(() => {
    if (videoEnded) {
      const cycleTimer = setTimeout(() => {
        setCurrentMediaIndex((prevIndex) => (prevIndex + 1) % mediaList.length)
        setShowVideo(false)
        setVideoEnded(false)
      }, 10000) // Wait 10 seconds before cycling to the next media

      return () => clearTimeout(cycleTimer)
    }
  }, [videoEnded, mediaList.length])

  useEffect(() => {
    let start
    let animationFrameId

    const updateProgress = (timestamp) => {
      if (!start) start = timestamp
      const elapsed = timestamp - start

      progressRef.current = (elapsed / progressDuration) * 100

      if (elapsed < progressDuration) {
        // Continue the loop for 10 seconds
        animationFrameId = requestAnimationFrame(updateProgress)
      } else {
        cancelAnimationFrame(animationFrameId)
      }
    }

    animationFrameId = requestAnimationFrame(updateProgress)

    return () => cancelAnimationFrame(animationFrameId)
  }, [currentMediaIndex, resetProgress])

  const startInterval = () => {
    intervalRef.current = setInterval(() => {
      if (progressUpdateRef.current) {
        progressUpdateRef.current(progressRef.current)
      }
    }, 100)
  }

  useEffect(() => {
    startInterval()
    return () => clearInterval(intervalRef.current)
  }, [progressUpdateRef])

  const handleVideoEnd = () => {
    setShowVideo(false)
    setVideoEnded(true)
  }

  const handleDotClick = useCallback((index) => {
    clearInterval(intervalRef.current) // Clear the interval
    progressRef.current = 0
    if (progressUpdateRef.current) {
      progressUpdateRef.current(0)
    }
    setCurrentMediaIndex(index)
    setShowVideo(false)
    setVideoEnded(false)
    setResetProgress((prev) => !prev) // Toggle resetProgress to force useEffect re-run
    setTimeout(startInterval, 0) // Restart the interval after state updates
  }, [])

  useEffect(() => {
    // Set to muted initially for banner video so it will autoplay
    localStorage.setItem('videoMutedBanner', true)
  }, [])

  const currentMedia = mediaList[currentMediaIndex]

  return (
    pathname === '/list' && (
      <BannerContent
        currentMedia={currentMedia}
        showVideo={showVideo}
        videoEnded={videoEnded}
        handleVideoEnd={handleVideoEnd}
        handleDotClick={handleDotClick}
        progressRef={progressRef}
        progressUpdateRef={progressUpdateRef}
        mediaList={mediaList}
        currentMediaIndex={currentMediaIndex}
        setProgressUpdateRef={(ref) => (progressUpdateRef.current = ref)}
      />
    )
  )
}

export default memo(BannerWithVideo)
