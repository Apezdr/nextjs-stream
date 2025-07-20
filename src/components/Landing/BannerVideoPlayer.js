'use client'
import '@vidstack/react/player/styles/default/theme.css'
import './media-player.css'
import '@components/MediaPlayer/Layouts/menus.css'
import { Controls, MediaPlayer, MediaProvider } from '@vidstack/react'
import { memo, useRef, useState, useEffect, useCallback } from 'react'
import * as Buttons from '@components/MediaPlayer/buttons'
import { motion } from 'framer-motion'

function BannerVideoPlayer({ media, onVideoEnd, currentMediaIndex, onVideoReady }) {
  const { videoURL } = media
  const playerRef = useRef(null)
  const [isPlayerReady, setPlayerReady] = useState(false)

  const handleVolumeChange = useCallback(() => {
    const player = playerRef.current
    if (player) {
      localStorage.setItem('videoVolumeBanner', player.volume)
      handleMuteChange(player)
    }
  }, [])

  const handleMuteChange = useCallback((player = playerRef.current) => {
    if (player) {
      localStorage.setItem('videoMutedBanner', player.muted)
    }
  }, [])

  const handleVisibilityChange = useCallback(() => {
    const player = playerRef.current
    if (isPlayerReady && document.visibilityState === 'visible' && player && player.state.paused) {
      player.play()
    }
  }, [isPlayerReady])

  useEffect(() => {
    setPlayerReady(false) // Reset player ready state when media changes
  }, [currentMediaIndex])

  useEffect(() => {
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [handleVisibilityChange])

  const handlePlaying = useCallback(() => {
    setPlayerReady(true)
    if (onVideoReady) {
      onVideoReady() // Notify parent that video is ready
    }
  }, [onVideoReady])

  return (
    <motion.div
      key={`video-player-${currentMediaIndex}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: isPlayerReady ? 1 : 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.75, ease: 'easeInOut' }}
      className="h-full w-full"
    >
      <MediaPlayer
        key={videoURL}
        ref={playerRef}
        src={videoURL}
        autoPlay={true}
        controlsDelay={6000}
        streamType="on-demand"
        playsInline
        load="eager"
        aspectRatio="16/9"
        fullscreenOrientation="landscape"
        className="absolute inset-0 w-full h-full select-none pointer-events-none z-0"
        muted={localStorage.getItem('videoMutedBanner') === 'true'}
        volume={localStorage.getItem('videoVolumeBanner') || 1}
        onPause={() => {
          const player = playerRef.current
          if (
            isPlayerReady &&
            player &&
            player.state.paused &&
            document.visibilityState === 'visible'
          ) {
            player.play()
          }
        }}
        onVolumeChange={handleVolumeChange}
        onEnded={onVideoEnd}
        onPlaying={handlePlaying}
        onDestroy={() => {
          // Remove the visibilitychange event listener
          document.removeEventListener('visibilitychange', handleVisibilityChange)

          // Clear stored volume and mute settings from localStorage
          localStorage.removeItem('videoVolumeBanner')
          localStorage.removeItem('videoMutedBanner')

          // Reset the player ready state
          setPlayerReady(false)

          // Clear the player reference
          playerRef.current = null
        }}
      >
        <MediaProvider />
        <Controls.Root className="absolute bottom-4 left-4 flex space-x-2 z-5">
          <Controls.Group className="flex w-full items-center px-2">
            <Buttons.Fullscreen tooltipPlacement="top end" />
            <Buttons.Mute tooltipPlacement="top" toggleSliderOnUnmute={true} />
          </Controls.Group>
        </Controls.Root>
        <div className="absolute inset-0 bg-linear-to-t from-black/70 via-black/50 to-transparent"></div>
      </MediaPlayer>
    </motion.div>
  )
}

export default memo(BannerVideoPlayer, (prevProps, nextProps) => {
  return (
    prevProps.isPlayerReady === nextProps.isPlayerReady &&
    prevProps.media.videoURL === nextProps.media.videoURL &&
    prevProps.currentMediaIndex === nextProps.currentMediaIndex &&
    prevProps.onVideoEnd === nextProps.onVideoEnd &&
    prevProps.onVideoReady === nextProps.onVideoReady
  )
})
