'use client'
import { memo } from 'react'
import { SpeakerWaveIcon, SpeakerXMarkIcon } from '@heroicons/react/24/outline'

const RING_SIZE = 40
const RING_STROKE = 2
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

const formatTime = (seconds) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function BannerTrailerIndicator({ currentTime, duration, isMuted, onToggleMute }) {
  const hasDuration = Number.isFinite(duration) && duration > 0
  const progress = hasDuration ? Math.min(Math.max(currentTime / duration, 0), 1) : 0
  const offset = RING_CIRCUMFERENCE * (1 - progress)

  return (
    <div className="absolute bottom-4 left-4 flex items-center gap-2 z-10 pointer-events-none select-none">
      {hasDuration ? (
        <div className="px-3 py-1.5 rounded-full bg-black/55 border border-white/10 backdrop-blur-sm text-white text-xs font-medium tabular-nums">
          {formatTime(currentTime)} / {formatTime(duration)}
        </div>
      ) : null}
      <button
        type="button"
        onClick={onToggleMute}
        className="relative flex items-center justify-center rounded-full bg-black/55 border border-white/10 backdrop-blur-sm hover:bg-black/70 transition pointer-events-auto"
        style={{ width: RING_SIZE, height: RING_SIZE }}
        aria-label={isMuted ? 'Unmute trailer' : 'Mute trailer'}
      >
        <svg className="absolute inset-0 -rotate-90" width={RING_SIZE} height={RING_SIZE}>
          <circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_RADIUS}
            fill="none"
            stroke="rgba(255,255,255,0.15)"
            strokeWidth={RING_STROKE}
          />
          <circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_RADIUS}
            fill="none"
            stroke="white"
            strokeWidth={RING_STROKE}
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 0.2s linear' }}
          />
        </svg>
        {isMuted ? (
          <SpeakerXMarkIcon className="w-4 h-4 text-white" />
        ) : (
          <SpeakerWaveIcon className="w-4 h-4 text-white" />
        )}
      </button>
    </div>
  )
}

export default memo(BannerTrailerIndicator)
