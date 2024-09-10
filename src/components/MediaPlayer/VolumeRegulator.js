'use client'
import { useMediaPlayer, useMediaProvider, useMediaRemote, useMediaState } from '@vidstack/react'
import { useEffect, useRef } from 'react'

const VolumeRegulator = () => {
  const remote = useMediaRemote()
  const player = useMediaPlayer()
  const volume = useMediaState('volume', player)
  const canSetVolume = useMediaState('canSetVolume', player)
  const started = useMediaState('started', player)
  const hasMounted = useRef(false)
  const initialVolumeSet = useRef(false)

  useEffect(() => {
    if (started && canSetVolume && !initialVolumeSet.current) {
      const storedVolume = parseFloat(localStorage.getItem('videoVolumeMedia'))
      if (!isNaN(storedVolume) && storedVolume !== volume) {
        remote.changeVolume(storedVolume)
        initialVolumeSet.current = true
      }
    }
  }, [started, canSetVolume, remote, volume])

  useEffect(() => {
    if (hasMounted.current && started && canSetVolume) {
      if (volume !== localStorage.getItem('videoVolumeMedia')) {
        localStorage.setItem('videoVolumeMedia', volume)
      }
    } else if (started) {
      hasMounted.current = true
    }
  }, [volume, canSetVolume, started])

  return null
}

export default VolumeRegulator
