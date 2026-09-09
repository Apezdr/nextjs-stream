'use client'

import { useEffect } from 'react'

/**
 * Never start playback on a cold element.
 *
 * Reproduced live, on BOTH transports (hls.js/MSE and a progressive MKV), so
 * this is Chrome, not the origin: call `play()` while readyState is 2 and the
 * media clock does not start. `currentTime` stays pinned, readyState stays 2,
 * the buffering indicator (correctly) shows — yet frames ARE presented
 * (`requestVideoFrameCallback` mediaTime advances at 1×), and every heartbeat
 * during the hold writes the frozen position over the real resume point.
 * The hold lasts 14 s to over a minute, then `currentTime` snaps forward to
 * wherever the picture had reached. Calling `play()` once readyState is ≥ 3
 * never stalled in any capture.
 *
 * Several callers can issue that early `play()`: the Cast-hint "guess undone"
 * path, the preview-coordinator resume, the framework's togglePaused on a
 * tap, and whatever autoplay does in a given browser. Rather than chase each,
 * this shadows the ELEMENT's `play()` so every caller is deferred the same
 * way: below HAVE_FUTURE_DATA the call is held and released on `canplay`
 * (or when a poll sees readyState rise, in case the event was missed); a
 * `pause()` in the meantime cancels the pending start. The returned promise
 * settles with the eventual native result, so callers' `.catch(() => {})`
 * keep working and autoplay-policy rejections still surface to them.
 *
 * Activation: a user gesture grants the document sticky activation, and
 * Chrome permits later programmatic play on that document, so deferring past
 * `canplay` does not lose the right to play. Sites where autoplay was allowed
 * with no gesture keep that allowance too.
 *
 * Instance-level shadowing, restored on unmount, so nothing outside this
 * element is touched.
 *
 * @param {{current: HTMLMediaElement|null}} videoRef
 * @param {{enabled?: boolean}} [opts]
 */

const HAVE_FUTURE_DATA = 3
const POLL_MS = 250

export default function usePlayWhenReady(videoRef, { enabled = true } = {}) {
  useEffect(() => {
    const el = videoRef?.current
    if (!enabled || !el || typeof el.play !== 'function') return undefined
    if (el.__playWhenReadyInstalled) return undefined

    const nativePlay = el.play
    const nativePause = el.pause
    let pending = null // { resolve, reject, cleanup }

    // The deferred state is visible to the page: PlaybackStatusOverlay reads
    // `data-play-pending` so a viewer who pressed play on a cold element sees
    // "starting" rather than nothing.
    const markPending = (on) => {
      try {
        if (on) el.dataset.playPending = '1'
        else delete el.dataset.playPending
        el.dispatchEvent(new CustomEvent(on ? 'playpending' : 'playreleased'))
      } catch {
        /* detached */
      }
    }

    const cancelPending = (reason) => {
      if (!pending) return
      const p = pending
      pending = null
      p.cleanup()
      markPending(false)
      // Mirror the native contract for an interrupted play(): reject with
      // AbortError, which every caller here already swallows.
      const err = new DOMException(reason, 'AbortError')
      p.reject(err)
    }

    const deferredPlay = function play() {
      if (this.readyState >= HAVE_FUTURE_DATA || this.ended) {
        return nativePlay.call(this)
      }
      if (pending) return pending.promise

      let resolve
      let reject
      const promise = new Promise((res, rej) => {
        resolve = res
        reject = rej
      })
      // Swallow at the promise level so a cancelled deferral is never an
      // unhandled rejection when the caller did not attach a catch.
      promise.catch(() => {})

      const release = () => {
        if (!pending) return
        const p = pending
        pending = null
        p.cleanup()
        markPending(false)
        nativePlay.call(this).then(p.resolve, p.reject)
      }
      const onReady = () => {
        if (this.readyState >= HAVE_FUTURE_DATA) release()
      }
      const poll = setInterval(onReady, POLL_MS)
      this.addEventListener('canplay', onReady)
      this.addEventListener('canplaythrough', onReady)
      this.addEventListener('emptied', () => cancelPending('source changed'), { once: true })
      const cleanup = () => {
        clearInterval(poll)
        this.removeEventListener('canplay', onReady)
        this.removeEventListener('canplaythrough', onReady)
      }
      pending = { promise, resolve, reject, cleanup }
      markPending(true)

      if (typeof window !== 'undefined' && window.__playbackDiag?.events) {
        window.__playbackDiag.events.push({
          kind: 'play:deferred',
          t: 0,
          readyState: this.readyState,
          currentTime: Number(this.currentTime.toFixed(2)),
        })
      }
      return promise
    }

    const guardedPause = function pause() {
      cancelPending('paused before playback could start')
      return nativePause.call(this)
    }

    el.play = deferredPlay
    el.pause = guardedPause
    el.__playWhenReadyInstalled = true

    return () => {
      cancelPending('element released')
      if (el.play === deferredPlay) delete el.play
      if (el.pause === guardedPause) delete el.pause
      delete el.__playWhenReadyInstalled
    }
  }, [videoRef, enabled])
}
