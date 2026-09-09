/**
 * Full-player VOD policy. Keep this object stable: changing engine options
 * causes Video.js to recreate HLS.js. Preview players keep their own defaults.
 */
export const HLS_PLAYBACK_CONFIG = Object.freeze({
  hlsJs: Object.freeze({
    // Choose an adaptive start from a 5 Mbps estimate, not a fixed level
    // index (the ladder varies by title). Do not download a lowest-tier probe
    // first: a cold JIT encode measures origin latency as well as the link.
    startLevel: -1,
    testBandwidth: false,
    abrEwmaDefaultEstimate: 5_000_000,

    // Recover from a pessimistic sample faster; retain bandwidth headroom
    // and HLS.js's normal downgrade/emergency-abandon logic.
    abrEwmaFastVoD: 2,
    abrEwmaSlowVoD: 4,
    abrBandWidthUpFactor: 0.85,

    // An unbuffered seek can hit an encode-on-demand segment. Allow more
    // loading time before choosing the floor; HLS.js also caps this allowance
    // to the current fragment duration. This does not change request timeouts.
    maxStarvationDelay: 8,
    maxLoadingDelay: 8,

    // A narrow browser pane must not lock Auto to SD. Bandwidth, codec
    // support and Video.js's FPS-drop protection still constrain selection.
    capLevelToPlayerSize: false,

    // The transcoder sends NO bytes until a segment exists, so time-to-first-
    // byte IS the encode time. hls.js's default 10 s TTFB budget aborted a
    // cold segment mid-encode in live testing (fragLoadTimeOut at ~10 s, then
    // an immediate refetch of work the server was still doing). 30 s sits
    // just above the server's own 27 s encode-stall watchdog, so the server
    // always decides first. hls.js merges load policies by shallow spread, so
    // the whole object must be supplied — the other values are its defaults.
    fragLoadPolicy: Object.freeze({
      default: Object.freeze({
        maxTimeToFirstByteMs: 30_000,
        maxLoadTimeMs: 120_000,
        timeoutRetry: Object.freeze({ maxNumRetry: 4, retryDelayMs: 0, maxRetryDelayMs: 0 }),
        errorRetry: Object.freeze({ maxNumRetry: 6, retryDelayMs: 1000, maxRetryDelayMs: 8000 }),
      }),
    }),
  }),
})

/**
 * The per-mount config: the shared policy above plus `startPosition`, the
 * fix for the cold-start resume stall.
 *
 * Reproduced live (2026-09-06): resuming a title on a FRESH hls.js engine by
 * seeking the media element during cold start leaves Chrome holding
 * readyState at 2 for 14-24 s — the buffer covers the playhead and frames
 * even present, but the media clock does not start until it snaps forward
 * later. Nudging it made it worse. With `startPosition`, hls.js loads the
 * first fragment AT the resume point and seeks only once that fragment is
 * buffered (`seekToStartPos`), so the element starts cleanly at the resume
 * point and there is no cold seek at all. It also removes the abandoned
 * segment-0 fan-out the transcoder measured at ~7 s → 15 s.
 *
 * Build this ONCE per mount (useState initializer): the framework rebuilds
 * the engine whenever the config object's shallow identity changes.
 *
 * @param {{startPosition?: number|null}} [opts]
 */
export function buildHlsPlaybackConfig({ startPosition = null } = {}) {
  const start = Number.isFinite(startPosition) && startPosition > 0 ? startPosition : -1
  if (start < 0) return HLS_PLAYBACK_CONFIG
  return Object.freeze({
    ...HLS_PLAYBACK_CONFIG,
    hlsJs: Object.freeze({ ...HLS_PLAYBACK_CONFIG.hlsJs, startPosition: start }),
  })
}
