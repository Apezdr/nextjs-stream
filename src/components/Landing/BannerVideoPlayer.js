'use client'
import '@vidstack/react/player/styles/default/theme.css'
import './media-player.css'
import '@components/MediaPlayer/Layouts/menus.css'
import { Controls, MediaPlayer, MediaProvider } from '@vidstack/react'
import { memo, useEffect, useRef } from 'react'
import * as Buttons from '@components/MediaPlayer/buttons' // Import the buttons

function BannerVideoPlayer({ media, onVideoEnd }) {
  const { videoURL } = media
  const playerRef = useRef(null)

  useEffect(() => {
    const player = playerRef.current
    if (player) {
      const timer = setTimeout(() => {
        player.pause()
        onVideoEnd()
      }, 30000) // Stop video after 30 seconds

      return () => clearTimeout(timer)
    }
  }, [onVideoEnd])

  const handleVolumeChange = () => {
    const player = playerRef.current
    if (player) {
      localStorage.setItem('videoVolumeBanner', player.volume)
      handleMuteChange(player)
    }
  }

  const handleMuteChange = (player = playerRef.current) => {
    if (player) {
      localStorage.setItem('videoMutedBanner', player.muted)
    }
  }

  return (
    <MediaPlayer
      ref={playerRef}
      src={videoURL}
      autoPlay={true}
      controlsDelay={6000}
      streamType="on-demand"
      playsInline
      load="idle"
      aspectRatio="16/9"
      fullscreenOrientation="landscape"
      className="absolute inset-0 w-full h-full select-none pointer-events-none"
      muted={localStorage.getItem('videoMutedBanner') === 'true'}
      onPause={() =>
        playerRef.current && playerRef.current.state.paused ? playerRef.current.play() : null
      }
      onVolumeChange={handleVolumeChange}
      volume={localStorage.getItem('videoVolumeBanner') || 1}
    >
      <MediaProvider />
      <Controls.Root className="absolute bottom-4 left-4 flex space-x-2 z-[5]">
        <Controls.Group className="flex w-full items-center px-2">
          <Buttons.Fullscreen tooltipPlacement="top end" />
          <Buttons.Mute tooltipPlacement="top" toggleSliderOnUnmute={true} />
        </Controls.Group>
      </Controls.Root>
    </MediaPlayer>
  )
}

export default memo(BannerVideoPlayer)
