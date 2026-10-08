'use client'

import { useCallback, useSyncExternalStore } from 'react'
import { Player } from './videojs'
import { traitsFromLevels } from './renditionTraits'

const NONE = new Map()

// One traits map per hls.js levels array. hls.js swaps in a new array when it
// parses or drops levels, so the array's identity is the snapshot's version.
const traitsCache = new WeakMap()

function traitsOf(levels) {
  if (!levels) return NONE
  let traits = traitsCache.get(levels)
  if (!traits) {
    traits = traitsFromLevels(levels)
    traitsCache.set(levels, traits)
  }
  return traits
}

/**
 * Per-rendition traits (dynamic range, Original) read off the hls.js levels,
 * kept current as hls.js parses or drops levels. See renditionTraits.js.
 *
 * An external store rather than a render-time read: `media.engine.levels`
 * changes under a media object whose identity never does, which the React
 * Compiler would memoize stale. The engine is rebound on every loadstart, the
 * way useDecodeHealth tracks it. Empty for native HLS and direct files, which
 * have no hls.js engine, so their rows carry no tags.
 */
export default function useRenditionTraits() {
  const media = Player.useMedia()

  const subscribe = useCallback(
    (onChange) => {
      if (!media) return () => {}
      let engine = null
      const bind = () => {
        const next = media.engine ?? null
        if (next === engine) return
        engine?.off('hlsManifestParsed', onChange)
        engine?.off('hlsLevelsUpdated', onChange)
        engine = next
        engine?.on('hlsManifestParsed', onChange)
        engine?.on('hlsLevelsUpdated', onChange)
        onChange()
      }
      bind()
      media.addEventListener('loadstart', bind)
      return () => {
        media.removeEventListener('loadstart', bind)
        engine?.off('hlsManifestParsed', onChange)
        engine?.off('hlsLevelsUpdated', onChange)
      }
    },
    [media]
  )

  return useSyncExternalStore(
    subscribe,
    () => traitsOf(media?.engine?.levels),
    () => NONE
  )
}
