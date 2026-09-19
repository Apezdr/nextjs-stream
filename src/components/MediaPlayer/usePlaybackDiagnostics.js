'use client'

import { useEffect } from 'react'
import { isManifestSource } from './PlayerMedia'

/**
 * Playback diagnostics — the instrumentation that decides the spinner fix.
 *
 * The buffering indicator is `store.waiting && !store.paused`, and `waiting`
 * is `readyState < 3 && !paused` read through the media HOST, whose getters
 * resolve through a component-override chain. Reading source could not settle
 * which of three inputs makes it stick:
 *
 *   A  an overridden getter — host.readyState !== element.readyState
 *   B  a truthful stall — element.readyState < 3, or the clock stopped
 *   C  a frozen picture with a running clock — no frames presented while
 *      currentTime advances and readyState stays >= 3
 *
 * So this records all three at once, keyed to the one thing the viewer
 * actually sees: the indicator's `data-visible` attribute. Every show/hide
 * transition logs a snapshot of element, host and store side by side, plus a
 * classification; while visible it re-snapshots every few seconds; and the
 * non-fatal hls.js traffic the framework discards (`if (!data.fatal) return`)
 * is logged too, because a 7 s cold encode and a dead transcoder look the
 * same from the element and different from the network.
 *
 * Nothing here changes behaviour. Output goes to the console under
 * `[playback-diag]` and to `window.__playbackDiag` (a ring buffer with
 * `.dump()` and `.now()`), so a stuck spinner can be inspected after the
 * fact. On by default outside production; in production set
 * `localStorage.playbackDiag = '1'`.
 */

const TICK_MS = 250
const RESNAPSHOT_MS = 5_000
const CLOCK_STALL_MS = 700
const FRAME_STALL_MS = 1_000
const SLOW_FRAG_MS = 3_000
const RING_SIZE = 600
const HAVE_FUTURE_DATA = 3

function enabled() {
  if (typeof window === 'undefined') return false
  if (process.env.NODE_ENV !== 'production') return true
  try {
    return window.localStorage.getItem('playbackDiag') === '1'
  } catch {
    return false
  }
}

function ring() {
  const events = []
  const push = (event) => {
    events.push(event)
    if (events.length > RING_SIZE) events.splice(0, events.length - RING_SIZE)
  }
  return { events, push }
}

/** Store state reads throw NO_TARGET before attach; never let that surface. */
function safeStore(store) {
  try {
    if (!store?.target) return { attached: false }
    return {
      attached: true,
      waiting: store.waiting,
      paused: store.paused,
      started: store.started,
      canPlay: store.canPlay,
      remotePlaybackState: store.remotePlaybackState ?? null,
    }
  } catch {
    return { attached: false }
  }
}

