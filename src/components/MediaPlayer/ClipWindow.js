'use client'

import { useEffect, useRef } from 'react'
import { Player } from './videojs'
import usePlaybackReady from './usePlaybackReady'

/**
 * Emulates vidstack's clipStartTime/clipEndTime props (the framework has no
 * equivalent): seek to the clip start once seekable, pause at the clip end.
 *
 * Unlike vidstack this does NOT remap the timeline — the seekbar shows the
 * full duration during clip playback. Accepted trade-off for the clip-share
 * use case.
 *
 * Readiness comes from the raw element (playbackReadiness.js), not the
 * store's `canPlay`: against the JIT origin readyState 4 may never be
 * sampled, and a clip link that never seeks to its start is just the whole
 * title. `castAdopted` is threaded in explicitly — this component had no Cast
 * awareness before, and while a receiver owns the title neither the seek nor
 * the end-of-clip pause may drive it from this page.
 */
export default function ClipWindow({ clipStartTime, clipEndTime, castAdopted = false }) {
  const store = Player.usePlayer()
  const { canSeek } = usePlaybackReady(store, { castAdopted })
  const appliedStartRef = useRef(false)
  const endedRef = useRef(false)

  useEffect(() => {
    if (castAdopted) return
    if (!canSeek || !clipStartTime || appliedStartRef.current) return
    if (!store.target) return // direct reads throw NO_TARGET pre-attach
    appliedStartRef.current = true
    // Only jump forward — if the resume ladder already seeked past the clip
    // start, leave that position alone.
    if (store.currentTime < clipStartTime) {
      store.seek(clipStartTime)
    }
  }, [canSeek, clipStartTime, store, castAdopted])

  useEffect(() => {
    if (!clipEndTime || castAdopted) return
    const unsubscribe = store.subscribe(() => {
      if (endedRef.current || !store.target) return
      if (store.currentTime >= clipEndTime && !store.paused) {
        endedRef.current = true
        store.pause()
      }
    })
    return unsubscribe
  }, [clipEndTime, store, castAdopted])

  return null
}
