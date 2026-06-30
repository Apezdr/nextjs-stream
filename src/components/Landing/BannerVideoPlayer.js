'use client'
import '@vidstack/react/player/styles/default/theme.css'
import './media-player.css'
import '@components/MediaPlayer/Layouts/menus.css'
import { MediaPlayer, MediaProvider } from '@vidstack/react'
import { memo, useRef, useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'

const VOLUME_KEY = 'videoVolumeBanner'

function BannerVideoPlayer({ media, muted, paused, onTimeUpdate, currentMediaIndex }) {
  const { videoURL } = media
  const playerRef = useRef(null)
  const [isPlayerReady, setPlayerReady] = useState(false)

  // Volume preference persists across sessions; mute lives in the parent (per-session sessionStorage).
  const [initialVolume] = useState(() => {
    if (typeof window === 'undefined') return 1
    const stored = localStorage.getItem(VOLUME_KEY)
    return stored ? Number(stored) : 1
  })

  const handleVolumeChange = useCallback(() => {
    const player = playerRef.current
    if (player) {
      localStorage.setItem(VOLUME_KEY, player.volume)
    }
  }, [])

  // Mirror the parent's `paused` prop onto the underlying player.
  useEffect(() => {
    const player = playerRef.current
    if (!player || !isPlayerReady) return
    if (paused) {
      player.pause()
    } else {
      player.play()
    }
  }, [paused, isPlayerReady])

  // Mirror the parent's `muted` prop onto the underlying player.
  // Vidstack treats <MediaPlayer muted> as initial-only, so prop changes after mount need
  // to be applied imperatively via the ref.
  useEffect(() => {
    const player = playerRef.current
    if (!player || !isPlayerReady) return
    player.muted = muted
  }, [muted, isPlayerReady])

  const handlePlaying = useCallback(() => {
    setPlayerReady(true)
  }, [])

  const handleTimeUpdate = useCallback(() => {
    const player = playerRef.current
    if (player && onTimeUpdate) {
      onTimeUpdate(player.currentTime || 0, player.duration || 0)
    }
  }, [onTimeUpdate])

  return (
    <motion.div
      key={`video-player-${currentMediaIndex}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: isPlayerReady ? 1 : 0 }}
      transition={{ duration: 0.75, ease: 'easeInOut' }}
      className="h-full w-full"
    >
      <MediaPlayer
        key={videoURL}
        ref={playerRef}
        src={videoURL}
        autoPlay={true}
        streamType="on-demand"
        playsInline
        load="eager"
        aspectRatio="16/9"
        fullscreenOrientation="landscape"
        className="absolute inset-0 w-full h-full select-none pointer-events-none z-0"
        muted={muted}
        volume={initialVolume}
        onVolumeChange={handleVolumeChange}
        onPlaying={handlePlaying}
        onTimeUpdate={handleTimeUpdate}
      >
        <MediaProvider />
      </MediaPlayer>
    </motion.div>
  )
}

export default memo(BannerVideoPlayer, (prevProps, nextProps) => {
  return (
    prevProps.media.videoURL === nextProps.media.videoURL &&
    prevProps.currentMediaIndex === nextProps.currentMediaIndex &&
    prevProps.muted === nextProps.muted &&
    prevProps.paused === nextProps.paused &&
    prevProps.onTimeUpdate === nextProps.onTimeUpdate
  )
})
