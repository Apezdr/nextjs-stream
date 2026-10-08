'use client'

import { useCallback, useSyncExternalStore } from 'react'
import { Player } from './videojs'
import { audioDefaultsFromTracks, traitsFromLevels } from './renditionTraits'

const NO_TRAITS = new Map()
const NO_DEFAULTS = new Set()

const LEVEL_EVENTS = ['hlsManifestParsed', 'hlsLevelsUpdated']
const AUDIO_EVENTS = ['hlsManifestParsed', 'hlsAudioTracksUpdated']

// One derived value per hls.js array. hls.js swaps in a new array when it
// parses or drops levels or switches audio group, so the array's identity is
// the snapshot's version.
const levelCache = new WeakMap()
const audioCache = new WeakMap()

function derive(source, cache, fn, empty) {
  if (!source) return empty
  let value = cache.get(source)
  if (!value) {
    value = fn(source)
    cache.set(source, value)
  }
  return value
}

/**
 * Something derived from the hls.js engine, kept current through its events.
 *
 * An external store rather than a render-time read: `media.engine` changes
 * under a media object whose identity never does, which the React Compiler
 * would memoize stale. The engine is rebound on every loadstart, the way
 * useDecodeHealth tracks it. Native HLS and direct files have no hls.js
 * engine, so they get the empty value.
 */
function useEngineDerived(events, getSnapshot, empty) {
  const media = Player.useMedia()

  const subscribe = useCallback(
    (onChange) => {
      if (!media) return () => {}
      let engine = null
      const unbind = () => {
        for (const event of events) engine?.off(event, onChange)
      }
      const bind = () => {
        const next = media.engine ?? null
        if (next === engine) return
        unbind()
        engine = next
        for (const event of events) engine?.on(event, onChange)
        onChange()
      }
      bind()
      media.addEventListener('loadstart', bind)
      return () => {
        media.removeEventListener('loadstart', bind)
        unbind()
      }
    },
    [media, events]
  )

  return useSyncExternalStore(subscribe, () => getSnapshot(media?.engine), () => empty)
}

/** Per-rendition traits (dynamic range, Original). See renditionTraits.js. */
export default function useRenditionTraits() {
  return useEngineDerived(
    LEVEL_EVENTS,
    (engine) => derive(engine?.levels, levelCache, traitsFromLevels, NO_TRAITS),
    NO_TRAITS
  )
}

/** Keys (audioTrackKey) of the audio tracks the master marks DEFAULT=YES. */
export function useAudioDefaults() {
  return useEngineDerived(
    AUDIO_EVENTS,
    (engine) => derive(engine?.audioTracks, audioCache, audioDefaultsFromTracks, NO_DEFAULTS),
    NO_DEFAULTS
  )
}
