'use client'

import { useEffect, useRef } from 'react'
import { Player } from './videojs'
import { isManifestSource } from './PlayerMedia'

/**
 * Make hls.js actually start at the resume point.
 *
 * `config.startPosition` is not enough under @videojs/media. Observed live
 * (three of three reloads, via a wrapped `engine.startLoad`): the framework's
 * preload mixin issues a bare `startLoad()` from an Hls event handler AFTER
 * the manifest has parsed. On that path hls.js resolves the position to -1
 * (no `lastCurrentTime` yet), starts at 0, and — because `stopLoad()` clears
 * `forceStartLoad` — its own `startLoad(config.startPosition)` never runs.
 * Result: segment 0 is fetched, the element sits at 0, and the resume point
 * is silently lost (config said 197, engine loaded 0).
 *
 * So: watch the FIRST fragment request. If it is not at the resume point,
 * restart loading there ourselves. hls.js's `startLoad(pos)` aborts the
 * in-flight request and records `lastCurrentTime = pos`, so any later bare
 * `startLoad()` from the framework resolves to pos too. One correction per
 * mount, and never after the viewer has moved the playhead.
 *
 * Before the fix this is also the path that produced the stalled cold
 * start: the element starts at 0, then something seeks it to the resume
 * point on a fresh engine. Starting at the right place removes that seek.
 *
 * @param {{resumeAt: number|null, videoURL: string}} props
 */
export default function EngineStartPosition({ resumeAt, videoURL }) {
  // The store's `source` is the MSE blob: URL once hls.js attaches, so the
  // manifest test has to run on the served URL.
  const media = Player.useMedia()
  const correctedRef = useRef(false)

  useEffect(() => {
    const target = Number(resumeAt)
    if (!media || !Number.isFinite(target) || target <= 0 || !isManifestSource(videoURL)) {
      return undefined
    }

    let engine = null
    correctedRef.current = false

    const onFragLoading = (_event, data) => {
      if (correctedRef.current) return
      const frag = data?.frag
      if (!frag || frag.type !== 'main') return
      correctedRef.current = true // one shot, whatever we decide
      const el = media.target
      // The viewer already moved the playhead: leave it alone.
      if (el && el.currentTime > 1) return
      const tolerance = Math.max(2, (frag.duration || 6) * 1.5)
      if (Math.abs(frag.start - target) <= tolerance) return
      // Wrong start — restart AT the resume point. This aborts the
      // fragment-0 request rather than letting it complete and be abandoned.
      engine.startLoad(target)
      if (typeof window !== 'undefined' && window.__playbackDiag?.events) {
        window.__playbackDiag.events.push({
          kind: 'engine:restart-at-resume',
          t: 0,
          from: frag.start,
          to: target,
        })
      }
    }

    const bind = () => {
      const next = media.engine ?? null
      if (next === engine) return
      engine?.off('hlsFragLoading', onFragLoading)
      engine = next
      engine?.on('hlsFragLoading', onFragLoading)
    }

    bind()
    media.addEventListener('loadstart', bind)
    return () => {
      media.removeEventListener('loadstart', bind)
      engine?.off('hlsFragLoading', onFragLoading)
    }
  }, [media, videoURL, resumeAt])

  return null
}
