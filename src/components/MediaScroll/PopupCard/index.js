'use client'

import { useState, useRef, useCallback, useMemo, Suspense } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import { classNames, fetcher } from '@src/utils'
import { usePopupPlayback } from './hooks/usePopupPlayback'
import { useMediaAssets } from './hooks/useMediaAssets'
import { getApiEndpoint } from './utils/popupHelpers'
import MediaHero from './MediaHero'
import InfoSection from './InfoSection'
import CastSection from './CastSection'

// Extract static function outside component to save memory
const stopPropagation = (e) => e.stopPropagation()

/**
 * PopupCard Component - Refactored Orchestrator
 * 
 * This component coordinates the popup display for media items, delegating
 * specific responsibilities to specialized sub-components:
 * - MediaHero: Handles video/image display
 * - InfoSection: Handles text content and action buttons
 * - CastSection: Handles cast member display
 * 
 * State management and configuration logic are extracted into custom hooks.
 */
const PopupCard = (props) => {
  const {
    imageDimensions,
    imagePosition,
    title,
    showTitleFormatted,
    seasonNumber = null,
    episodeNumber = null,
    type,
    mediaId,
    showId,
    showTmdbId,
    link,
    handleCollapse,
    handlePortalMouseEnter,
    handlePortalMouseLeave,
    isTouchDevice,
    isAvailable,
    metadata,
    dateInfo,
  } = props

  // 1. Data Fetching - Build endpoint and fetch data
  const apiEndpoint = useMemo(
    () => getApiEndpoint({
      isAvailable,
      type,
      mediaId,
      seasonNumber,
      episodeNumber,
      metadata
    }),
    [isAvailable, type, mediaId, seasonNumber, episodeNumber, metadata]
  )

  const { data, isLoading } = useSWR(apiEndpoint, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
    dedupingInterval: 15000,
    errorRetryInterval: 2000,
    errorRetryCount: 20,
    keepPreviousData: true,  // Prevents flash of loading state during transitions
    compare: (a, b) => JSON.stringify(a) === JSON.stringify(b), // Stable comparison for object data
  })

  // 2. Derived Data
  const hasVideo = !!data?.clipVideoURL || !!data?.trailer_url
  const videoURL = data?.clipVideoURL || data?.trailer_url

  // 3. Custom Hooks for State Management
  const playback = usePopupPlayback(hasVideo, videoURL, data)
  const { shouldPlay, state, dispatch, handleImageLoad } = playback

  const { imageConfig, visibilityFlags } = useMediaAssets(data, props, {
    shouldPlay,
    isThumbnailLoaded: state.isThumbnailLoaded,
    showBackdrop: state.showBackdrop,
    delayBackdropHide: state.delayBackdropHide,
  })

  // 4. Navigation Logic
  const router = useRouter()
  const [isNavigating, setIsNavigating] = useState(false)
  const portalRef = useRef(null)

  const handleNavigationWithLoading = useCallback((e, href) => {
    e.preventDefault() // Stop default Link behavior
    setIsNavigating(true) // Show blur overlay
    
    // Navigate programmatically
    router.push(href)
    
    // Collapse popup after navigation starts
    setTimeout(() => {
      handleCollapse()
    }, 300) // Short delay for smooth transition
  }, [router, handleCollapse])

  // 5. Event Handlers
  const handlePortalKeyDown = useCallback(
    (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        handleCollapse()
      }
    },
    [handleCollapse]
  )

  const onVideoReady = useCallback(() => {
    const timeout = setTimeout(() => {
      dispatch({ type: 'SET_VIDEO_READY' })
    }, 200)
    return () => clearTimeout(timeout)
  }, [dispatch])

  // 6. Layout Calculations
  const calculatedWidth = useMemo(() => {
    // Always use the expandedWidth calculated by Card component (16:9 aspect ratio)
    return imagePosition.expandedWidth ? `!w-[${imagePosition.expandedWidth}px]` : `w-[300px]`
  }, [imagePosition.expandedWidth])

  return (
    <div
      className={classNames(
        'absolute z-10 pointer-events-none transition-all duration-300 ease-in-out',
        'min-w-52',
        calculatedWidth
      )}
      style={{
        top: imagePosition.top,
        left: imagePosition.left,
        height: imagePosition.height,
        opacity: 1,
      }}
      onClick={handleCollapse}
      onMouseEnter={handlePortalMouseEnter}
      onMouseLeave={handlePortalMouseLeave}
      onKeyDown={handlePortalKeyDown}
      aria-label="Close expanded view"
      aria-hidden="true"
    >
      <div
        className="bg-white rounded-lg shadow-xl overflow-hidden relative transition-transform duration-300 ease-in-out pointer-events-auto"
        style={{
          width: `${imagePosition.expandedWidth}px`,
          transform: 'scale(1)',
        }}
        onClick={stopPropagation}
        ref={portalRef}
        tabIndex={0}
      >
        {/* Loading Overlay - appears during navigation (z-[70]) */}
        <AnimatePresence>
          {isNavigating && (
            <motion.div
              key="loading-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="absolute inset-0 bg-white/60 backdrop-blur-sm z-[70] flex items-center justify-center rounded-lg"
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3, delay: 0.1, ease: "easeOut" }}
                className="flex flex-col items-center gap-3"
              >
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                <p className="text-sm text-gray-600 font-medium">Loading...</p>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Close Button - put it on top at z-[60] */}
        <button
          className="absolute top-2 right-2 text-gray-800 bg-white rounded-full px-2 py-1 hover:bg-gray-100 focus:outline-none z-[60]"
          onClick={handleCollapse}
          aria-label="Close"
        >
          &times;
        </button>

        {/* SECTION 1: Media Hero (Video/Images) */}
        <MediaHero
          title={title}
          imagePosition={imagePosition}
          imageConfig={imageConfig}
          visibilityFlags={visibilityFlags}
          playbackState={state}
          videoURL={videoURL}
          shouldPlay={shouldPlay}
          onVideoReady={onVideoReady}
          dispatch={dispatch}
          handleImageLoad={handleImageLoad}
          isLoading={isLoading}
        />

        {/* SECTION 2: Info (Title, Desc, Buttons) */}
        <InfoSection
          data={data}
          isLoading={isLoading}
          type={type}
          title={title}
          showTitleFormatted={showTitleFormatted}
          seasonNumber={seasonNumber}
          episodeNumber={episodeNumber}
          link={link}
          mediaId={mediaId}
          showId={showId}
          showTmdbId={showTmdbId}
          metadata={metadata}
          dateInfo={dateInfo}
          hasVideo={hasVideo}
          videoURL={videoURL}
          handleNavigationWithLoading={handleNavigationWithLoading}
        />

        {/* SECTION 3: Cast */}
        <Suspense><CastSection cast={data?.cast} /></Suspense>
      </div>
    </div>
  )
}

export default PopupCard