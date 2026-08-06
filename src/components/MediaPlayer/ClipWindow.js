'use client'

import { useEffect, useRef } from 'react'
import { Player } from './videojs'

/**
 * Emulates vidstack's clipStartTime/clipEndTime props (the framework has no
 * equivalent): seek to the clip start once playable, pause at the clip end.
 *
 * Unlike vidstack this does NOT remap the timeline — the seekbar shows the
 * full duration during clip playback. Accepted trade-off for the clip-share
 * use case.
 */
export default function ClipWindow({ clipStartTime, clipEndTime }) {
  const store = Player.usePlayer()
  const canPlay = Player.usePlayer((s) => s.canPlay)
  const appliedStartRef = useRef(false)
  const endedRef = useRef(false)

  useEffect(() => {
    if (!canPlay || !clipStartTime || appliedStartRef.current) return
    appliedStartRef.current = true
    // Only jump forward — if the resume ladder already seeked past the clip
    // start, leave that position alone.
    if (store.currentTime < clipStartTime) {
      store.seek(clipStartTime)
    }
  }, [canPlay, clipStartTime, store])

  useEffect(() => {
    if (!clipEndTime) return
    const unsubscribe = store.subscribe(() => {
      if (endedRef.current) return
      if (store.currentTime >= clipEndTime && !store.paused) {
        endedRef.current = true
        store.pause()
      }
    })
    return unsubscribe
  }, [clipEndTime, store])

  return null
}
