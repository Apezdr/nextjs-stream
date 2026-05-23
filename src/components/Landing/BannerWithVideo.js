'use client'

import { useState, useEffect, useCallback, useReducer, memo, Suspense, useRef } from 'react'
import { useSwipeable } from 'react-swipeable'
import Dots from './Dots'
import Loading from '@src/app/loading'
import BannerContent from './BannerContent'
import BannerTrailerIndicator from './BannerTrailerIndicator'

const HERO_DWELL = 15000
const STILL_HANDOFF = 3000
const MUTE_KEY = 'videoMutedBanner'

const readPersistedMute = () => {
  if (typeof window === 'undefined') return true
  const session = sessionStorage.getItem(MUTE_KEY)
  if (session !== null) return session === 'true'
  // One-time migration: lift any legacy localStorage value into sessionStorage, then drop it.
  const legacy = localStorage.getItem(MUTE_KEY)
  if (legacy !== null) {
    localStorage.removeItem(MUTE_KEY)
    sessionStorage.setItem(MUTE_KEY, legacy)
    return legacy === 'true'
  }
  return true
}

// Index, dwell clock, and trailer time always change together (advance, jump, swipe), so they
// live in one reducer dispatched once per transition to avoid cascading setState calls.
const initialDwellState = { currentMediaIndex: 0, dwellElapsed: 0, trailerTime: { current: 0, duration: 0 } }

const dwellReducer = (state, action) => {
  switch (action.type) {
    case 'tick':
      return { ...state, dwellElapsed: action.elapsed }
    case 'advance':
      return {
        currentMediaIndex: action.nextIndex(state.currentMediaIndex),
        dwellElapsed: 0,
        trailerTime: { current: 0, duration: 0 },
      }
    case 'trailerTime':
      return { ...state, trailerTime: action.trailerTime }
    default:
      return state
  }
}

const BannerWithVideo = ({ mediaList }) => {
  const [dwellState, dispatchDwell] = useReducer(dwellReducer, initialDwellState)
  const { currentMediaIndex, dwellElapsed, trailerTime } = dwellState
  const [isMuted, setIsMuted] = useState(() => readPersistedMute())
  const [isPaused, setIsPaused] = useState(false)

  const dwellStartRef = useRef(0)
  const elapsedRef = useRef(0)
  const rafRef = useRef(null)
  const pausedRef = useRef(false)
  const tickRef = useRef(null)

  const currentMedia = mediaList[currentMediaIndex]
  const hasTrailer = Boolean(currentMedia?.metadata?.trailer_url)
  const showTrailer = hasTrailer && dwellElapsed >= STILL_HANDOFF

  // Keep tick fresh against mediaList length without re-creating the rAF loop. The tick runs
  // continuously; on each frame it either advances elapsed or, when HERO_DWELL is reached,
  // rolls the index and resets the dwell clock in a single batched render.
  useEffect(() => {
    tickRef.current = () => {
      const elapsed = performance.now() - dwellStartRef.current
      if (elapsed >= HERO_DWELL) {
        dwellStartRef.current = performance.now()
        elapsedRef.current = 0
        dispatchDwell({ type: 'advance', nextIndex: (i) => (i + 1) % mediaList.length })
      } else {
        elapsedRef.current = elapsed
        dispatchDwell({ type: 'tick', elapsed })
      }
      rafRef.current = requestAnimationFrame(tickRef.current)
    }
  }, [mediaList.length])

  // Kick off the dwell loop on mount; cancel on unmount.
  useEffect(() => {
    dwellStartRef.current = performance.now()
    if (tickRef.current) rafRef.current = requestAnimationFrame(tickRef.current)
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  // Pause/resume on tab visibility + fullscreen. Cancels rAF while paused; rebases clock on resume.
  useEffect(() => {
    const applyPaused = (paused) => {
      if (paused === pausedRef.current) return
      pausedRef.current = paused
      setIsPaused(paused)
      if (paused) {
        cancelAnimationFrame(rafRef.current)
      } else {
        dwellStartRef.current = performance.now() - elapsedRef.current
        if (tickRef.current) rafRef.current = requestAnimationFrame(tickRef.current)
      }
    }
    const onVis = () => applyPaused(document.visibilityState === 'hidden')
    const onFs = () => applyPaused(Boolean(document.fullscreenElement))
    document.addEventListener('visibilitychange', onVis)
    document.addEventListener('fullscreenchange', onFs)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      document.removeEventListener('fullscreenchange', onFs)
    }
  }, [])

  const jumpTo = useCallback((index) => {
    dwellStartRef.current = performance.now()
    elapsedRef.current = 0
    dispatchDwell({ type: 'advance', nextIndex: () => index })
  }, [])

  const handleDotClick = useCallback(
    (index) => {
      jumpTo(index)
    },
    [jumpTo]
  )

  const handleSwipe = useCallback(
    (direction) => {
      const len = mediaList.length
      dwellStartRef.current = performance.now()
      elapsedRef.current = 0
      dispatchDwell({
        type: 'advance',
        nextIndex: (prev) =>
          direction === 'LEFT' ? (prev + 1) % len : prev === 0 ? len - 1 : prev - 1,
      })
    },
    [mediaList.length]
  )

  const swipeHandlers = useSwipeable({
    onSwipedLeft: () => handleSwipe('LEFT'),
    onSwipedRight: () => handleSwipe('RIGHT'),
    preventDefaultTouchmoveEvent: true,
    trackMouse: true,
    delta: { left: 20, right: 20 },
    swipeDuration: 250,
  })

  const toggleMute = useCallback(() => {
    setIsMuted((m) => {
      const next = !m
      sessionStorage.setItem(MUTE_KEY, String(next))
      return next
    })
  }, [])

  const handleTrailerTime = useCallback((current, duration) => {
    dispatchDwell({ type: 'trailerTime', trailerTime: { current, duration } })
  }, [])

  const dotProgress = (dwellElapsed / HERO_DWELL) * 100

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
            currentMediaIndex={currentMediaIndex}
            showTrailer={showTrailer}
            muted={isMuted}
            paused={isPaused}
            onTrailerTime={handleTrailerTime}
          />
        </Suspense>
        {showTrailer ? (
          <BannerTrailerIndicator
            currentTime={trailerTime.current}
            duration={trailerTime.duration}
            isMuted={isMuted}
            onToggleMute={toggleMute}
          />
        ) : null}
        <Suspense
          fallback={
            <div className="absolute bottom-4 right-4 flex gap-1">
              {[...Array(mediaList?.length || 0)].map((_, index) => (
                <div key={index} className="w-2 h-2 rounded-full bg-gray-400"></div>
              ))}
            </div>
          }
        >
          <Dots
            mediaList={mediaList}
            currentMediaIndex={currentMediaIndex}
            handleDotClick={handleDotClick}
            progress={dotProgress}
            progressSeconds={Math.ceil((HERO_DWELL - dwellElapsed) / 1000)}
          />
        </Suspense>
      </div>
    </div>
  )
}

export default memo(BannerWithVideo)
