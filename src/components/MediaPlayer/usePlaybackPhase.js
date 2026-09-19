'use client'

import { useCallback, useSyncExternalStore } from 'react'

/**
 * What the player is doing right now, read off the raw media element.
 *
 *   idle      — nothing is expected to happen (paused with no start pending,
 *               e.g. autoplay was blocked and the viewer has not pressed play)
 *   starting  — playback has been asked for but the element cannot play yet
 *               (readyState < HAVE_FUTURE_DATA). Covers the cold JIT encode,
 *               a deferred play() (usePlayWhenReady), and the autoplay wait.
 *   buffering — was playing, now stalled mid-stream
 *   playing   — the clock is running
 *   paused    — the viewer paused, element ready
 *   error     — the element carries a MediaError
 *
 * Read from the ELEMENT, not the store: the store's `waiting` is proxied
 * through the media host and its `canPlay` is a one-way readyState-4 sample,
 * and neither knows about a deferred start. "Asked for" is derived from
 * three element facts — not paused, a pending deferred play
 * (`data-play-pending`), or the `autoplay` attribute still present (the
 * Cast-hint suppression removes it when the page must stay silent).
 *
 * `since` is when the current phase began, so the overlay can escalate its
 * copy honestly ("Loading" → "the server is encoding this") without a timer
 * of its own guessing at state.
 */

const HAVE_FUTURE_DATA = 3

const EVENTS = [
  'loadstart',
  'loadedmetadata',
  'loadeddata',
  'canplay',
  'canplaythrough',
  'play',
  'playing',
  'pause',
  'waiting',
  'stalled',
  'seeking',
  'seeked',
  'timeupdate',
  'progress',
  'ended',
  'emptied',
  'error',
  'playpending',
  'playreleased',
]

function phaseOf(el, hasPlayed) {
  if (!el) return 'idle'
  if (el.error) return 'error'
  if (el.ended) return 'idle'
  const ready = el.readyState >= HAVE_FUTURE_DATA
  const pendingStart = el.dataset?.playPending === '1'
  const wantsToPlay = !el.paused || pendingStart || (!hasPlayed && el.hasAttribute('autoplay'))
  if (!ready) {
    if (!wantsToPlay) return 'idle'
    return hasPlayed ? 'buffering' : 'starting'
  }
  if (!el.paused) return 'playing'
  return pendingStart ? 'starting' : 'paused'
}

/** Per-element memo: external state, so getSnapshot can return a stable object. */
const memo = new WeakMap()
const IDLE = Object.freeze({ phase: 'idle', since: 0 })
function stateFor(el) {
  let m = memo.get(el)
  if (!m) {
    m = { hasPlayed: false, snap: IDLE }
    memo.set(el, m)
  }
  return m
}

export default function usePlaybackPhase(el) {
  const subscribe = useCallback(
    (onChange) => {
      if (!el) return () => {}
      const m = stateFor(el)
      const onPlaying = () => {
        m.hasPlayed = true
        onChange()
      }
      const onEmptied = () => {
        m.hasPlayed = false
        onChange()
      }
      for (const ev of EVENTS) el.addEventListener(ev, onChange)
      el.addEventListener('playing', onPlaying)
      el.addEventListener('emptied', onEmptied)
      // readyState can rise without an event we listen to; a slow poll is
      // the floor so a phase never sticks.
      const poll = setInterval(onChange, 500)
      return () => {
        for (const ev of EVENTS) el.removeEventListener(ev, onChange)
        el.removeEventListener('playing', onPlaying)
        el.removeEventListener('emptied', onEmptied)
        clearInterval(poll)
      }
    },
    [el]
  )

  const getSnapshot = useCallback(() => {
    if (!el) return IDLE
    const m = stateFor(el)
    const phase = phaseOf(el, m.hasPlayed)
    if (phase !== m.snap.phase) m.snap = { phase, since: Date.now() }
    return m.snap
  }, [el])

  const getServerSnapshot = useCallback(() => IDLE, [])

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
