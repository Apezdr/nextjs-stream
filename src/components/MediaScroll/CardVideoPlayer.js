'use client'
import '@vidstack/react/player/styles/default/theme.css'
import './media-player.css'
import '@components/MediaPlayer/Layouts/menus.css'
import { Controls, MediaPlayer, MediaProvider } from '@vidstack/react'
import { memo, useRef, useState, useEffect, useCallback } from 'react'
import * as Buttons from '@components/MediaPlayer/buttons'

function CardVideoPlayer({
  media,
  videoURL = null,
  onVideoReady,
  onVideoEnd,
  height,
  width,
  shouldNotPlay = false,
}) {
  //const { trailer_url } = media
  const playerRef = useRef(null)
  const [isPlayerReady, setPlayerReady] = useState(false)

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
    if (isPlayerReady && document.visibilityState === 'visible' && player && player.state.paused) {
      player.play()
    }
  }, [isPlayerReady])

  //   useEffect(() => {
  //     setPlayerReady(false) // Reset player ready state when media changes
  //   }, [currentMediaIndex])

  useEffect(() => {
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [handleVisibilityChange])

  const handlePlaying = useCallback(() => {
    if (shouldNotPlay == false) {
      setPlayerReady(true)
      if (onVideoReady) {
        onVideoReady() // Notify parent that video is ready
      }
    }
  }, [onVideoReady])

  return (
    <MediaPlayer
      ref={playerRef}
      src={videoURL}
      height={height}
      width={width}
      autoPlay={shouldNotPlay == false ? true : false}
      controlsDelay={999999}
      streamType="on-demand"
      playsInline
      load="visible"
      aspectRatio="16/9"
      fullscreenOrientation="landscape"
      className="absolute inset-0 w-full h-full select-none pointer-events-none"
      muted={
        localStorage.getItem('videoMutedCard')
          ? localStorage.getItem('videoMutedCard') === 'true'
          : true
      }
      volume={localStorage.getItem('videoVolumeCard') || 1}
      onPause={() => {
        const player = playerRef?.current
        if (
          isPlayerReady &&
          player &&
          player.state.paused &&
          document.visibilityState === 'visible' &&
          shouldNotPlay == false
        ) {
          player.play()
        }
      }}
      onVolumeChange={handleVolumeChange}
      onEnded={onVideoEnd}
      onPlaying={handlePlaying}
      loop={false}
    >
      <MediaProvider />
      <Controls.Root className="absolute bottom-4 left-4 flex space-x-2 z-[5]">
        <Controls.Group className="flex w-full items-center px-2">
          <Buttons.Mute tooltipPlacement="top" toggleSliderOnUnmute={true} />
        </Controls.Group>
      </Controls.Root>
    </MediaPlayer>
  )
}

export default memo(CardVideoPlayer)
