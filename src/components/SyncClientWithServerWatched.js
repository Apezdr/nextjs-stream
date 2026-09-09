'use client'

import { useRef } from 'react'
import useSWR from 'swr'

const MAX_CACHED_VIDEOS = 200 // Keep at most 200 videos in localStorage
const RETENTION_DAYS = 30 // Only sync videos updated in last 30 days
const SYNC_INTERVAL_MS = 5000 // Sync every 5 seconds

/**
 * The keys a row is mirrored under. The durable identity ('mid:…') is what
 * the posters read first (playbackStorageKey.js), so a row the TV app wrote
 * through the transcoder — whose raw videoId is a manifest URL nobody on the
 * web ever looks up — still reaches the localStorage fallback. The raw
 * videoId string stays for the legacy readers.
 */
function mirrorKeysFor(item) {
  const keys = []
  if (typeof item.mediaId === 'string' && item.mediaId.startsWith('mid:')) keys.push(item.mediaId)
  if (item.videoId) keys.push(item.videoId)
  return keys
}

function writeIfNewer(key, playbackTime, serverLastUpdated) {
  const localDataJSON = localStorage.getItem(key)
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

  if (!shouldUpdate) return false
  localStorage.setItem(
    key,
    JSON.stringify({
      playbackTime,
      lastUpdated: serverLastUpdated,
    })
  )
  return true
}

// Helper function to process and sync video data
function processSyncData(serverData) {
  if (serverData && serverData.length) {
    let updatedCount = 0

    serverData.forEach((item) => {
      const { playbackTime, lastUpdated: serverLastUpdated } = item
      let updated = false
      for (const key of mirrorKeysFor(item)) {
        if (writeIfNewer(key, playbackTime, serverLastUpdated)) updated = true
      }
      if (updated) updatedCount++
    })

    if (updatedCount > 0) {
      console.log(`[WatchHistory] Synced ${updatedCount}/${serverData.length} recent videos`)
    }

    // Clean up old entries after sync
    cleanupOldEntries()
  }
}

export default function SyncClientWithServerWatched({ once = false }) {
  // Track ETags per sync URL for efficient conditional requests
  const etagCacheRef = useRef(new Map())
  // Track the last known server data for 304 responses
  const lastServerDataRef = useRef(null)

  // Fetch and process video watch data; preserves ETag/304 conditional-request
  // behavior and performs the localStorage sync as a side effect.
  const fetchAndProcessData = async (syncUrl) => {
    try {
      // Build headers with ETag support for conditional requests
      const headers = {}
      const cachedEtag = etagCacheRef.current.get(syncUrl)
      if (cachedEtag) {
        headers['If-None-Match'] = cachedEtag
      }

      const response = await fetch(syncUrl, { headers })

      // Handle 304 Not Modified - use cached data
      if (response.status === 304) {
        const serverData = lastServerDataRef.current
        if (serverData && serverData.length > 0) {
          // Process the cached data (timestamps haven't changed)
          processSyncData(serverData)
        }
        return null
      }

      // Handle error responses
      if (!response.ok) {
        console.log(`Error Pulling Playback: ${response.status}`)
        return null
      }

      // Handle 200 OK response - cache the ETag for next request
      const etag = response.headers.get('ETag')
      if (etag && etagCacheRef?.current) {
        etagCacheRef.current?.set(syncUrl, etag)
      }

      const serverData = await response.json()

      // Cache the data for 304 responses
      lastServerDataRef.current = serverData

      processSyncData(serverData)
    } catch (error) {
      console.error('Failed to fetch videos watched:', error)
    }
    return null
  }

  // SWR fetches immediately on mount and polls every SYNC_INTERVAL_MS.
  // When `once` is true, polling is disabled (refreshInterval: 0).
  useSWR(
    `/api/authenticated/sync/pullPlayback?days=${RETENTION_DAYS}&limit=${MAX_CACHED_VIDEOS}`,
    fetchAndProcessData,
    {
      refreshInterval: once ? 0 : SYNC_INTERVAL_MS,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  )

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
    // Video URLs start with http:// or https://; durable identities with 'mid:'
    if (key && (key.startsWith('http://') || key.startsWith('https://') || key.startsWith('mid:'))) {
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
