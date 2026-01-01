'use client'

import React, {
  useRef,
  useEffect,
  useState,
  useImperativeHandle,
  forwardRef,
  useMemo,
} from 'react'
import { secondsToTimeCached } from '../utils/timeFormat'

/**
 * EditorVideoPlayer - High-performance video player with hybrid state management
 * Fixed version with properly working callbacks
 */
const EditorVideoPlayer = forwardRef(({
  // Required
  src,
  
  // Event callbacks
  onTimeUpdate = null,
  onPlayingChange = null,
  onReady = null,
  onEnded = null,
  onDurationChange = null,
  onProgress = null,
  onError = null,
  onSeeking = null,
  onSeeked = null,
  onVolumeChange = null,
  onPlaybackRateChange = null,
  onLoadStart = null,
  onLoadedMetadata = null,
  onCanPlay = null,
  onCanPlayThrough = null,
  onWaiting = null,
  onStalled = null,
  
  // Performance
  throttleMs = 0,
  
  // Video element props
  controls = true,
  autoPlay = false,
  muted = false,
  loop = false,
  volume = 1,
  playbackRate = 1,
  poster = null,
  preload = 'metadata',
  crossOrigin = null,
  playsInline = true,
  
  // Styling
  className = '',
  style = {},
  videoClassName = '',
  videoStyle = {},
  
  // Debug
  showDebugInfo = true,
  
  // Container control
  noContainer = false,
  
  // Advanced
  startTime = 0,
  preservesPitch = true,
  disablePictureInPicture = false,
  disableRemotePlayback = false,
  
}, ref) => {
  // Core refs
  const videoRef = useRef(null)
  const rafRef = useRef(null)
  const lastTimeRef = useRef(0)
  const callbacksRef = useRef({})
  const isMountedRef = useRef(true)
  const hasStartedRef = useRef(false)
  
  // State for UI (minimal re-renders)
  const [state, setState] = useState({
    currentTime: 0,
    duration: 0,
    buffered: 0,
    isPlaying: false,
    isWaiting: false,
    isEnded: false,
    isSeeking: false,
    volume: volume,
    playbackRate: playbackRate,
    error: null
  })
  
  // Update callbacks ref WITHOUT causing re-renders
  useEffect(() => {
    callbacksRef.current = {
      onTimeUpdate,
      onPlayingChange,
      onReady,
      onEnded,
      onDurationChange,
      onProgress,
      onError,
      onSeeking,
      onSeeked,
      onVolumeChange,
      onPlaybackRateChange,
      onLoadStart,
      onLoadedMetadata,
      onCanPlay,
      onCanPlayThrough,
      onWaiting,
      onStalled
    }
  }) // No dependency array - run on every render to keep fresh
  
  // Expose comprehensive imperative API
  useImperativeHandle(ref, () => ({
    // Playback control
    play: async () => {
      const video = videoRef.current
      if (video && video.paused) {
        try {
          await video.play()
          return true
        } catch (error) {
          console.error('Failed to play:', error)
          return false
        }
      }
      return false
    },
    
    pause: () => {
      const video = videoRef.current
      if (video && !video.paused) {
        video.pause()
        return true
      }
      return false
    },
    
    togglePlayPause: async () => {
      const video = videoRef.current
      if (video) {
        try {
          if (video.paused) {
            await video.play()
          } else {
            video.pause()
          }
          return true
        } catch (error) {
          console.error('Toggle play/pause failed:', error)
          return false
        }
      }
      return false
    },
    
    stop: () => {
      const video = videoRef.current
      if (video) {
        video.pause()
        video.currentTime = 0
        return true
      }
      return false
    },
    
    // Seeking
    seek: (time) => {
      const video = videoRef.current
      if (video && !isNaN(time) && isFinite(time)) {
        const clampedTime = Math.max(0, Math.min(time, video.duration || Infinity))
        video.currentTime = clampedTime
        
        // Immediately update state and fire callback
        setState(prev => ({ ...prev, currentTime: clampedTime }))
        if (callbacksRef.current.onTimeUpdate) {
          callbacksRef.current.onTimeUpdate(clampedTime)
        }
        
        return clampedTime
      }
      return null
    },
    
    seekRelative: (delta) => {
      const video = videoRef.current
      if (video && !isNaN(delta)) {
        const newTime = Math.max(0, Math.min(
          video.currentTime + delta,
          video.duration || Infinity
        ))
        video.currentTime = newTime
        
        // Immediately update state and fire callback
        setState(prev => ({ ...prev, currentTime: newTime }))
        if (callbacksRef.current.onTimeUpdate) {
          callbacksRef.current.onTimeUpdate(newTime)
        }
        
        return newTime
      }
      return null
    },
    
    seekToPercent: (percent) => {
      const video = videoRef.current
      if (video && video.duration && !isNaN(percent)) {
        const time = (percent / 100) * video.duration
        const clampedTime = Math.max(0, Math.min(time, video.duration))
        video.currentTime = clampedTime
        
        // Immediately update state and fire callback
        setState(prev => ({ ...prev, currentTime: clampedTime }))
        if (callbacksRef.current.onTimeUpdate) {
          callbacksRef.current.onTimeUpdate(clampedTime)
        }
        
        return clampedTime
      }
      return null
    },
    
    // Frame control
    nextFrame: () => {
      const video = videoRef.current
      if (video && video.paused) {
        const newTime = video.currentTime + (1 / 30)
        video.currentTime = newTime
        
        // Update state and fire callback
        setState(prev => ({ ...prev, currentTime: newTime }))
        if (callbacksRef.current.onTimeUpdate) {
          callbacksRef.current.onTimeUpdate(newTime)
        }
        
        return newTime
      }
      return null
    },
    
    previousFrame: () => {
      const video = videoRef.current
      if (video && video.paused) {
        const newTime = Math.max(0, video.currentTime - (1 / 30))
        video.currentTime = newTime
        
        // Update state and fire callback
        setState(prev => ({ ...prev, currentTime: newTime }))
        if (callbacksRef.current.onTimeUpdate) {
          callbacksRef.current.onTimeUpdate(newTime)
        }
        
        return newTime
      }
      return null
    },
    
    // State getters (no re-render)
    getCurrentTime: () => videoRef.current?.currentTime || 0,
    getDuration: () => videoRef.current?.duration || 0,
    getIsPlaying: () => !videoRef.current?.paused,
    getIsEnded: () => videoRef.current?.ended || false,
    getVolume: () => videoRef.current?.volume || 0,
    getIsMuted: () => videoRef.current?.muted || false,
    getPlaybackRate: () => videoRef.current?.playbackRate || 1,
    getBufferedPercent: () => {
      const video = videoRef.current
      if (video && video.buffered.length > 0 && video.duration) {
        return (video.buffered.end(video.buffered.length - 1) / video.duration) * 100
      }
      return 0
    },
    getReadyState: () => videoRef.current?.readyState || 0,
    getNetworkState: () => videoRef.current?.networkState || 0,
    
    // State setters
    setVolume: (vol) => {
      const video = videoRef.current
      if (video && !isNaN(vol)) {
        video.volume = Math.max(0, Math.min(1, vol))
        return video.volume
      }
      return null
    },
    
    setMuted: (muted) => {
      const video = videoRef.current
      if (video) {
        video.muted = Boolean(muted)
        return video.muted
      }
      return null
    },
    
    toggleMute: () => {
      const video = videoRef.current
      if (video) {
        video.muted = !video.muted
        return video.muted
      }
      return null
    },
    
    setPlaybackRate: (rate) => {
      const video = videoRef.current
      if (video && !isNaN(rate)) {
        video.playbackRate = Math.max(0.25, Math.min(4, rate))
        return video.playbackRate
      }
      return null
    },
    
    setLoop: (shouldLoop) => {
      const video = videoRef.current
      if (video) {
        video.loop = Boolean(shouldLoop)
        return video.loop
      }
      return null
    },
    
    // Picture-in-Picture
    requestPictureInPicture: async () => {
      const video = videoRef.current
      if (video && document.pictureInPictureEnabled) {
        try {
          await video.requestPictureInPicture()
          return true
        } catch (error) {
          console.error('PiP failed:', error)
          return false
        }
      }
      return false
    },
    
    exitPictureInPicture: async () => {
      if (document.pictureInPictureElement) {
        try {
          await document.exitPictureInPicture()
          return true
        } catch (error) {
          console.error('Exit PiP failed:', error)
          return false
        }
      }
      return false
    },
    
    // Fullscreen
    requestFullscreen: async () => {
      const video = videoRef.current
      if (video) {
        try {
          if (video.requestFullscreen) {
            await video.requestFullscreen()
          } else if (video.webkitRequestFullscreen) {
            await video.webkitRequestFullscreen()
          } else if (video.mozRequestFullScreen) {
            await video.mozRequestFullScreen()
          } else if (video.msRequestFullscreen) {
            await video.msRequestFullscreen()
          }
          return true
        } catch (error) {
          console.error('Fullscreen failed:', error)
          return false
        }
      }
      return false
    },
    
    // Utility
    getVideoElement: () => videoRef.current,
    
    getState: () => ({ ...state }),
    
    screenshot: () => {
      const video = videoRef.current
      if (video && video.videoWidth && video.videoHeight) {
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const ctx = canvas.getContext('2d')
        ctx.drawImage(video, 0, 0)
        return canvas.toDataURL('image/png')
      }
      return null
    },
    
    // Media Session API (if supported)
    setMediaSessionMetadata: (metadata) => {
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata(metadata)
        return true
      }
      return false
    }
  }), [state])
  
  // Initialize player and bind all event listeners
  useEffect(() => {
    const video = videoRef.current
    if (!video) {
      console.warn('EditorVideoPlayer: video ref is null')
      return
    }
    
    console.log('EditorVideoPlayer: Initializing with src:', src)
    
    // Apply initial settings
    video.volume = volume
    video.playbackRate = playbackRate
    video.muted = muted
    video.loop = loop
    if (preservesPitch !== undefined && 'preservesPitch' in video) {
      video.preservesPitch = preservesPitch
    }
    if (disablePictureInPicture) {
      video.disablePictureInPicture = true
    }
    if (disableRemotePlayback && 'disableRemotePlayback' in video) {
      video.disableRemotePlayback = true
    }

    // Define tick function INSIDE useEffect (like TestPlayer does)
    // This gives it direct access to video element and callbacks
    function tick() {
      const v = video
      if (!v) return
      
      const newTime = v.currentTime
      
      // Apply throttling if needed
      const threshold = throttleMs > 0 ? throttleMs / 1000 : 0.008 // Default 8ms like TestPlayer
      
      if (Math.abs(newTime - lastTimeRef.current) > threshold) {
        lastTimeRef.current = newTime
        
        // Update state
        setState(prev => ({ ...prev, currentTime: newTime }))
        
        // Fire callback
        if (callbacksRef.current.onTimeUpdate) {
          try {
            callbacksRef.current.onTimeUpdate(newTime)
          } catch (error) {
            console.error('Error in onTimeUpdate callback:', error)
          }
        }
      }
      
      rafRef.current = requestAnimationFrame(tick)
    }
    
    // Event handlers
    const handlePlay = () => {
      console.log('EditorVideoPlayer: Play event')
      setState(prev => ({ ...prev, isPlaying: true, isEnded: false }))
      
      // Fire callback
      if (callbacksRef.current.onPlayingChange) {
        callbacksRef.current.onPlayingChange(true)
      }
      
      // Start RAF loop
      if (!rafRef.current) {
        lastTimeRef.current = video.currentTime
        rafRef.current = requestAnimationFrame(tick)
      }
    }
    
    const handlePause = () => {
      console.log('EditorVideoPlayer: Pause event')
      setState(prev => ({ ...prev, isPlaying: false }))
      
      // Fire callback
      if (callbacksRef.current.onPlayingChange) {
        callbacksRef.current.onPlayingChange(false)
      }
      
      // Stop RAF loop
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
    
    const handleEnded = () => {
      console.log('EditorVideoPlayer: Ended event')
      setState(prev => ({ ...prev, isPlaying: false, isEnded: true }))
      
      // Fire callbacks
      if (callbacksRef.current.onPlayingChange) {
        callbacksRef.current.onPlayingChange(false)
      }
      if (callbacksRef.current.onEnded) {
        callbacksRef.current.onEnded()
      }
      
      // Stop RAF loop
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
    
    const handleTimeUpdate = () => {
      // Fallback time update for when RAF isn't running
      if (!rafRef.current) {
        const currentTime = video.currentTime
        setState(prev => ({ ...prev, currentTime }))
        
        if (callbacksRef.current.onTimeUpdate) {
          callbacksRef.current.onTimeUpdate(currentTime)
        }
      }
    }
    
    const handleDurationChange = () => {
      const duration = video.duration
      console.log('EditorVideoPlayer: Duration changed to', duration)
      setState(prev => ({ ...prev, duration }))
      
      if (callbacksRef.current.onDurationChange) {
        callbacksRef.current.onDurationChange(duration)
      }
    }
    
    const handleProgress = () => {
      if (video.buffered.length > 0 && video.duration) {
        const buffered = video.buffered.end(video.buffered.length - 1)
        const bufferedPercent = (buffered / video.duration) * 100
        setState(prev => ({ ...prev, buffered: bufferedPercent }))
        
        if (callbacksRef.current.onProgress) {
          callbacksRef.current.onProgress({ buffered, bufferedPercent })
        }
      }
    }
    
    const handleError = (e) => {
      const error = video.error
      console.error('EditorVideoPlayer: Video error', error)
      setState(prev => ({ ...prev, error }))
      
      if (callbacksRef.current.onError) {
        callbacksRef.current.onError(error)
      }
    }
    
    const handleSeeking = () => {
      setState(prev => ({ ...prev, isSeeking: true }))
      
      if (callbacksRef.current.onSeeking) {
        callbacksRef.current.onSeeking(video.currentTime)
      }
    }
    
    const handleSeeked = () => {
      const currentTime = video.currentTime
      setState(prev => ({ 
        ...prev, 
        isSeeking: false,
        currentTime 
      }))
      
      if (callbacksRef.current.onSeeked) {
        callbacksRef.current.onSeeked(currentTime)
      }
      if (callbacksRef.current.onTimeUpdate) {
        callbacksRef.current.onTimeUpdate(currentTime)
      }
    }
    
    const handleVolumeChange = () => {
      setState(prev => ({ 
        ...prev, 
        volume: video.volume 
      }))
      
      if (callbacksRef.current.onVolumeChange) {
        callbacksRef.current.onVolumeChange(video.volume, video.muted)
      }
    }
    
    const handleRateChange = () => {
      setState(prev => ({ 
        ...prev, 
        playbackRate: video.playbackRate 
      }))
      
      if (callbacksRef.current.onPlaybackRateChange) {
        callbacksRef.current.onPlaybackRateChange(video.playbackRate)
      }
    }
    
    const handleWaiting = () => {
      setState(prev => ({ ...prev, isWaiting: true }))
      
      if (callbacksRef.current.onWaiting) {
        callbacksRef.current.onWaiting()
      }
    }
    
    const handleCanPlay = () => {
      setState(prev => ({ ...prev, isWaiting: false }))
      
      if (callbacksRef.current.onCanPlay) {
        callbacksRef.current.onCanPlay()
      }
    }
    
    const handleLoadStart = () => {
      console.log('EditorVideoPlayer: Load start')
      
      if (callbacksRef.current.onLoadStart) {
        callbacksRef.current.onLoadStart()
      }
    }
    
    const handleLoadedMetadata = () => {
      console.log('EditorVideoPlayer: Loaded metadata, duration:', video.duration)
      
      // Set initial time if specified and not already set
      if (startTime && !hasStartedRef.current) {
        console.log('EditorVideoPlayer: Setting start time to', startTime)
        video.currentTime = startTime
        hasStartedRef.current = true
      }
      
      // Initialize state
      setState(prev => ({
        ...prev,
        currentTime: video.currentTime,
        duration: video.duration || 0
      }))
      
      // Fire initial time update
      if (callbacksRef.current.onTimeUpdate) {
        callbacksRef.current.onTimeUpdate(video.currentTime)
      }
      
      if (callbacksRef.current.onLoadedMetadata) {
        callbacksRef.current.onLoadedMetadata({
          duration: video.duration,
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight
        })
      }
      
      // Notify ready with control API
      if (callbacksRef.current.onReady) {
        console.log('EditorVideoPlayer: Firing onReady callback')
        callbacksRef.current.onReady({
          play: () => video.play(),
          pause: () => video.pause(),
          seek: (time) => { video.currentTime = time },
          getCurrentTime: () => video.currentTime,
          getDuration: () => video.duration,
          getIsPlaying: () => !video.paused
        })
      }
    }
    
    const handleCanPlayThrough = () => {
      if (callbacksRef.current.onCanPlayThrough) {
        callbacksRef.current.onCanPlayThrough()
      }
    }
    
    const handleStalled = () => {
      if (callbacksRef.current.onStalled) {
        callbacksRef.current.onStalled()
      }
    }
    
    // Bind all event listeners
    const events = {
      play: handlePlay,
      pause: handlePause,
      ended: handleEnded,
      timeupdate: handleTimeUpdate,
      durationchange: handleDurationChange,
      progress: handleProgress,
      error: handleError,
      seeking: handleSeeking,
      seeked: handleSeeked,
      volumechange: handleVolumeChange,
      ratechange: handleRateChange,
      waiting: handleWaiting,
      canplay: handleCanPlay,
      loadstart: handleLoadStart,
      loadedmetadata: handleLoadedMetadata,
      canplaythrough: handleCanPlayThrough,
      stalled: handleStalled
    }
    
    Object.entries(events).forEach(([event, handler]) => {
      video.addEventListener(event, handler)
    })
    
    // Initialize state from video element
    setState(prev => ({
      ...prev,
      isPlaying: !video.paused,
      currentTime: video.currentTime || 0,
      duration: video.duration || 0,
      volume: video.volume,
      playbackRate: video.playbackRate
    }))
    
    // Cleanup
    return () => {
      console.log('EditorVideoPlayer: Cleaning up')
      isMountedRef.current = false
      
      Object.entries(events).forEach(([event, handler]) => {
        video.removeEventListener(event, handler)
      })
      
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [src]) // Only depend on src
  
  // Reset hasStartedRef when src changes
  useEffect(() => {
    hasStartedRef.current = false
  }, [src])
  
  // Memoized debug info
  const debugInfo = useMemo(() => {
    if (!showDebugInfo) return null
    
    return (
      <div className="absolute top-2 left-2 bg-black bg-opacity-75 text-white text-xs p-2 rounded font-mono z-10">
        <div>videoRef Time: {secondsToTimeCached(videoRef.current?.currentTime)} / {secondsToTimeCached(videoRef.current?.duration)}</div>
        <div>State Time: {secondsToTimeCached(state.currentTime)} / {secondsToTimeCached(state.duration)}</div>
        <div>State: {state.isPlaying ? 'Playing' : state.isEnded ? 'Ended' : 'Paused'}</div>
        <div>Buffer: {state.buffered.toFixed(1)}%</div>
        <div>Rate: {state.playbackRate}x</div>
        <div>Volume: {(state.volume * 100).toFixed(0)}%</div>
        <div>RAF Throttle: {throttleMs}ms</div>
        {state.isSeeking && <div className="text-yellow-400">Seeking...</div>}
        {state.isWaiting && <div className="text-orange-400">Buffering...</div>}
        {state.error && <div className="text-red-400">Error: {state.error.message}</div>}
      </div>
    )
  }, [showDebugInfo, state, throttleMs])

  // const videoElement = (
  //   <video
  //     ref={videoRef}
  //     src={src}
  //     poster={poster}
  //     controls={controls}
  //     autoPlay={autoPlay}
  //     playsInline={playsInline}
  //     preload={preload}
  //     crossOrigin={crossOrigin}
  //     className={videoClassName || "w-full h-auto"}
  //     style={videoStyle}
  //   />
  // )

  if (noContainer) {
    return (
      <>
        <video
          ref={videoRef}
          src={src}
          poster={poster}
          controls={controls}
          autoPlay={autoPlay}
          playsInline={playsInline}
          preload={preload}
          crossOrigin={crossOrigin}
          className={videoClassName || "w-full h-auto"}
          style={videoStyle}
        />
        {debugInfo}
      </>
    )
  }
  
  return (
    <div 
      className={`relative ${className}`}
      style={style}
    >
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        controls={controls}
        autoPlay={autoPlay}
        playsInline={playsInline}
        preload={preload}
        crossOrigin={crossOrigin}
        className={videoClassName || "w-full h-auto"}
        style={videoStyle}
      />
      {debugInfo}
    </div>
  )
})

EditorVideoPlayer.displayName = 'EditorVideoPlayer'

export default EditorVideoPlayer