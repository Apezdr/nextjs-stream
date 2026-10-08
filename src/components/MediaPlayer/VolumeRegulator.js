'use client'
import { useEffect, useRef } from 'react'
import { Player } from './videojs'
import { useCastOwnsVolume } from './CastVolume'

const STORAGE_KEY = 'videoVolumeMedia'

function readStoredVolume() {
  try {
    const v = parseFloat(localStorage.getItem(STORAGE_KEY))
    return Number.isFinite(v) && v >= 0 && v <= 1 ? v : null
  } catch {
    return null
  }
}

/**
 * Restores the viewer's volume and persists changes to it.
 *
 * The restore happens on the ELEMENT, the moment it exists — not on the
 * store after `started`. Waiting for `started` meant the first audio of
 * every title played at the element default of 1.0 for a beat before being
 * turned down, which is exactly the burst a viewer notices. The store's
 * volume feature reads the element at attach and on `volumechange`, so
 * setting `media.target.volume` early is the source of truth flowing the
 * right way; `store.setVolume` after `started` remains as the fallback for
 * hosts that expose no element (Cast) or platforms where the element ignores
 * writes until later.
 *
 * Stands down while the volume belongs to a Cast receiver (useCastOwnsVolume):
 * the store's volume is then the TV's, so persisting it saved the TV's level
 * as the viewer's local volume (a cast at 15% made the next local title start
 * at 15%), and restoring would have set the TV to the local preference. The
 * restore runs once the cast ends instead.
 */
const VolumeRegulator = ({ videoURL }) => {
  const store = Player.usePlayer()
  const media = Player.useMedia()
  const volume = Player.usePlayer((s) => s.volume)
  const started = Player.usePlayer((s) => s.started)
  const canSetVolume = Player.usePlayer((s) => s.volumeAvailability !== 'unavailable')
  const castOwnsVolume = useCastOwnsVolume(videoURL)
  const hasMounted = useRef(false)
  const initialVolumeSet = useRef(false)

  // Early restore: as soon as the store has a target, before playback.
  // `store.setVolume` writes through the host to the element (and throws
  // NO_TARGET before attach, which is the retry signal); the host's own
  // `loadstart` fires once it has both a target and a source.
  useEffect(() => {
    if (!store || !media || castOwnsVolume) return undefined
    const apply = () => {
      if (initialVolumeSet.current) return
      const stored = readStoredVolume()
      if (stored === null) {
        initialVolumeSet.current = true
        return
      }
      try {
        if (!store.target) return
        store.setVolume(stored)
        initialVolumeSet.current = true
      } catch {
        /* not attached yet, or the platform refuses volume writes */
      }
    }
    apply()
    media.addEventListener('loadstart', apply)
    return () => media.removeEventListener('loadstart', apply)
  }, [store, media, castOwnsVolume])

  // Fallback restore through the store once playback has started.
  useEffect(() => {
    if (started && canSetVolume && !castOwnsVolume && !initialVolumeSet.current) {
      const stored = readStoredVolume()
      if (stored !== null && stored !== volume) {
        store.setVolume(stored)
      }
      initialVolumeSet.current = true
    }
  }, [started, canSetVolume, castOwnsVolume, store, volume])

  // Persist changes made after playback started.
  useEffect(() => {
    if (hasMounted.current && started && canSetVolume && !castOwnsVolume) {
      try {
        if (String(volume) !== localStorage.getItem(STORAGE_KEY)) {
          localStorage.setItem(STORAGE_KEY, String(volume))
        }
      } catch {
        /* storage unavailable */
      }
    } else if (started) {
      hasMounted.current = true
    }
  }, [volume, canSetVolume, castOwnsVolume, started])

  return null
}

export default VolumeRegulator
