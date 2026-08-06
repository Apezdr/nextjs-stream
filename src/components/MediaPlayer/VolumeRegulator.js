'use client'
import { useEffect, useRef } from 'react'
import { Player } from './videojs'

const VolumeRegulator = () => {
  const store = Player.usePlayer()
  const volume = Player.usePlayer((s) => s.volume)
  const started = Player.usePlayer((s) => s.started)
  const canSetVolume = Player.usePlayer((s) => s.volumeAvailability !== 'unavailable')
  const hasMounted = useRef(false)
  const initialVolumeSet = useRef(false)

  useEffect(() => {
    if (started && canSetVolume && !initialVolumeSet.current) {
      const storedVolume = parseFloat(localStorage.getItem('videoVolumeMedia'))
      if (!isNaN(storedVolume) && storedVolume !== volume) {
        store.setVolume(storedVolume)
        initialVolumeSet.current = true
      }
    }
  }, [started, canSetVolume, store, volume])

  useEffect(() => {
    if (hasMounted.current && started && canSetVolume) {
      if (String(volume) !== localStorage.getItem('videoVolumeMedia')) {
        localStorage.setItem('videoVolumeMedia', volume)
      }
    } else if (started) {
      hasMounted.current = true
    }
  }, [volume, canSetVolume, started])

  return null
}

export default VolumeRegulator
