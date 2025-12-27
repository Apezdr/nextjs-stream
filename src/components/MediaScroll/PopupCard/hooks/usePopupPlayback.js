import { useState, useReducer, useEffect, useCallback } from 'react'

/**
 * Custom hook to manage video playback state and image transitions in PopupCard
 * 
 * This hook encapsulates the complex state machine for:
 * - Video ready/playing states
 * - Image loading delays
 * - Backdrop show/hide timing
 * - Video end handling
 * 
 * @param {boolean} hasVideo - Whether video content is available
 * @param {string} videoURL - The video URL
 * @param {Object} data - The fetched media data
 * @returns {Object} Playback state and handlers
 */
export const usePopupPlayback = (hasVideo, videoURL, data) => {
  const [imageLoaded, setImageLoaded] = useState(false)
  
  // Reducer to manage complex video playback state
  const [state, dispatch] = useReducer(
    (state, action) => {
      switch (action.type) {
        case 'RESET_FOR_NEW_VIDEO':
          return {
            ...state,
            videoReady: false,
            afterVideo: false,
            hideVideo: action.hasVideo,
            isThumbnailLoaded: false,
            showBackdrop: false,
            delayBackdropHide: false,
          }
        case 'SET_VIDEO_READY':
          return { ...state, videoReady: true }
        case 'SET_PLAYING_VIDEO':
          return { ...state, playingVideo: action.value }
        case 'SET_THUMBNAIL_LOADED':
          return { ...state, isThumbnailLoaded: true }
        case 'SET_SHOW_BACKDROP':
          return { ...state, showBackdrop: true }
        case 'SET_DELAY_BACKDROP_HIDE':
          return { ...state, delayBackdropHide: action.value }
        case 'VIDEO_ENDED':
          return {
            ...state,
            playingVideo: false,
            videoReady: false,
            hideVideo: true,
            afterVideo: true,
          }
        default:
          return state
      }
    },
    {
      videoReady: false,
      playingVideo: false,
      hideVideo: hasVideo,
      afterVideo: false,
      isThumbnailLoaded: false,
      showBackdrop: false,
      delayBackdropHide: false,
    }
  )

  // Derive shouldPlay from state instead of using an effect
  const shouldPlay = (!state.hideVideo || !state.afterVideo) && imageLoaded && state.videoReady

  // Reset states when video URL or data changes
  useEffect(() => {
    dispatch({ type: 'RESET_FOR_NEW_VIDEO', hasVideo })
  }, [videoURL, data?.thumbnail, hasVideo])

  // Show backdrop immediately - no delay needed with proper preloading
  useEffect(() => {
    dispatch({ type: 'SET_SHOW_BACKDROP' })
  }, [data?.thumbnail])

  // Delay backdrop hide when video starts playing
  useEffect(() => {
    if (shouldPlay && state.playingVideo) {
      dispatch({ type: 'SET_DELAY_BACKDROP_HIDE', value: true })
      const timer = setTimeout(() => {
        dispatch({ type: 'SET_DELAY_BACKDROP_HIDE', value: false })
      }, 800)
      return () => clearTimeout(timer)
    } else {
      dispatch({ type: 'SET_DELAY_BACKDROP_HIDE', value: false })
    }
  }, [shouldPlay, state.playingVideo])

  // 3.2-second delay after the image loads before allowing the video to start
  const handleImageLoad = useCallback(() => {
    const timeout = setTimeout(() => {
      setImageLoaded(true)
    }, 3200)
    return () => clearTimeout(timeout)
  }, [])

  return {
    state,
    dispatch,
    shouldPlay,
    handleImageLoad,
  }
}