export default function usePlaybackDiagnostics({ store, media, videoURL, spinnerRef, isCasting }) {
  useEffect(() => {
    if (!enabled() || !store || !media) return undefined

    const log = ring()
    const t0 = performance.now()
    const stamp = () => Math.round(performance.now() - t0)

    // ---- element-level watchdogs --------------------------------------
    let el = null
    let lastClockTime = NaN
    let clockUnchangedSince = 0
    let lastFrameAt = 0
    let lastFrameMediaTime = NaN
    let rvfcHandle = 0
    let rvfcSupported = false

    const armFrameCallback = () => {
      if (!el || typeof el.requestVideoFrameCallback !== 'function') return
      rvfcSupported = true
      rvfcHandle = el.requestVideoFrameCallback((now, meta) => {
        lastFrameAt = now
        lastFrameMediaTime = meta?.mediaTime ?? NaN
        armFrameCallback()
      })
    }
    const disarmFrameCallback = () => {
      if (el && rvfcHandle && typeof el.cancelVideoFrameCallback === 'function') {
        el.cancelVideoFrameCallback(rvfcHandle)
      }
      rvfcHandle = 0
    }

    const bindElement = () => {
      const next = media.target ?? null
      if (next === el) return
      disarmFrameCallback()
      el = next
      lastClockTime = NaN
      clockUnchangedSince = 0
      lastFrameAt = 0
      armFrameCallback()
    }

    // ---- snapshot + classification ------------------------------------
    const snapshot = () => {
      const now = performance.now()
      const s = safeStore(store)
      const elementState = el
        ? {
            readyState: el.readyState,
            paused: el.paused,
            ended: el.ended,
            currentTime: Number(el.currentTime.toFixed(3)),
            duration: el.duration,
            networkState: el.networkState,
            buffered: bufferedRanges(el),
          }
        : null
      let hostReadyState = null
      let hostPaused = null
      try {
        hostReadyState = media.readyState
        hostPaused = media.paused
      } catch {
        /* pre-attach */
      }

      const clockFrozenMs =
        el && !el.paused && clockUnchangedSince ? Math.round(now - clockUnchangedSince) : 0
      const frameStalledMs =
        el && !el.paused && rvfcSupported && lastFrameAt ? Math.round(now - lastFrameAt) : 0

      const flags = []
      if (el && hostReadyState !== null && hostReadyState !== el.readyState) flags.push('A:host≠element')
      if (el && !el.paused && el.readyState < HAVE_FUTURE_DATA) flags.push('B:readyState<3')
      if (clockFrozenMs > CLOCK_STALL_MS) flags.push('B:clock-frozen')
      if (
        el &&
        !el.paused &&
        rvfcSupported &&
        frameStalledMs > FRAME_STALL_MS &&
        clockFrozenMs <= CLOCK_STALL_MS &&
        el.readyState >= HAVE_FUTURE_DATA
      ) {
        flags.push('C:no-frames-clock-running')
      }
      if (s.attached && s.waiting && el && el.readyState >= HAVE_FUTURE_DATA && !el.paused) {
        flags.push('store.waiting-but-element-ready')
      }

      return {
        t: stamp(),
        element: elementState,
        host: { readyState: hostReadyState, paused: hostPaused },
        store: s,
        isCasting: Boolean(isCasting),
        clockFrozenMs,
        frameStalledMs,
        rvfcSupported,
        lastFrameMediaTime: Number.isFinite(lastFrameMediaTime)
          ? Number(lastFrameMediaTime.toFixed(3))
          : null,
        flags,
      }
    }

    const emit = (kind, extra = {}) => {
      const event = { kind, ...snapshot(), ...extra }
      log.push(event)
      console.debug(`[playback-diag] ${kind}`, event)
      return event
    }

    // ---- spinner observation -----------------------------------------
    let observed = null
    let observer = null
    let spinnerShownAt = 0
    let lastResnapshot = 0
    const flagHistogram = {}

    const onSpinnerAttr = () => {
      const visible = observed?.hasAttribute('data-visible') ?? false
      const wasVisible = spinnerShownAt > 0
      if (visible && !wasVisible) {
        spinnerShownAt = performance.now()
        lastResnapshot = spinnerShownAt
        for (const k of Object.keys(flagHistogram)) delete flagHistogram[k]
        emit('spinner:show')
      } else if (!visible && wasVisible) {
        const visibleMs = Math.round(performance.now() - spinnerShownAt)
        spinnerShownAt = 0
        emit('spinner:hide', { visibleMs, flagHistogram: { ...flagHistogram } })
      }
    }

    const bindSpinner = () => {
      const next = spinnerRef?.current ?? null
      if (next === observed) return
      observer?.disconnect()
      observer = null
      observed = next
      if (observed && typeof MutationObserver !== 'undefined') {
        observer = new MutationObserver(onSpinnerAttr)
        observer.observe(observed, { attributes: true, attributeFilter: ['data-visible'] })
        onSpinnerAttr()
      } else if (spinnerShownAt) {
        // The indicator unmounted (casting) while visible.
        spinnerShownAt = 0
        emit('spinner:unmounted')
      }
    }

    // ---- hls.js non-fatal traffic ------------------------------------
    let engine = null
    const onHlsError = (_e, data) => {
      emit('hls:error', {
        hls: {
          type: data?.type,
          details: data?.details,
          fatal: Boolean(data?.fatal),
          url: data?.frag?.url ?? data?.url ?? data?.context?.url ?? null,
          status: data?.response?.code ?? null,
          retry: data?.errorAction?.retryCount ?? null,
        },
      })
    }
    const onFragLoaded = (_e, data) => {
      const st = data?.frag?.stats?.loading
      if (!st) return
      const ms = Math.round((st.end ?? 0) - (st.start ?? 0))
      if (ms >= SLOW_FRAG_MS) {
        // A segment that took this long was almost certainly being encoded.
        emit('hls:slow-frag', {
          hls: { ms, sn: data?.frag?.sn, level: data?.frag?.level, url: data?.frag?.url },
        })
      }
    }
    const onLevelSwitched = (_e, data) => {
      log.push({ kind: 'hls:level', t: stamp(), level: data?.level })
    }
    const bindEngine = () => {
      const next = media.engine ?? null
      if (next === engine) return
      engine?.off('hlsError', onHlsError)
      engine?.off('hlsFragLoaded', onFragLoaded)
      engine?.off('hlsLevelSwitched', onLevelSwitched)
      engine = next
      engine?.on('hlsError', onHlsError)
      engine?.on('hlsFragLoaded', onFragLoaded)
      engine?.on('hlsLevelSwitched', onLevelSwitched)
      // Who starts loading, where, and whether levels existed yet: a bare
      // startLoad() after the manifest is parsed silently discards
      // config.startPosition (hls.js only reads it on the forceStartLoad path).
      if (engine && !engine.__diagWrapped) {
        engine.__diagWrapped = true
        const orig = engine.startLoad.bind(engine)
        engine.startLoad = (pos = -1, skip) => {
          const caller = (new Error().stack || '').split(String.fromCharCode(10)).slice(2, 5).map((l) => l.trim().replace(/^at /, '').replace(/[(].*[)]/, '')).join(' < ')
          log.push({
            kind: 'hls:startLoad',
            t: stamp(),
            pos,
            configStart: engine.config?.startPosition,
            levelsKnown: Boolean(engine.levels?.length),
            currentTime: el ? Number(el.currentTime.toFixed(2)) : null,
            caller,
          })
          console.debug('[playback-diag] hls:startLoad', { pos, configStart: engine.config?.startPosition, levelsKnown: Boolean(engine.levels?.length), caller })
          return orig(pos, skip)
        }
      }
    }

    // ---- the tick ------------------------------------------------------
    const tick = () => {
      bindElement()
      bindSpinner()
      if (isManifestSource(videoURL)) bindEngine()
      if (!el) return

      const now = performance.now()
      const ct = el.currentTime
      if (ct !== lastClockTime) {
        lastClockTime = ct
        clockUnchangedSince = now
      }

      if (spinnerShownAt) {
        const snap = snapshot()
        for (const f of snap.flags) flagHistogram[f] = (flagHistogram[f] ?? 0) + 1
        if (now - lastResnapshot >= RESNAPSHOT_MS) {
          lastResnapshot = now
          log.push({ kind: 'spinner:still-visible', visibleMs: Math.round(now - spinnerShownAt), ...snap })
          console.debug(
            `[playback-diag] spinner visible ${Math.round((now - spinnerShownAt) / 1000)}s`,
            snap.flags.join(' ') || '(no flags)',
            snap
          )
        }
      }
    }

    const interval = setInterval(tick, TICK_MS)
    media.addEventListener('loadstart', bindEngine)
    tick()

    window.__playbackDiag = {
      events: log.events,
      now: snapshot,
      dump: () => JSON.stringify(log.events, null, 2),
      engine: () => engine,
      // The ladder as hls.js sees it, and which rung is loading/playing —
      // the store's rendition model drops attrs, so read the engine.
      levels: () =>
        engine
          ? {
              current: engine.currentLevel,
              loading: engine.loadLevel,
              levels: engine.levels.map((l, i) => ({
                i,
                h: l.height,
                codec: l.videoCodec,
                audio: l.audioCodec,
                br: l.bitrate,
                range: l.attrs?.['VIDEO-RANGE'] ?? null,
                stable: l.attrs?.['STABLE-VARIANT-ID'] ?? null,
              })),
            }
          : null,
    }
    console.info(
      '[playback-diag] armed — window.__playbackDiag.now() for a live snapshot, .dump() for the log'
    )
    const container = media.target?.closest?.('.player-container') ?? null
    emit('armed', {
      videoURL,
      manifest: isManifestSource(videoURL),
      delivery: container
        ? {
            source: container.dataset.playbackSource ?? null,
            skipReason: container.dataset.jitSkipReason ?? null,
            skipDetail: container.dataset.jitSkipDetail ?? null,
          }
        : null,
    })

    return () => {
      clearInterval(interval)
      media.removeEventListener('loadstart', bindEngine)
      observer?.disconnect()
      disarmFrameCallback()
      engine?.off('hlsError', onHlsError)
      engine?.off('hlsFragLoaded', onFragLoaded)
      engine?.off('hlsLevelSwitched', onLevelSwitched)
      if (window.__playbackDiag?.events === log.events) delete window.__playbackDiag
    }
  }, [store, media, videoURL, spinnerRef, isCasting])
}

function bufferedRanges(el) {
  try {
    const out = []
    for (let i = 0; i < el.buffered.length; i++) {
      out.push([Number(el.buffered.start(i).toFixed(2)), Number(el.buffered.end(i).toFixed(2))])
    }
    return out
  } catch {
    return null
  }
}
