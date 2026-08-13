'use client'

import { useEffect, useRef } from 'react'
import { Player } from './videojs'

// Positions below this are treated as "the start" rather than a real place
// the viewer had reached.
const MEANINGFUL_POSITION_S = 1

/**
 * Keeps the local playback position when a Cast session ends without having
 * played anything.
 *
 * On disconnect the Cast provider restores the local element from the SDK's
 * `savedPlayerState.currentTime`. If the session is cancelled before the
 * receiver loads media that value is 0, so it writes 0 onto the local element
 * and playback jumps to the beginning — even though the viewer never asked for
 * that. (The resume ladder won't undo it either: it applies once per mount.)
 *
 * So: remember where playback was before casting, and if the session ends with
 * the local element back at the start AND the remote never reported real
 * progress, put it back. When the receiver did play, its position is the
 * correct one and is left alone.
 */
export default function CastResumeGuard() {
  const store = Player.usePlayer()
  const remoteState = Player.usePlayer((s) => s.remotePlaybackState)

  const localTimeRef = useRef(0)
  const preCastTimeRef = useRef(0)
  const sawRemoteProgressRef = useRef(false)
  const remoteStateRef = useRef(remoteState)
  const prevStateRef = useRef(remoteState)

  useEffect(() => {
    remoteStateRef.current = remoteState
  }, [remoteState])

  // Follow playback through the store's subscription rather than a reactive
  // selector: this only needs the latest value, not a re-render four times a
  // second.
  useEffect(() => {
    if (!store) return undefined
    return store.subscribe(() => {
      if (!store.target) return
      const time = store.currentTime
      if (remoteStateRef.current === 'disconnected') {
        if (time > 0) localTimeRef.current = time
      } else if (time > MEANINGFUL_POSITION_S) {
        // The receiver is actually playing, so its position is authoritative.
        sawRemoteProgressRef.current = true
      }
    })
  }, [store])

  useEffect(() => {
    const previous = prevStateRef.current
    prevStateRef.current = remoteState
    if (previous === remoteState) return undefined

    if (remoteState !== 'disconnected') {
      if (previous === 'disconnected') {
        preCastTimeRef.current = localTimeRef.current
        sawRemoteProgressRef.current = false
      }
      return undefined
    }

    const preCastTime = preCastTimeRef.current
    if (sawRemoteProgressRef.current || preCastTime <= MEANINGFUL_POSITION_S) return undefined

    // The provider writes the restored position synchronously while
    // disconnecting, so check after it has had its turn.
    const timer = setTimeout(() => {
      if (!store?.target) return
      if (store.currentTime <= MEANINGFUL_POSITION_S) store.seek(preCastTime)
    }, 0)
    return () => clearTimeout(timer)
  }, [remoteState, store])

  return null
}
