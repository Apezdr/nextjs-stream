'use client'
import './media-player.css'
import '@components/MediaPlayer/Layouts/menus.css'
import { Controls, MediaPlayer, MediaProvider } from '@vidstack/react'
import { memo, useRef, useState, useEffect, useCallback, cache } from 'react'
import * as Buttons from '@components/MediaPlayer/buttons'
import { classNames } from '@src/utils'
import { GesturesNoFullscreen } from '@components/MediaPlayer/Layouts/video-layout'

function CardVideoPlayer({
  className,
  videoURL = null,
  onVideoReady,
  onVideoEnd,
  onPlaying,
  height,
  width,
  shouldPlay = false,
  muted = null,
}) {
  const playerRef = useRef(null)
  const [isPlayerReady, setPlayerReady] = useState(false)
  const [playerKey, setPlayerKey] = useState(0) // Added key to force re-render when needed

  const handleError = useCallback((event) => {
    const error = event.detail
    console.error('Video player error:', error)
    
    // Check for "416 Range Not Satisfiable" error
    // This can appear in different ways depending on the browser and network stack
    if (
      (error?.message && error.message.includes('Range Not Satisfiable')) ||
      (error?.code === 416) || 
      (error?.status === 416) ||
      (error?.toString?.() && error.toString().includes('416'))
    ) {
      console.log('Detected 416 Range Not Satisfiable error, restarting video player')
      // Increment the key to force a complete re-render of the MediaPlayer
      setPlayerKey(prevKey => prevKey + 1)
    }
  }, [])

  const handleVolumeChange = useCallback(() => {
    const player = playerRef?.current
    if (player) {
      localStorage.setItem('videoVolumeCard', player.volume)
      handleMuteChange(player)
    }
  }, [])

  const handleMuteChange = useCallback((player = playerRef?.current) => {
    if (player) {
      localStorage.setItem('videoMutedCard', player.muted)
    }
  }, [])

  const handleVisibilityChange = useCallback(() => {
    const player = playerRef?.current
    // If the tab becomes visible again AND we shouldPlay is true, attempt auto-play:
    if (
      isPlayerReady &&
      document.visibilityState === 'visible' &&
      player &&
      player.state.paused &&
      shouldPlay
    ) {
      player.play()
    }
  }, [isPlayerReady, shouldPlay])

  useEffect(() => {
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [handleVisibilityChange])

  const handlePlaying = useCallback(() => {
    if (onPlaying) onPlaying()
  }, [onPlaying])

  const handleCanPlay = useCallback(() => {
    const player = playerRef?.current
    setPlayerReady(true)
    if (onVideoReady) {
      onVideoReady(player) // Notify parent that video is ready
    }
  }, [onVideoReady])

  // Whenever parent changes shouldPlay -> false, ensure player is paused
  useEffect(() => {
    const player = playerRef.current
    if (!player) return

    if (shouldPlay) {
      // If we should be playing, start playback if ready
      if (isPlayerReady && player.state.paused) {
        player.play()
      }
    } else {
      // If we should NOT play, pause immediately
      if (!player.state.paused) {
        player.pause()
      }
    }
  }, [shouldPlay, isPlayerReady])

  return (
    <MediaPlayer
      key={playerKey} // Add key to force re-render when needed
      ref={playerRef}
      src={videoURL}
      height={height}
      width={width}
      autoPlay={false}
      controlsDelay={-1}
      streamType="on-demand"
      playsInline
      load="visible"
      aspectRatio="16/9"
      fullscreenOrientation="landscape"
      className={classNames(
        "z-[40]",
        "absolute inset-0 w-full h-full select-none pointer-events-none media-playing:opacity-100 media-paused:opacity-0",
        "opacity-0 transition-opacity duration-700",
        className,
        shouldPlay ? 'shouldPlay !opacity-100' : ''
      )}
      muted={
        muted ? muted : // if muted is not passed, check localStorage
        typeof localStorage !== 'undefined' && localStorage?.getItem('videoMutedCard')
          ? localStorage.getItem('videoMutedCard') === 'true'
          : true
      }
      volume={typeof localStorage !== 'undefined' ? parseFloat(localStorage?.getItem('videoVolumeCard')) || 1 : 1}
      onPause={() => {
        // Only auto-resume if we STILL shouldPlay:
        const player = playerRef?.current
        if (
          isPlayerReady &&
          player &&
          player.state.paused &&
          document.visibilityState === 'visible' &&
          shouldPlay && // check parent's "shouldPlay" again here
          player.state.fullscreen === false
        ) {
          player.play()
        }
      }}
      onVolumeChange={handleVolumeChange}
      onEnded={() => {
        const player = playerRef?.current
        // if (player) {
        //   // Pause just to be 100% sure we don't auto-resume
        //   player.pause()
        // }
        if (onVideoEnd) onVideoEnd(player)
      }}
      onCanPlay={handleCanPlay}
      onPlaying={handlePlaying}
      onError={handleError} // Add error event handler
      loop={false}
    >
      <MediaProvider />
      <GesturesNoFullscreen />
      <Controls.Root className="absolute bottom-4 left-4 flex space-x-2 z-[5]">
        <Controls.Group className="flex w-full items-center px-2">
          <Buttons.Mute tooltipPlacement="top" toggleSliderOnUnmute={true} />
        </Controls.Group>
      </Controls.Root>
    </MediaPlayer>
  )
}

export default cache(CardVideoPlayer)
