'use client'

import { useEffect } from 'react'

const MAX_CACHED_VIDEOS = 200 // Keep at most 200 videos in localStorage
const RETENTION_DAYS = 30 // Only sync videos updated in last 30 days
const SYNC_INTERVAL_MS = 5000 // Sync every 5 seconds

export default function SyncClientWithServerWatched({ once = false }) {
  useEffect(() => {
    // Define the function to fetch and process video watch data
    const fetchAndProcessData = () => {
      // Only fetch videos updated in last 30 days, max 200 items
      fetch(`/api/authenticated/sync/pullPlayback?days=${RETENTION_DAYS}&limit=${MAX_CACHED_VIDEOS}`)
        .then((response) => {
          if (!response.ok) {
            console.log(`Error Pulling Playback: ${response.status}`)
            return null
          }
          return response.json()
        })
        .then((serverData) => {
          if (serverData && serverData.length) {
            let updatedCount = 0
            
            serverData.forEach((item) => {
              const { videoId, playbackTime, lastUpdated: serverLastUpdated } = item

              const localDataJSON = localStorage.getItem(videoId)
              let shouldUpdate = true

              if (localDataJSON) {
                try {
                  const localData = JSON.parse(localDataJSON)

                  // Only update if server timestamp is newer
                  const serverTime = new Date(serverLastUpdated).getTime()
                  const localTime = new Date(localData.lastUpdated).getTime()
                  shouldUpdate = serverTime > localTime
                } catch (e) {
                  // Invalid local data, will overwrite
                  shouldUpdate = true
                }
              }

              if (shouldUpdate) {
                localStorage.setItem(
                  videoId,
                  JSON.stringify({
                    playbackTime,
                    lastUpdated: serverLastUpdated,
                  })
                )
                updatedCount++
              }
            })
            
            if (updatedCount > 0) {
              console.log(`[WatchHistory] Synced ${updatedCount}/${serverData.length} recent videos`)
            }
            
            // Clean up old entries after sync
            cleanupOldEntries()
          }
        })
        .catch((error) => {
          console.error('Failed to fetch videos watched:', error)
        })
    }

    // Fetch data immediately and set up the interval
    fetchAndProcessData()
    if (once) return // If once is true, don't set up the interval
    const intervalId = setInterval(fetchAndProcessData, SYNC_INTERVAL_MS)

    // Clean-up function to clear the interval when the component unmounts
    return () => clearInterval(intervalId)
  }, [once]) // Include 'once' since it's used in the effect

  return null // This component doesn't render anything
}

/**
 * Clean up old localStorage entries to prevent unlimited growth
 * Removes entries older than RETENTION_DAYS or keeps only MAX_CACHED_VIDEOS most recent
 */
function cleanupOldEntries() {
  const cutoffDate = Date.now() - (RETENTION_DAYS * 24 * 60 * 60 * 1000)
  const entries = []
  
  // Collect all watch history entries from localStorage
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    // Video URLs typically start with http:// or https://
    if (key && (key.startsWith('http://') || key.startsWith('https://'))) {
      try {
        const data = JSON.parse(localStorage.getItem(key))
        if (data.lastUpdated) {
          entries.push({
            key,
            lastUpdated: new Date(data.lastUpdated).getTime()
          })
        } else {
          // No timestamp, mark for removal
          entries.push({ key, lastUpdated: 0 })
        }
      } catch (e) {
        // Invalid JSON, mark for removal
        entries.push({ key, lastUpdated: 0 })
      }
    }
  }
  
  // Sort by lastUpdated (oldest first)
  entries.sort((a, b) => a.lastUpdated - b.lastUpdated)
  
  // Remove entries that are old OR exceed our limit
  let removed = 0
  for (const entry of entries) {
    const isOld = entry.lastUpdated < cutoffDate
    const exceedsLimit = entries.length - removed > MAX_CACHED_VIDEOS
    
    if (isOld || exceedsLimit) {
      localStorage.removeItem(entry.key)
      removed++
    } else {
      // Remaining entries are newer and within limit
      break
    }
  }
  
  if (removed > 0) {
    console.log(`[WatchHistory] Cleaned up ${removed} old entries, ${entries.length - removed} remaining`)
  }
}
