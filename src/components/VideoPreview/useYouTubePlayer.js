'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { loadYouTubeAPI } from './youtubeLoader'

const TIMEUPDATE_INTERVAL_MS = 250
const VISIBLE_ROOT_MARGIN = '200px'
// YT.PlayerState values (numeric constants are stable API):
const STATE_ENDED = 0
const STATE_PLAYING = 1

/**
 * Chrome-less YouTube IFrame player for muted trailer/clip previews.
 *
 * The IFrame API has no timeupdate event, so a short interval synthesizes one
 * while playing. Errors (embed-disabled videos, transient failures) trigger a
 * single recreate; a second failure surrenders via `onError`.
 *
 * @returns {{ containerRef: React.Ref, isPlaying: boolean, hasFailed: boolean, getPlayer: () => (YT.Player|null) }}
 */
export default function useYouTubePlayer({
  videoId,
  shouldPlay = false,
  muted = true,
  volume = 1, // 0..1
  onTime,
  onPlaying,
  onEnded,
  onReady,
  onError,
  deferUntilVisible = false,
}) {
  const containerRef = useRef(null)
  const playerRef = useRef(null)
  const readyRef = useRef(false)
  const intervalRef = useRef(null)
  const retriedRef = useRef(false)

  const [isPlaying, setIsPlaying] = useState(false)
  const [hasFailed, setHasFailed] = useState(false)
  const [isVisible, setIsVisible] = useState(!deferUntilVisible)
  const [instanceKey, setInstanceKey] = useState(0)

  // Callbacks and play/mute/volume intents live in refs so the create-player
  // effect never re-runs on a new closure or prop flip.
  const callbacksRef = useRef({})
  callbacksRef.current = { onTime, onPlaying, onEnded, onReady, onError }
  const intentRef = useRef({})
  intentRef.current = { shouldPlay, muted, volume }

  // Defer creation until the mount point scrolls near the viewport.
  useEffect(() => {
    if (!deferUntilVisible || isVisible) return undefined
    const node = containerRef.current
    if (!node || typeof IntersectionObserver === 'undefined') {
      setIsVisible(true)
      return undefined
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setIsVisible(true)
      },
      { rootMargin: VISIBLE_ROOT_MARGIN }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [deferUntilVisible, isVisible])

  const stopTimePolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  const startTimePolling = useCallback(() => {
    stopTimePolling()
    intervalRef.current = setInterval(() => {
      const player = playerRef.current
      if (!player || typeof player.getCurrentTime !== 'function') return
      const { onTime: notify } = callbacksRef.current
      if (notify) notify(player.getCurrentTime() || 0, player.getDuration() || 0)
    }, TIMEUPDATE_INTERVAL_MS)
  }, [stopTimePolling])

  // Create/destroy the player.
  useEffect(() => {
    if (!videoId || !isVisible) return undefined

    let disposed = false
    // The API replaces the target element with the iframe, so hand it a
    // dedicated child instead of the React-owned container div.
    const host = containerRef.current
    if (!host) return undefined
    const mount = document.createElement('div')
    mount.style.width = '100%'
    mount.style.height = '100%'
    host.appendChild(mount)

    loadYouTubeAPI()
      .then((YT) => {
        if (disposed) return
        playerRef.current = new YT.Player(mount, {
          videoId,
          width: '100%',
          height: '100%',
          playerVars: {
            autoplay: 0,
            controls: 0,
            disablekb: 1,
            playsinline: 1,
            rel: 0,
            iv_load_policy: 3,
            modestbranding: 1,
            fs: 0,
            origin: window.location.origin,
          },
          events: {
            onReady: () => {
              if (disposed) return
              readyRef.current = true
              const player = playerRef.current
              const { muted: wantMuted, volume: wantVolume, shouldPlay: wantPlay } = intentRef.current
              // Mute must be applied before play for autoplay policy.
              if (wantMuted) player.mute()
              else player.unMute()
              player.setVolume(Math.round((wantVolume ?? 1) * 100))
              if (wantPlay) player.playVideo()
              const { onReady: notify } = callbacksRef.current
              if (notify) notify(player)
            },
            onStateChange: (event) => {
              if (disposed) return
              if (event.data === STATE_PLAYING) {
                setIsPlaying(true)
                startTimePolling()
                const { onPlaying: notify } = callbacksRef.current
                if (notify) notify()
              } else {
                setIsPlaying(false)
                stopTimePolling()
                if (event.data === STATE_ENDED) {
                  const { onEnded: notify } = callbacksRef.current
                  if (notify) notify()
                }
              }
            },
            onError: (event) => {
              if (disposed) return
              console.error('YouTube preview player error:', event?.data)
              if (!retriedRef.current) {
                // One recreate covers transient failures; embed-disabled
                // videos fail again immediately, so don't loop.
                retriedRef.current = true
                setInstanceKey((key) => key + 1)
              } else {
                setHasFailed(true)
                const { onError: notify } = callbacksRef.current
                if (notify) notify(event?.data)
              }
            },
          },
        })
      })
      .catch((error) => {
        if (disposed) return
        console.error('YouTube preview unavailable:', error?.message || error)
        setHasFailed(true)
        const { onError: notify } = callbacksRef.current
        if (notify) notify(error)
      })

    return () => {
      disposed = true
      readyRef.current = false
      stopTimePolling()
      setIsPlaying(false)
      const player = playerRef.current
      playerRef.current = null
      if (player && typeof player.destroy === 'function') {
        try {
          player.destroy()
        } catch {
          /* iframe already gone */
        }
      }
      if (mount.parentNode === host) host.removeChild(mount)
    }
  }, [videoId, isVisible, instanceKey, startTimePolling, stopTimePolling])

  // Mirror the shouldPlay intent.
  useEffect(() => {
    const player = playerRef.current
    if (!player || !readyRef.current) return
    if (shouldPlay) player.playVideo()
    else player.pauseVideo()
  }, [shouldPlay, instanceKey])

  // Mirror mute/volume.
  useEffect(() => {
    const player = playerRef.current
    if (!player || !readyRef.current) return
    if (muted) player.mute()
    else player.unMute()
    player.setVolume(Math.round((volume ?? 1) * 100))
  }, [muted, volume, instanceKey])

  const getPlayer = useCallback(() => playerRef.current, [])

  return { containerRef, isPlaying, hasFailed, getPlayer }
}
