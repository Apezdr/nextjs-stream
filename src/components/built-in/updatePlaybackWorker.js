self.addEventListener('message', (e) => {
  const { videoURL, currentTime, mediaMetadata, isPaused, localIp, sessionId, kind, headers } = e.data

  // Workers need absolute URLs - construct from self.location.origin
  const apiUrl = `${self.location.origin}/api/authenticated/sync/updatePlayback`

  // A keep-alive is the paused device saying "still here". It carries NO
  // position: the server refreshes presence and leaves the stored resume
  // point alone, so an idle paused tab never drags the row back over
  // progress made on another device. Every other kind carries the position.
  const writeKind = kind || 'progress'
  const carriesPosition = writeKind !== 'keepalive'

  fetch(apiUrl, {
    method: 'POST',
    // From the tracker (playbackWriteHeaders): JSON, and the user the page was
    // rendered for, which the server checks against the session
    // (src/lib/playbackUser.ts). Without it the write is refused.
    headers: { 'Content-Type': 'application/json', ...(headers || {}) },
    body: JSON.stringify({
      videoId: videoURL,
      ...(carriesPosition ? { playbackTime: currentTime } : {}),
      kind: writeKind,
      mediaMetadata: mediaMetadata,
      isPaused: isPaused === true,
      ...(localIp ? { localIp } : {}),
      sessionId: sessionId || null,
    }),
  })
    .then((response) => {
      if (response.ok) {
        self.postMessage({ success: true, currentTime, kind: writeKind })
      } else {
        throw new Error('Network response not ok')
      }
    })
    .catch((error) => {
      self.postMessage({ success: false, error: error.message, kind: writeKind })
    })
})
