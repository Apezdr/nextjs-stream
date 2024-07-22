'use client'

import { useEffect, useRef, useState } from 'react'
import { useMediaPlayer, useMediaRemote, useMediaState } from '@vidstack/react'
import throttle from 'lodash/throttle'

export default function WithPlayBackTracker({ videoURL }) {
  const player = useMediaPlayer(),
    canPlay = useMediaState('canPlay'),
    remote = useMediaRemote()
  const [lastTimeSent, setLastTimeSent] = useState(0)
  const isFetchingRef = useRef(false)
  const nextUpdateTimeRef = useRef(null)
  const updatePlaybackWorkerRef = useRef(null)

  useEffect(() => {
    if (!canPlay || !remote) return
    const savedData = localStorage.getItem(videoURL)
    const savedTime = savedData ? parseFloat(JSON.parse(savedData).playbackTime) : null
    if (!isNaN(savedTime) && savedTime !== null) {
      remote.seek(savedTime)
    }
  }, [remote, canPlay, videoURL])

  useEffect(() => {
    // Initialize the web worker
    updatePlaybackWorkerRef.current = new Worker(
      new URL('./updatePlaybackWorker.js', import.meta.url)
    )

    updatePlaybackWorkerRef.current.addEventListener('message', (event) => {
      const { success, currentTime, error } = event.data
      if (success) {
        setLastTimeSent(currentTime)
      } else {
        console.error('Worker error:', error)
      }
      isFetchingRef.current = false
    })

    return () => {
      updatePlaybackWorkerRef.current.terminate()
    }
  }, [])

  useEffect(() => {
    if (!canPlay || !player) return

    // Modify the throttledUpdateServer function
    const throttledUpdateServer = throttle((currentTime) => {
      if (!isFetchingRef.current) {
        isFetchingRef.current = true

        localStorage.setItem(
          videoURL,
          JSON.stringify({
            playbackTime: currentTime,
            lastUpdated: new Date().toISOString(),
          })
        )

        // Send data to the worker
        updatePlaybackWorkerRef.current.postMessage({
          videoURL: videoURL,
          currentTime: currentTime,
        })
      } else {
        nextUpdateTimeRef.current = currentTime
      }
    }, 1000) // 1 second throttle time

    // Subscribe to player time updates
    const unsubscribe = player.subscribe(({ currentTime }) => {
      if (currentTime > 0) throttledUpdateServer(currentTime)
    })

    // Cleanup
    return () => {
      unsubscribe()
      throttledUpdateServer.cancel()
    }
  }, [player, videoURL, canPlay])

  return null
}
