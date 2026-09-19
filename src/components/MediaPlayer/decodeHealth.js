'use client'

/**
 * Decode-health detection: why the picture is soft, when the browser is to blame.
 *
 * A browser silently drops every HLS variant whose CODECS its decoder cannot
 * open, so a client without working HEVC plays a 4K title at the highest AVC
 * rung and nothing anywhere reports a problem. This module decides whether that
 * happened and, if so, which of two very different sentences to say.
 *
 * The detection is EVIDENCE-FIRST, not probe-first, and that inversion is the
 * whole design. The trigger is a diff of the ladder the master advertised
 * against the ladder hls.js kept — provable picture loss, in this browser, on
 * this stream. The capability probes below never decide WHETHER to speak, only
 * WHICH sentence to use. Three reasons a probe cannot be the gate:
 *
 *  1. There is no stable CODECS string to probe. The transcoder declares CODECS
 *     from the produced bitstream (jit-transcoder core/packager/fmp4_patch.rs
 *     `init_declared_codec`), so profile-idc, compatibility flags, tier, level
 *     and the trailing constraint byte all move with the encoder backend, the
 *     source aspect and whether the init segment was cached yet. Real strings
 *     from one live master: hvc1.2.4.H150.90, hvc1.1.2.H120.90, hvc1.2.4.H153.B0.
 *  2. hls.js drops levels through TWO filters. The first is
 *     MediaSource.isTypeSupported at manifest parse; the second runs later,
 *     during ABR, through navigator.mediaCapabilities.decodingInfo() — and it
 *     contains a hardcoded Windows-Firefox HEVC override that strips every HEVC
 *     rung while isTypeSupported still answers `true`. A probe is structurally
 *     blind to that; a ladder diff is not.
 *  3. The server legitimately ships 1080p-capped ladders. Without a live GPU
 *     encoder the transcoder clamps max height to 1080, and the throughput
 *     budget can shed rungs under load. Gating on the title's own dimensions
 *     would tell a perfectly healthy browser to restart itself over a
 *     server-side capacity decision.
 *
 * Everything here is pure and framework-free so the verdict can be table-tested
 * without rendering a player. Globals are read lazily INSIDE each function —
 * jsdom defines neither MediaSource nor navigator.mediaCapabilities, so a
 * module-scope capture would bake in `undefined` at import time.
 */

/** Video codecs that identify an HEVC rung (dvh1/dvhe are Dolby Vision over HEVC). */
export const HEVC_RE = /^(hvc1|hev1|dvh1|dvhe)/i

const AVC_RE = /^avc1/i

/**
 * Strings for the HEVC *capability* probe.
 *
 * Deliberately NOT the ladder's own strings — see reason 1 above; there is no
 * fixed answer to "what does our master advertise". These are conservative,
 * widely-implemented forms (Main L3.1, Main L4.0, Main10 L4.0) in the shape
 * `jit-transcoder/src/core/codec.rs::hvc1_string` emits, probed as an OR so one
 * picky parser cannot manufacture a false negative. A browser that opens any of
 * them has an HEVC decoder; the ladder diff has already established that rungs
 * were lost.
 */
export const HEVC_PROBE_CODECS = ['hvc1.1.6.L93.B0', 'hvc1.1.6.L120.B0', 'hvc1.2.4.L120.B0']

const BASELINE_KEY = 'mediaPlayer:hevcBaseline'
const DISMISS_KEY = 'mediaPlayer:decodeNoticeDismissed'

/**
 * Collapse an hls.js MANIFEST_LOADED level list into primitives.
 *
 * `data.levels` is the full, unfiltered set parsed from the master — including
 * the rungs the decoder is about to reject. hls.js's LevelController builds a
 * new array rather than splicing this payload, so it is safe to read.
 *
 * Stamped with `src` so a snapshot left over from a previous source is ignored
 * rather than compared against the current stream's renditions.
 */
export function summarizeAdvertised(levels, src) {
  if (!Array.isArray(levels) || levels.length === 0) return null
  let offeredMax = 0
  const rungs = []
  for (const level of levels) {
    const height = Number(level?.height) || 0
    if (height > offeredMax) offeredMax = height
    rungs.push({ height, codec: String(level?.videoCodec ?? '') })
  }
  if (offeredMax === 0) return null
  return { src, offeredMax, rungs }
}

