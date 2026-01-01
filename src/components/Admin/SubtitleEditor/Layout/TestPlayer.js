'use client'

import React, { useRef, useEffect, useState } from 'react'
import { secondsToTimeCached } from '../utils/timeFormat'

export default function TestPlayer({ videoURL }) {
  const videoRef = useRef(null)
  const rafRef = useRef(null)
  const lastRef = useRef(0)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    const v = videoRef.current
    if (!v) return

    const onPlay = () => {
      setPlaying(true)
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(tick)
      }
    }
    const onPause = () => {
      setPlaying(false)
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
    const onSeeked = () => {
      setTime(v.currentTime)
    }

    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    v.addEventListener('seeked', onSeeked)

    // keep displayed time in sync when paused or after seeks
    setTime(v.currentTime)

    return () => {
      v.removeEventListener('play', onPlay)
      v.removeEventListener('pause', onPause)
      v.removeEventListener('seeked', onSeeked)
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoURL])

  function tick(now) {
    const v = videoRef.current
    if (!v) return
    // simple throttling: update if changed by > ~8ms to avoid micro-churn
    const newTime = v.currentTime
    if (Math.abs(newTime - lastRef.current) > 0.008) {
      lastRef.current = newTime
      setTime(newTime)
    }
    rafRef.current = requestAnimationFrame(tick)
  }

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
