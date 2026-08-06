/**
 * Singleton loader for the YouTube IFrame Player API.
 *
 * The API script may already be loading (or another consumer may have started
 * it), so the module keeps one shared promise and chains any pre-existing
 * `onYouTubeIframeAPIReady` handler instead of clobbering it.
 */

const LOAD_TIMEOUT_MS = 10000

let apiPromise = null

export function loadYouTubeAPI() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('YouTube IFrame API requires a browser'))
  }
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (apiPromise) return apiPromise

  apiPromise = new Promise((resolve, reject) => {
    const previousHandler = window.onYouTubeIframeAPIReady
    let settled = false

    // Ad blockers commonly block the script silently — surface that as a
    // rejection so callers can fall back to still imagery instead of hanging.
    const timeoutId = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error('Timed out loading the YouTube IFrame API'))
    }, LOAD_TIMEOUT_MS)

    window.onYouTubeIframeAPIReady = () => {
      if (typeof previousHandler === 'function') previousHandler()
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      resolve(window.YT)
    }

    const existing = document.querySelector('script[src*="youtube.com/iframe_api"]')
    if (!existing) {
      const script = document.createElement('script')
      script.src = 'https://www.youtube.com/iframe_api'
      script.async = true
      script.onerror = () => {
        if (settled) return
        settled = true
        clearTimeout(timeoutId)
        reject(new Error('Failed to load the YouTube IFrame API'))
      }
      document.head.appendChild(script)
    }
  })

  return apiPromise
}
