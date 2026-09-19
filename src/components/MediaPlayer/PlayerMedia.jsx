'use client'

import { HlsJsVideo, NativeHlsVideo } from './videojs'
import useIsCasting from './useIsCasting'
import { useEffect, useState } from 'react'
import { buildHlsPlaybackConfig } from './hlsPlaybackConfig'
import {
  nextRetryDelay,
  probeThumbnailUrl,
  resetThumbnailStatus,
  setThumbnailStatus,
} from './thumbnailStatus'

/** Whether a source is an HLS manifest rather than a progressive file. */
export function isManifestSource(url) {
  return /\.m3u8($|\?)/i.test(url || '')
}

const CONTAINER_MIME = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/mp4',
  webm: 'video/webm',
}

/**
 * MIME type for a source, for the Cast load request.
 *
 * The sender only infers a content type for HLS; a progressive file is sent
 * with an empty one, leaving the receiver to guess. Returns undefined for
 * anything unrecognised so the receiver keeps its own inference.
 */
export function castContentType(url) {
  if (isManifestSource(url)) return 'application/x-mpegURL'
  const ext = (url || '').split(/[?#]/)[0].split('.').pop()?.toLowerCase()
  return CONTAINER_MIME[ext]
}

/**
 * The media element for the main player: <HlsJsVideo> for JIT .m3u8 manifests
 * (hls.js-powered — full quality/audio menus in every browser, matching the
 * old forced-hls.js behavior), plain <Video> for direct files.
 *
 * All text tracks are native <track> children driven by React state:
 *  - chapters VTT → store.chaptersCues (chapter menu, seekbar ticks, titles)
 *  - sprite VTT (kind=metadata label=thumbnails) → Slider.Thumbnail previews
 *  - caption tracks; auto-generated ones first (menu order) with a nonce
 *    appended to the src after generation succeeds so the browser refetches.
 */
export default function PlayerMedia({
  videoURL,
  chaptersURL,
  thumbnailsURL,
  captions,
  nonces = {},
  onEnded,
  // Owned by MainVideoPlayer (teardown + visibility-pause + heartbeat gating).
  videoRef,
  // The receiver is already playing this title, so the local element must not
  // start alongside it — see MainVideoPlayer.
  suppressAutoplay = false,
  // Where playback should begin (deep link, server watch history, or local
  // storage — resolved by MainVideoPlayer). Handed to hls.js as startPosition
  // so a fresh engine starts AT the resume point instead of cold-seeking to
  // it; see hlsPlaybackConfig.js for the stall this avoids.
  resumeAt = null,
}) {
  const isManifest = isManifestSource(videoURL)
  // Once per mount: the engine is rebuilt on any config identity change, and
  // startPosition only matters at first load anyway.
  const [hlsConfig] = useState(() => buildHlsPlaybackConfig({ startPosition: resumeAt }))

  // While the receiver has this title, the local picture is not what anyone is
  // watching, so it dissolves out under the casting overlay instead of sitting
  // there as a frozen frame. Opacity only: the element must stay laid out and
  // fully functional, since the transport bridge still reads and drives it, and
  // display/visibility would take it out of the flow.
  const { isCasting } = useIsCasting(videoURL)

  // The chapter and sprite-thumbnail tracks must NOT carry `default`.
  //
  // ROOT CAUSE of the stuck buffering spinner (proven live, 2026-09-06):
  // Chromium clamps the media element's readyState to HAVE_CURRENT_DATA (2)
  // while any text track that was non-disabled when resource selection started
  // is still loading. `default` puts a track in `hidden` mode from mount, so
  // the sprite VTT — proxied through /api/authenticated/thumbnails with an
  // 8-minute ceiling — held readyState at 2 for anything from 14 s to a
  // quarter of an hour. play() in that window starts the pipeline (frames
  // even present) but the element never becomes "potentially playing": the
  // clock stays frozen, the indicator shows, heartbeats write the frozen
  // position, and everything snaps forward when the VTT finally lands.
  // Removing the loading track and nudging released readyState 2 → 4 in 53 ms.
  //
  // So both tracks mount DISABLED and are flipped to `hidden` (which is what
  // loads the VTT) only once the element reports it can play — see the effect
  // below. The store only reads cues, so `hidden` is all it ever needed.
  //
  // RETRY: chapters and sprite VTTs are generated on demand by the media
  // backend, so the first request for a fresh title can fail and succeed a
  // minute later — and a <track> that errors is terminal in every browser.
  // On `error` the src gets a retry nonce on a capped backoff, which restarts
  // the browser's track fetch. ScrubPreview retries the sprite IMAGE the same
  // way; this is the VTT.
  const [trackRetry, setTrackRetry] = useState({ chapters: 0, thumbnails: 0 })
  const withRetry = (url, n) => (n > 0 ? `${url}${url.includes('?') ? '&' : '?'}_r=${n}` : url)
  const trackEls = []
  if (chaptersURL) {
    trackEls.push(
      <track key="chapters" kind="chapters" src={withRetry(chaptersURL, trackRetry.chapters)} srcLang="en-US" />
    )
  }
  if (thumbnailsURL) {
    trackEls.push(
      <track
        key="thumbnails"
        kind="metadata"
        label="thumbnails"
        src={withRetry(thumbnailsURL, trackRetry.thumbnails)}
      />
    )
  }
  if (captions) {
    const withNonce = (url, label) => {
      const nonce = nonces[label]
      if (!nonce) return url
      return `${url}${url.includes('?') ? '&' : '?'}_t=${nonce}`
    }
    // Auto-generated tracks mount FIRST so they appear before human captions
    // in track order. Default selection is applied by CaptionPreferenceManager.
    for (const [label, entry] of Object.entries(captions).filter(([, c]) => c?.autoGenerated)) {
      trackEls.push(
        <track
          key={`auto-${label}`}
          kind="subtitles"
          src={withNonce(entry.url, label)}
          label={label}
          srcLang={entry.srcLang}
        />
      )
    }
    for (const [label, entry] of Object.entries(captions).filter(([, c]) => !c?.autoGenerated)) {
      trackEls.push(
        <track
          key={`sub-${label}`}
          kind="subtitles"
          src={entry.url}
          label={label}
          srcLang={entry.srcLang}
        />
      )
    }
  }

  // Enable the chapter/thumbnail tracks only once the element can play, and
  // park them again whenever resource selection restarts (`loadstart` /
  // `emptied` — e.g. the framework re-attaching the engine), so a still-loading
  // VTT can never be captured into Chromium's readiness gate. Captions are
  // left alone: CaptionPreferenceManager enables them after mount, they load
  // in well under a second, and a viewer needs them showing.
  useEffect(() => {
    const el = videoRef?.current
    if (!el) return undefined
    const HAVE_FUTURE_DATA = 3
    const apply = () => {
      const mode = el.readyState >= HAVE_FUTURE_DATA ? 'hidden' : 'disabled'
      for (const t of el.querySelectorAll('track[kind="chapters"], track[kind="metadata"]')) {
        if (t.track && t.track.mode !== mode) t.track.mode = mode
      }
    }
    apply()
    const events = ['canplay', 'canplaythrough', 'loadstart', 'emptied']
    for (const ev of events) el.addEventListener(ev, apply)
    return () => {
      for (const ev of events) el.removeEventListener(ev, apply)
    }
  }, [videoRef, chaptersURL, thumbnailsURL])

  // Retry a VTT that failed to load — but classify first. A <track> error
  // says nothing about WHY; a short probe of the same URL does (200 it
  // exists now / 202 generating / 404 never / 5xx failed / hang = generating
  // right now). The result drives both the schedule here and the copy in
  // ScrubPreview through the thumbnailStatus store, so the box only spins
  // while something is actually being made. Chapters get the simpler
  // backoff: nothing reads their status.
  useEffect(() => {
    const el = videoRef?.current
    if (!el) return undefined
    const CHAPTER_DELAYS = [3_000, 6_000, 12_000, 24_000, 45_000, 60_000]
    const MAX_CHAPTER = 12
    const timers = new Map()
    let cancelled = false

    // Thumbnails: a probe loop, not a track loop. Each cycle probes the URL
    // (cheap; 202 carries progress), and only when the probe says the VTT
    // exists does the <track> get a fresh nonce and refetch. While the
    // backend is generating, every poll updates the progress the preview
    // shows; a real failure backs off slowly; 404 stops for good.
    let thumbAttempts = { failed: 0, network: 0 }
    let generatingSince = 0
    // Hysteresis: one failed probe must not flip the box to "unavailable".
    // A backend restart, a proxy hiccup or a dropped connection all read as a
    // single 5xx/network verdict, and in production that flashed "Previews
    // unavailable" over a title that was mid-generation a second earlier.
    // The first TRANSIENT_GRACE consecutive failures keep the "preparing"
    // state and re-probe quickly; only a run of failures is reported.
    const TRANSIENT_GRACE = 3
    const TRANSIENT_DELAYS_MS = [5_000, 10_000, 15_000]
    let consecutiveFailures = 0
    const thumbCycle = async (trackEl) => {
      if (cancelled || timers.has('thumbnails')) return
      const src = trackEl.getAttribute('src')
      const v = await probeThumbnailUrl(src)
      if (cancelled) return
      if (v.state === 'generating' && !generatingSince) generatingSince = Date.now()
      if (v.state !== 'generating') generatingSince = 0

      const isFailure = v.state === 'failed' || v.state === 'network'
      consecutiveFailures = isFailure ? consecutiveFailures + 1 : 0
      if (isFailure && consecutiveFailures <= TRANSIENT_GRACE) {
        // Keep whatever the viewer was already seeing; do not reset progress.
        setThumbnailStatus({ state: 'generating' })
        timers.set(
          'thumbnails',
          setTimeout(() => {
            timers.delete('thumbnails')
            thumbCycle(trackEl)
          }, Math.max(TRANSIENT_DELAYS_MS[Math.min(consecutiveFailures - 1, TRANSIENT_DELAYS_MS.length - 1)], v.retryAfterMs ?? 0))
        )
        return
      }

      setThumbnailStatus({
        state: v.state,
        retryAfterMs: v.retryAfterMs,
        progress: v.progress,
        step: v.step,
        totalSteps: v.totalSteps,
        message: v.message,
      })
      if (v.state === 'ready') {
        // Exists now: make the <track> fetch it (a new src restarts the load).
        setTrackRetry((p) => ({ ...p, thumbnails: p.thumbnails + 1 }))
        return
      }
      const attempts = v.state === 'failed' ? thumbAttempts.failed : v.state === 'network' ? thumbAttempts.network : 0
      const sinceMs = generatingSince ? Date.now() - generatingSince : 0
      const delay = nextRetryDelay(v.state, attempts, sinceMs, v.retryAfterMs)
      if (delay === null) {
        if (v.state !== 'gone') setThumbnailStatus({ state: 'exhausted' })
        return
      }
      if (v.state === 'failed') thumbAttempts.failed += 1
      if (v.state === 'network') thumbAttempts.network += 1
      timers.set(
        'thumbnails',
        setTimeout(() => {
          timers.delete('thumbnails')
          thumbCycle(trackEl)
        }, delay)
      )
    }

    const scheduleChapters = () => {
      if (timers.has('chapters')) return
      setTrackRetry((prev) => {
        const n = prev.chapters
        if (n >= MAX_CHAPTER) return prev
        timers.set(
          'chapters',
          setTimeout(() => {
            timers.delete('chapters')
            setTrackRetry((p) => ({ ...p, chapters: p.chapters + 1 }))
          }, CHAPTER_DELAYS[Math.min(n, CHAPTER_DELAYS.length - 1)])
        )
        return prev
      })
    }

    const onError = (event) => {
      const t = event.target
      if (t?.kind === 'metadata') thumbCycle(t)
      else if (t?.kind === 'chapters') scheduleChapters()
    }
    const onLoad = (event) => {
      if (event.target?.kind === 'metadata') {
        setThumbnailStatus({ state: 'ready', progress: null, message: null })
        thumbAttempts = { failed: 0, network: 0 }
      }
    }
    // `error`/`load` on a <track> do not bubble; listen on each element.
    const tracks = [...el.querySelectorAll('track[kind="chapters"], track[kind="metadata"]')]
    for (const t of tracks) {
      t.addEventListener('error', onError)
      t.addEventListener('load', onLoad)
    }
    const thumbTrack = tracks.find((t) => t.kind === 'metadata')
    if (thumbTrack && trackRetry.thumbnails === 0) setThumbnailStatus({ state: 'loading' })
    return () => {
      cancelled = true
      for (const t of tracks) {
        t.removeEventListener('error', onError)
        t.removeEventListener('load', onLoad)
      }
      for (const id of timers.values()) clearTimeout(id)
    }
  }, [videoRef, chaptersURL, thumbnailsURL, trackRetry])

  // Leaving a title (or switching its VTT) forgets its verdict. Reset on
  // cleanup only: the retry effect above sets 'loading' on mount and must not
  // be clobbered by an effect declared after it.
  useEffect(() => () => resetThumbnailStatus(), [thumbnailsURL])

  const commonProps = {
    autoPlay: !suppressAutoplay,
    playsInline: true,
    preload: 'auto',
    onEnded,
    className: `h-screen min-h-screen w-full transition-opacity duration-700 ease-out ${
      isCasting ? 'opacity-0' : 'opacity-100'
    }`,
  }

  return isManifest ? (
    <HlsJsVideo
      ref={videoRef}
      src={videoURL}
      config={hlsConfig}
      streamType="on-demand"
      {...commonProps}
    >
      {trackEls}
    </HlsJsVideo>
  ) : (
    // NativeHlsVideo, not a plain <Video>: for a non-manifest source it is just
    // `target.src = src` with no hls.js engine, but it IS a media host, which
    // is what lets <GoogleCast> register and cast to our own receiver.
    <NativeHlsVideo ref={videoRef} src={videoURL} streamType="on-demand" {...commonProps}>
      {trackEls}
    </NativeHlsVideo>
  )
}
