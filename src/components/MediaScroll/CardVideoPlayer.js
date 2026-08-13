'use client'

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { classNames } from '@src/utils'
import useYouTubePlayer from '@components/VideoPreview/useYouTubePlayer'
import useVideoElementTeardown from '@components/VideoPreview/useVideoElementTeardown'
import { extractYouTubeId } from '@components/VideoPreview/youtubeUrl'
import '@components/VideoPreview/preview.css'

const VOLUME_KEY = 'videoVolumeCard'
const MUTED_KEY = 'videoMutedCard'

// The `muted` prop only forces mute when strictly true â€” otherwise the stored
// preference wins (long-standing contract; EpisodeThumbnail passes false and
// expects the stored value).
function readInitialMuted(mutedProp) {
  if (mutedProp === true) return true
  if (typeof window === 'undefined') return true
  const stored = localStorage.getItem(MUTED_KEY)
  return stored !== null ? stored === 'true' : true
}

function readInitialVolume() {
  if (typeof window === 'undefined') return 1
  return parseFloat(localStorage.getItem(VOLUME_KEY)) || 1
}

/** Compact bottom-left mute toggle that reveals a volume slider on unmute. */
function MuteControl({ muted, volume, onToggleMute, onVolumeChange }) {
  const [showSlider, setShowSlider] = useState(false)

  const handleToggle = useCallback(
    (event) => {
      event.preventDefault()
      event.stopPropagation()
      const nextMuted = onToggleMute()
      if (nextMuted === false) setShowSlider(true)
    },
    [onToggleMute]
  )

  return (
    <div
      className="absolute bottom-4 left-4 z-[5] flex items-center gap-2 pointer-events-auto"
      onClick={(event) => {
        // Keep clicks on the control from reaching card links underneath.
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      <button
        type="button"
        aria-label={muted ? 'Unmute' : 'Mute'}
        onClick={handleToggle}
        className="group flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white outline-none hover:bg-black/80"
      >
        {muted ? (
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M3.63 3.63a1 1 0 0 1 1.41 0L20.37 18.96a1 1 0 0 1-1.41 1.41l-2.4-2.4A8.9 8.9 0 0 1 14 19.13V17a7 7 0 0 0 1.11-.47l-3.11-3.1V18a1 1 0 0 1-1.7.71L6.59 15H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h2.59l.9-.9-3.86-3.06a1 1 0 0 1 0-1.41ZM12 5.99v3.2L9.45 6.63l.85-.85A1 1 0 0 1 12 6Z" />
          </svg>
        ) : (
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M11.3 5.29A1 1 0 0 1 13 6v12a1 1 0 0 1-1.7.71L7.59 15H5a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h2.59ZM16 8.5a1 1 0 0 1 1.41 0 5 5 0 0 1 0 7.07A1 1 0 1 1 16 14.16a3 3 0 0 0 0-4.25 1 1 0 0 1 0-1.41Zm2.83-2.83a1 1 0 0 1 1.41 0 9 9 0 0 1 0 12.73 1 1 0 1 1-1.41-1.42 7 7 0 0 0 0-9.9 1 1 0 0 1 0-1.41Z" />
          </svg>
        )}
      </button>
      {!muted && showSlider && (
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={volume}
          aria-label="Volume"
          onChange={(event) => onVolumeChange(Number(event.target.value))}
          className="h-1 w-20 cursor-pointer accent-white"
        />
      )}
    </div>
  )
}

/** Direct-file preview branch â€” a plain <video> with the 416-remount guard. */
function FilePreview({
  videoURL,
  shouldPlay,
  muted,
  volume,
  onVideoReady,
  onVideoEnd,
  onPlaying,
  onPlayingChange,
}) {
  // Real-unmount teardown: a playing <video> removed from the DOM keeps its
  // audio alive until GC â€” pause + release on unmount.
  const videoRef = useVideoElementTeardown()
  const readyNotifiedRef = useRef(false)
  const [instanceKey, setInstanceKey] = useState(0)

  // Stop when the surrounding page is hidden by Next's segment cache (or
  // unmounted). Layout-effect cleanup is the prescribed hook for that, and
  // `hidden` also gates the onPause auto-resume below, which would otherwise
  // immediately undo this pause.
  const hiddenRef = useRef(false)
  useLayoutEffect(() => {
    hiddenRef.current = false
    return () => {
      hiddenRef.current = true
      try {
        // Read at cleanup time on purpose: this hybrid callback ref tracks the
        // live element across the 416-recovery remount, so a value captured at
        // setup could be the wrong (already replaced) node.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        videoRef.current?.pause()
      } catch {
        /* already gone */
      }
    }
  }, [videoRef])

  const callbacksRef = useRef({})
  const shouldPlayRef = useRef(shouldPlay)
  useEffect(() => {
    callbacksRef.current = { onVideoReady, onVideoEnd, onPlaying, onPlayingChange }
    shouldPlayRef.current = shouldPlay
  })

  // Mirror play/pause intent.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (shouldPlay && !hiddenRef.current) {
      video.play().catch(() => {})
    } else if (!video.paused) {
      video.pause()
    }
  }, [shouldPlay, instanceKey, videoRef])

  // Mirror mute/volume.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.muted = muted
    video.volume = volume
  }, [muted, volume, instanceKey, videoRef])

  // Resume when the tab becomes visible again while we still should play.
  useEffect(() => {
    const handleVisibility = () => {
      const video = videoRef.current
      if (
        video &&
        document.visibilityState === 'visible' &&
        video.paused &&
        shouldPlayRef.current
      ) {
        video.play().catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [videoRef])

  const handleError = useCallback(() => {
    const video = videoRef.current
    const error = video?.error
    console.error('Card video player error:', error)
    // "416 Range Not Satisfiable" leaves the element wedged; a full remount is
    // the reliable cure (long-standing workaround carried over from vidstack).
    setInstanceKey((key) => key + 1)
  }, [videoRef])

  return (
    <video
      key={instanceKey}
      ref={videoRef}
      src={videoURL}
      playsInline
      preload="auto"
      className="absolute inset-0 h-full w-full object-cover"
      onCanPlay={() => {
        if (readyNotifiedRef.current) return
        readyNotifiedRef.current = true
        const { onVideoReady: notify } = callbacksRef.current
        if (notify) notify(videoRef.current)
      }}
      onPlaying={() => {
        const { onPlaying: notify, onPlayingChange } = callbacksRef.current
        if (onPlayingChange) onPlayingChange(true)
        if (notify) notify()
      }}
      onPause={() => {
        const { onPlayingChange } = callbacksRef.current
        if (onPlayingChange) onPlayingChange(false)
        // Auto-resume unexpected pauses while the parent still wants playback
        // â€” never once the page is hidden, where that pause was ours.
        const video = videoRef.current
        if (
          video &&
          !hiddenRef.current &&
          shouldPlayRef.current &&
          document.visibilityState === 'visible'
        ) {
          video.play().catch(() => {})
        }
      }}
      onEnded={() => {
        const { onVideoEnd: notify, onPlayingChange } = callbacksRef.current
        if (onPlayingChange) onPlayingChange(false)
        if (notify) notify(videoRef.current)
      }}
      onError={handleError}
    />
  )
}

/** YouTube trailer branch built on the IFrame API hook. */
function YouTubePreview({
  videoId,
  shouldPlay,
  muted,
  volume,
  onVideoReady,
  onVideoEnd,
  onPlaying,
  onPlayingChange,
}) {
  const { containerRef, isPlaying } = useYouTubePlayer({
    videoId,
    shouldPlay,
    muted,
    volume,
    onReady: onVideoReady,
    onPlaying,
    onEnded: onVideoEnd,
  })

  const onPlayingChangeRef = useRef(onPlayingChange)
  useEffect(() => {
    onPlayingChangeRef.current = onPlayingChange
  })
  useEffect(() => {
    if (onPlayingChangeRef.current) onPlayingChangeRef.current(isPlaying)
  }, [isPlaying])

  return (
    // yt-cover matches the direct-file branch's object-cover — see preview.css
    <div ref={containerRef} className="yt-cover absolute inset-0 h-full w-full" />
  )
}

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
  const youTubeId = extractYouTubeId(videoURL)
  const [isMuted, setIsMuted] = useState(() => readInitialMuted(muted))
  const [volume, setVolume] = useState(() => readInitialVolume())
  const [isPlaying, setIsPlaying] = useState(false)

  const handleToggleMute = useCallback(() => {
    let next
    setIsMuted((current) => {
      next = !current
      localStorage.setItem(MUTED_KEY, String(next))
      return next
    })
    return next
  }, [])

  const handleVolumeChange = useCallback((value) => {
    setVolume(value)
    localStorage.setItem(VOLUME_KEY, String(value))
  }, [])

  if (!videoURL) return null

  const branchProps = {
    shouldPlay,
    muted: isMuted,
    volume,
    onVideoReady,
    onVideoEnd,
    onPlaying,
    onPlayingChange: setIsPlaying,
  }

  return (
    <div
      style={{ height, width }}
      className={classNames(
        'z-[40]',
        'absolute inset-0 h-full w-full select-none pointer-events-none',
        'transition-opacity duration-700',
        isPlaying || shouldPlay ? 'opacity-100' : 'opacity-0',
        className
      )}
    >
      {youTubeId ? (
        <YouTubePreview videoId={youTubeId} {...branchProps} />
      ) : (
        <FilePreview videoURL={videoURL} {...branchProps} />
      )}
      <MuteControl
        muted={isMuted}
        volume={volume}
        onToggleMute={handleToggleMute}
        onVolumeChange={handleVolumeChange}
      />
    </div>
  )
}

export default memo(CardVideoPlayer)
