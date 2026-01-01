'use client'

import { useEffect } from 'react'

export default function SyncClientWithServerWatched({ once = false }) {
  useEffect(() => {
    // Define the function to fetch and process video watch data
    const fetchAndProcessData = () => {
      fetch('/api/authenticated/sync/pullPlayback')
        .then((response) => {
          if (!response.ok) {
            console.log(`Error Pulling Playback: ${response.status}`)
            return null
          }
          return response.json()
        })
        .then((serverData) => {
          if (serverData && serverData.length) {
            serverData.forEach((item) => {
              const { videoId, playbackTime, lastUpdated: serverLastUpdated } = item

              const localDataJSON = localStorage.getItem(videoId)
              let shouldUpdate = true

              if (localDataJSON) {
                const localData = JSON.parse(localDataJSON)

                if (
                  localData.playbackTime === playbackTime &&
                  new Date(localData.lastUpdated).getTime() ===
                    new Date(serverLastUpdated).getTime()
                ) {
                  shouldUpdate = new Date(serverLastUpdated) > new Date(localData.lastUpdated)
                }
              }

              if (shouldUpdate) {
                localStorage.setItem(
                  videoId,
                  JSON.stringify({
                    playbackTime,
                    lastUpdated: serverLastUpdated, // Use server's timestamp
                  })
                )
              }
            })
          }
        })
        .catch((error) => {
          console.error('Failed to fetch videos watched:', error)
        })
    }

    // Fetch data immediately and set up the interval
    fetchAndProcessData()
    if (once) return // If once is true, don't set up the interval
    const intervalId = setInterval(fetchAndProcessData, 5000) // Update every 5 seconds

    // Clean-up function to clear the interval when the component unmounts
    return () => clearInterval(intervalId)
  }, [once]) // Include 'once' since it's used in the effect

  return null // This component doesn't render anything
}
