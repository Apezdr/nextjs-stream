import { buildURL } from 'src/utils'

self.addEventListener('message', (e) => {
  const { videoURL, currentTime } = e.data

  fetch(buildURL('/api/authenticated/sync/updatePlayback'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      videoId: videoURL,
      playbackTime: currentTime,
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
})
