'use client'

import { useEffect, useRef } from 'react'
import { Player } from './videojs'
import { buttonClass } from './buttons'
import { classNames } from '@src/utils'
import { castVolumeStep, meterSegments, stepLevel } from './CastVolume'

/** Hold this long before a held button starts repeating. */
const HOLD_DELAY_MS = 400
/** Then step this often while it stays held. */
const HOLD_REPEAT_MS = 200
/** Past this many steps, segments would be too thin to read: draw a bar. */
const MAX_SEGMENTS = 30

const stepButtonClass = classNames(buttonClass, 'w-8 touch-none select-none disabled:cursor-default disabled:opacity-40')

/**
 * Press-and-hold stepping for a button: one step on press, then one every
 * HOLD_REPEAT_MS after HOLD_DELAY_MS until release. A keyboard click
 * (Enter/Space, `detail === 0`) steps once; a mouse click is ignored because
 * its press already stepped.
 */
function useHoldRepeat(onStep) {
  const timers = useRef(null)

  const stop = () => {
    clearTimeout(timers.current?.delay)
    clearInterval(timers.current?.repeat)
    timers.current = null
  }

  useEffect(() => stop, [])

  return {
    onPointerDown: (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return
      stop()
      onStep()
      const held = {}
      held.delay = setTimeout(() => {
        held.repeat = setInterval(onStep, HOLD_REPEAT_MS)
      }, HOLD_DELAY_MS)
      timers.current = held
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    onClick: (event) => {
      if (event.detail === 0) onStep()
    },
  }
}

function StepIcon({ plus }) {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <path d="M6 12h12" />
      {plus && <path d="M12 6v12" />}
    </svg>
  )
}

/**
 * The volume control while casting: − / + buttons around a step meter, in
 * place of the slider.
 *
 * A Cast receiver moves its volume in steps (one press of its own buttons;
 * 1/15 on an AVR with built-in Cast, which turned each into one 0.5-unit
 * notch). A slider implied absolute positions the receiver doesn't have and
 * made small adjustments fiddly; a press here is exactly one receiver step,
 * and the meter shows the receiver's steps rather than claiming the AVR's own
 * dial number, which Cast never reports. Writes go through the store to
 * CastVolume, which paces them, snaps them to the step and confirms where the
 * receiver landed.
 *
 * Mounted only while the receiver owns the volume, so the step (constant for a
 * session) is read once per cast.
 */
export function CastVolumeControl() {
  const store = Player.usePlayer()
  const volume = Player.usePlayer((s) => s.volume)
  const muted = Player.usePlayer((s) => s.muted)
  const step = castVolumeStep()
  const { count, lit } = meterSegments(volume, step)

  // Read the level at the moment of the press, not at render: a held button
  // steps from wherever the previous step left it.
  const nudge = (direction) => store.setVolume(stepLevel(store.volume, step, direction))
  const down = useHoldRepeat(() => nudge(-1))
  const up = useHoldRepeat(() => nudge(1))

  return (
    <div className="flex items-center" role="group" aria-label="Cast volume">
      {/* No ButtonTooltip: it clones the button with the tooltip trigger's
          props spread last, which would override the hold handlers. */}
      <button type="button" aria-label="Volume down" disabled={lit === 0 && !muted} className={stepButtonClass} {...down}>
        <StepIcon />
      </button>
      <span
        role="meter"
        aria-label="Volume"
        aria-valuemin={0}
        aria-valuemax={count}
        aria-valuenow={lit}
        aria-valuetext={muted ? 'Muted' : `${lit} of ${count}`}
        className={classNames('mx-1 flex h-3 w-[72px] items-end gap-px', muted && 'opacity-40')}
      >
        {count > MAX_SEGMENTS ? (
          <span className="relative h-[5px] w-full rounded-sm bg-white/30">
            <span className="absolute inset-y-0 left-0 rounded-sm bg-blue-300" style={{ width: `${(lit / count) * 100}%` }} />
          </span>
        ) : (
          Array.from({ length: count }, (_, i) => (
            <span key={i} className={classNames('h-full flex-1 rounded-[1px]', i < lit ? 'bg-blue-300' : 'bg-white/25')} />
          ))
        )}
      </span>
      <button type="button" aria-label="Volume up" disabled={lit === count && !muted} className={stepButtonClass} {...up}>
        <StepIcon plus />
      </button>
    </div>
  )
}