/**
 * Whether this browser can open an HEVC bitstream at all.
 *
 * Uses hls.js's own MIME shape — `video/mp4;codecs=X`, no space, no quotes —
 * and its own MediaSource resolution order, so the answer agrees with the
 * filter that actually dropped the rungs rather than with a differently-spelled
 * question. Returns null when MediaSource is absent entirely (native-HLS paths,
 * SSR, jsdom), which callers must treat as "unknown", never as "no".
 */
export function probeHevc() {
  const MS = globalThis.ManagedMediaSource ?? globalThis.MediaSource
  if (typeof MS?.isTypeSupported !== 'function') return null
  try {
    return HEVC_PROBE_CODECS.some((codec) => MS.isTypeSupported(`video/mp4;codecs=${codec}`))
  } catch {
    return null
  }
}

/**
 * The persisted HEVC capability baseline — the only thing that earns the
 * "restart your browser" sentence. A browser that never had HEVC never trips it.
 */
export function readHevcBaseline() {
  try {
    const raw = globalThis.localStorage?.getItem(BASELINE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

/**
 * Record what this browser could do, merging into whatever is already stored.
 *
 * `lastTrueAt` is never cleared, and that is the load-bearing detail. The
 * spec's literal reading — "persist the probe result" — would store `false` on
 * the first playback of a GPU-crashed session; the second playback would then
 * find no evidence of regression and render "this browser can't play HEVC",
 * which is false for that machine and drops the one actionable sentence the
 * viewer needed. Since the degraded state lasts for the whole browser process,
 * that is the common path, not an edge case.
 */
export function recordHevcBaseline(hevc) {
  if (hevc !== true && hevc !== false) return
  try {
    const now = Date.now()
    const prev = readHevcBaseline()
    const next = {
      v: 1,
      hevc,
      firstSeenAt: prev?.firstSeenAt ?? now,
      lastTrueAt: hevc ? now : (prev?.lastTrueAt ?? null),
      lastFalseAt: hevc ? (prev?.lastFalseAt ?? null) : now,
    }
    globalThis.localStorage?.setItem(BASELINE_KEY, JSON.stringify(next))
  } catch {
    /* storage unavailable or full */
  }
}

/** Whether the baseline says this browser has opened HEVC at some point before. */
export function hadHevcBefore(baseline) {
  return Boolean(baseline?.lastTrueAt)
}

/**
 * Chromium-family check, by hand rather than through `detectBrowserType`, which
 * would pull ua-parser-js into the player bundle to answer a boolean.
 */
export function isChromium() {
  if (typeof navigator === 'undefined') return false
  if (navigator.userAgentData != null) return true
  return /\bChrome\/\d+/.test(navigator.userAgent || '')
}

let gpuLiveness

/**
 * Whether the GPU process is alive enough to hand out an accelerated context.
 *
 * `failIfMajorPerformanceCaveat` replaces the renderer-string regex the
 * requirements suggested: Chrome no longer falls back to SwiftShader for WebGL
 * by default, so a dead GPU process yields a NULL context rather than a
 * renderer name to match against — which is exactly what chrome://gpu reported
 * as "WebGL: Disabled" in the confirmed case. It also avoids
 * WEBGL_debug_renderer_info, which Firefox masks under resistFingerprinting and
 * would otherwise have handed a hardened Firefox the Chromium-only advice.
 *
 * Memoised to one context for the life of the page, immediately released, and
 * called only when it can change the wording: creating a context can itself
 * restart a GPU process that is already crash-looping, and the first one on
 * Windows can block the main thread while ANGLE initialises. This is
 * corroboration for a Chromium-only tier, never a primary signal — WebGL
 * liveness and accelerated video decode are separate features with separate
 * blocklist entries.
 */
export function probeGpuLiveness() {
  if (gpuLiveness !== undefined) return gpuLiveness
  if (typeof document === 'undefined') return null
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const opts = { failIfMajorPerformanceCaveat: true }
    const gl = canvas.getContext('webgl2', opts) ?? canvas.getContext('webgl', opts)
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
    gpuLiveness = gl === null ? 'dead' : 'alive'
  } catch {
    gpuLiveness = null
  }
  return gpuLiveness
}

// The dismissal is a tiny external store rather than component state, because
// the player subtree is unmounted whenever its page is parked in Next's
// Activity boundary — a useState dismissal would resurrect the modal on every
// return to the page and on every episode change. Reading it through
// useSyncExternalStore also keeps it out of an effect, which is what this
// codebase already reaches for when a value is client-only.
let dismissedTier = null
let dismissedHydrated = false
const dismissListeners = new Set()

/** The tier the viewer has already dismissed this browsing session, if any. */
export function readDismissedTier() {
  if (dismissedHydrated) return dismissedTier
  try {
    dismissedTier = globalThis.sessionStorage?.getItem(DISMISS_KEY) ?? null
  } catch {
    dismissedTier = null
  }
  dismissedHydrated = true
  return dismissedTier
}

/** There is no storage during SSR, so the server has never dismissed anything. */
export function serverDismissedTier() {
  return null
}

export function subscribeDismissed(listener) {
  dismissListeners.add(listener)
  return () => {
    dismissListeners.delete(listener)
  }
}

/**
 * Remember that the modal has been read, for this browsing session only.
 *
 * sessionStorage rather than localStorage on purpose: the condition clears on
 * browser restart, which is precisely the fix being recommended, so a dismissal
 * must never outlive the session that earned it. Keyed by tier so a genuine
 * change of diagnosis still gets one showing.
 */
export function writeDismissedTier(tier) {
  dismissedTier = tier
  dismissedHydrated = true
  try {
    globalThis.sessionStorage?.setItem(DISMISS_KEY, tier)
  } catch {
    /* storage unavailable or full */
  }
  for (const listener of dismissListeners) listener()
}

/**
 * The verdict, from the ladder diff plus the wording signals.
 *
 * Returns null for "say nothing", which is the answer for every server-side
 * ladder decision, every player-size cap, every manual quality selection, every
 * progressive source and every native-HLS path — because all of those leave
 * `keptMax >= offeredMax`.
 *
 * @param {object} input
 * @param {number} input.offeredMax   tallest rung the master advertised
 * @param {Array<{height:number,codec:string}>} input.rungs  every advertised rung
 * @param {number} input.keptMax      tallest rung that survived the decoder
 * @param {string} input.keptTopCodec codec of the surviving top rung
 * @param {boolean|null} input.hevcNow  capability probe, null when unknown
 * @param {boolean} input.hadHevc     baseline says HEVC worked here before
 * @param {'alive'|'dead'|null} input.webgl
 * @param {boolean} input.chromium
 */
export function decodeHealthVerdict({
  offeredMax,
  rungs,
  keptMax,
  keptTopCodec,
  hevcNow,
  hadHevc,
  webgl,
  chromium,
}) {
  if (!offeredMax || !keptMax) return null
  if (keptMax >= offeredMax) return null

  const lost = (rungs ?? []).filter((rung) => rung.height > keptMax)
  if (lost.length === 0) return null

  const base = {
    offeredMax,
    keptMax,
    keptIsAvc: AVC_RE.test(keptTopCodec || ''),
  }

  // Rungs were lost, but not uniformly to HEVC — a future AV1 tier, a Dolby
  // Vision SUPPLEMENTAL-CODECS rejection, a buffer-append failure. Say what is
  // provable and make no codec claim.
  if (!lost.every((rung) => HEVC_RE.test(rung.codec))) {
    return { ...base, tier: 'limited' }
  }

  // This browser opened HEVC before and cannot now. The strongest signal there
  // is, and the only one that earns restart advice on its own.
  if (hadHevc && hevcNow === false) {
    return { ...base, tier: 'gpu-regressed' }
  }

  // No baseline (cleared data, a private window, a first visit), but Chromium
  // with no HEVC AND no accelerated context is the same dead GPU process
  // wearing a different hat.
  if (chromium && hevcNow === false && webgl === 'dead') {
    return { ...base, tier: 'gpu-regressed' }
  }

  return { ...base, tier: 'no-hevc' }
}
