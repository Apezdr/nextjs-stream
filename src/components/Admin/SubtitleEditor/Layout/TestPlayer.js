'use client'

import React, { useRef, useEffect, useEffectEvent, useState } from 'react'
import { secondsToTimeCached } from '../utils/timeFormat'

export default function TestPlayer({ videoURL }) {
  const videoRef = useRef(null)
  const rafRef = useRef(null)
  const lastRef = useRef(0)
  const [playback, setPlayback] = useState({ time: 0, playing: false })
  const { time, playing } = playback

  // RAF loop that keeps the displayed time fresh while playing. Declared before
  // the effect events that reference it.
  function tick() {
    const v = videoRef.current
    if (!v) return
    // simple throttling: update if changed by > ~8ms to avoid micro-churn
    const newTime = v.currentTime
    if (Math.abs(newTime - lastRef.current) > 0.008) {
      lastRef.current = newTime
      setPlayback(prev => ({ ...prev, time: newTime }))
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  // Effect Events: keep the state writes out of the effect body so it doesn't
  // cascade. They always see the latest state and have stable identity.
  const onPlay = useEffectEvent(() => {
    setPlayback(prev => ({ ...prev, playing: true }))
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(tick)
    }
  })
  const onPause = useEffectEvent(() => {
    setPlayback(prev => ({ ...prev, playing: false }))
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  })
  const onSeeked = useEffectEvent(() => {
    const v = videoRef.current
    setPlayback(prev => ({ ...prev, time: v ? v.currentTime : prev.time }))
  })

  useEffect(() => {
    const v = videoRef.current
    if (!v) return

    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    v.addEventListener('seeked', onSeeked)

    // keep displayed time in sync when paused or after seeks
    setPlayback(prev => ({ ...prev, time: v.currentTime }))

    return () => {
      v.removeEventListener('play', onPlay)
      v.removeEventListener('pause', onPause)
      v.removeEventListener('seeked', onSeeked)
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [videoURL])

  return (
    <div className="w-full">
      <div className="bg-gray-800 rounded p-3">
        <video
          ref={videoRef}
          src={videoURL}
          controls
          className="w-full max-h-[60vh] bg-black"
        />
        <div className="mt-2 flex items-center justify-between">
          <div className="text-xs text-gray-300 font-mono">
            Player time: {secondsToTimeCached(time)}
          </div>
          <div className="text-xs text-gray-400">
            {playing ? 'Playing' : 'Paused'}
          </div>
        </div>
        <div className="mt-2 text-xs text-gray-400">
          (This player updates its own timestamp via RAF — use it to compare UI lag.)
        </div>
      </div>
    </div>
  )
}
