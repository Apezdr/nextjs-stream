// Track last heartbeat time to throttle heartbeat calls (every ~30s)
let lastHeartbeatTime = 0
const HEARTBEAT_INTERVAL_MS = 30000

self.addEventListener('message', (e) => {
  const { videoURL, currentTime, mediaMetadata, duration, action } = e.data

  // Workers need absolute URLs - construct from self.location.origin
  const apiUrl = `${self.location.origin}/api/authenticated/sync/updatePlayback`
  const heartbeatUrl = `${self.location.origin}/api/authenticated/sync/heartbeat`

  // Handle explicit stop action (player unmounting)
  if (action === 'stop') {
    fetch(heartbeatUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId: videoURL,
        action: 'stop',
      }),
    }).catch(() => {}) // Best-effort, don't block on errors
    return
  }

  // Send playback update (every call)
  fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      videoId: videoURL,
      playbackTime: currentTime,
      mediaMetadata: mediaMetadata,
    }),
  })
    .then((response) => {
      if (response.ok) {
        self.postMessage({ success: true, currentTime })
      } else {
        throw new Error('Network response not ok')
      }
    })
    .catch((error) => {
      self.postMessage({ success: false, error: error.message })
    })

  // Send heartbeat for active session tracking (throttled to every ~30s)
  const now = Date.now()
  if (now - lastHeartbeatTime >= HEARTBEAT_INTERVAL_MS) {
    lastHeartbeatTime = now

    fetch(heartbeatUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId: videoURL,
        playbackTime: currentTime,
        duration: duration || null,
        mediaMetadata: mediaMetadata,
        action: 'heartbeat',
      }),
    }).catch(() => {}) // Best-effort, don't block on errors
  }
})
