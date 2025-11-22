self.addEventListener('message', (e) => {
  const { videoURL, currentTime, mediaMetadata } = e.data

  // Workers need absolute URLs - construct from self.location.origin
  const apiUrl = `${self.location.origin}/api/authenticated/sync/updatePlayback`

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
})
