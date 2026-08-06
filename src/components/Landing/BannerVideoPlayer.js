'use client'

import { memo, useState } from 'react'
import { motion } from 'framer-motion'
import useYouTubePlayer from '@components/VideoPreview/useYouTubePlayer'
import { extractYouTubeId } from '@components/VideoPreview/youtubeUrl'

const VOLUME_KEY = 'videoVolumeBanner'

function BannerVideoPlayer({ media, muted, paused, onTimeUpdate, currentMediaIndex }) {
  const { videoURL } = media
  const videoId = extractYouTubeId(videoURL)

  // Volume preference persists across sessions; mute lives in the parent
  // (per-session sessionStorage). The banner has no volume control of its own,
  // so the stored value is read-only here.
  const [initialVolume] = useState(() => {
    if (typeof window === 'undefined') return 1
    const stored = localStorage.getItem(VOLUME_KEY)
    return stored ? Number(stored) : 1
  })

  const { containerRef, isPlaying, hasFailed } = useYouTubePlayer({
    videoId,
    shouldPlay: !paused,
    muted,
    volume: initialVolume,
    onTime: onTimeUpdate,
  })

  if (!videoId || hasFailed) return null

  return (
    <motion.div
      key={`video-player-${currentMediaIndex}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: isPlaying ? 1 : 0 }}
      transition={{ duration: 0.75, ease: 'easeInOut' }}
      className="h-full w-full"
    >
      <div
        ref={containerRef}
        className="absolute inset-0 w-full h-full select-none pointer-events-none z-0 [&_iframe]:absolute [&_iframe]:inset-0 [&_iframe]:h-full [&_iframe]:w-full"
      />
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
