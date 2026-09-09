/**
 * Serve-time JIT delivery preference.
 *
 * Decides, per served media payload, whether the client should play the JIT
 * transcoder manifest (`jitUrl`, ingested from the owning host's payload) or
 * the raw file URL. The decision is a PAYLOAD mutation only — nothing is
 * ever persisted, so flipping modes or the transcoder dying changes behavior
 * on the next request with zero data movement. Watch-history identity is
 * transport-invariant (videoIdentity.js canonicalizes JIT URLs), so serving
 * either URL yields the same normalizedVideoId — pinned by test.
 *
 * Modes (JIT_SERVE_MODE):
 *   off    — never serve jitUrl (kill switch)
 *   rescue — serve jitUrl only when the raw primary is NOT browser-playable
 *            (MKV etc.); browser-playable titles keep direct play
 *   prefer — serve jitUrl whenever present and healthy (the "universal
 *            upgrade" end-state; direct play remains the fallback)
 *
 * First-deploy default is `rescue`; flip to `prefer` after a validation
 * window. An unrecognized value fails closed to `off` (direct play always
 * works) with a warning, rather than guessing.
 *
 * Mode precedence: admin runtime override (/admin/settings, cached ~20s)
 * > JIT_SERVE_MODE env > 'rescue'. The runtime override exists so flipping
 * delivery never requires a redeploy.
 */

import { isBrowserPlayableUrl } from '@src/utils/mediaVisibility'
import { isTranscoderHealthy, getLastHealthProbe } from './health'
import { getCachedJitServeSettings } from './serveSettings'
import { resolveJitOverride } from './overrides'

const VALID_MODES = new Set(['off', 'rescue', 'prefer'])
let warnedInvalidMode = false

/** Env-level mode (no runtime override applied). */
export function getJitServeMode() {
  const raw = (process.env.JIT_SERVE_MODE || '').trim().toLowerCase()
  if (!raw) return 'rescue'
  if (VALID_MODES.has(raw)) return raw
  if (!warnedInvalidMode) {
    console.warn(`[jit] Unrecognized JIT_SERVE_MODE "${raw}" — treating as "off" (direct play)`)
    warnedInvalidMode = true
  }
  return 'off'
}

/** Effective mode: admin runtime override when valid, else env. */
export async function getEffectiveJitServeMode() {
  const settings = await getCachedJitServeSettings()
  if (settings && VALID_MODES.has(settings.mode)) return settings.mode
  return getJitServeMode()
}

/**
 * Apply the delivery preference to a served media object (movie doc or
 * episode object — both carry jitUrl/videoURL flat). Mutates and returns it.
 *
 * On swap: `videoURL` becomes the manifest URL (both web and RN read this
 * field as "the stream URL" per contract), the original moves to
 * `rawVideoURL`, and `playbackSource: 'jit'` is stamped for observability.
 *
 * @param {object|null|undefined} media
 * @returns {Promise<object|null|undefined>} the same object
 */
export async function applyJitPreference(media) {
  if (!media || typeof media.jitUrl !== 'string' || !media.jitUrl) return media
  // Idempotent: multiple serve layers may compose (route + player page) —
  // a second application must not clobber rawVideoURL with the manifest.
  if (media.playbackSource === 'jit') return media

  // Every non-swap exit names itself. A title silently served raw is
  // indistinguishable from one the operator pinned raw, and the play page
  // and the media route can disagree seconds apart (health probe, cache
  // instance) with nothing to compare. `jitSkipReason` is additive and
  // absent on a swap. `playbackSource` is 'raw' on every skip exit — the TV
  // app labels its Original row "raw file served" only on that literal, and
  // an absent field used to read as "older server" there.
  const skip = (reason, detail) => {
    media.jitSkipReason = reason
    if (detail) media.jitSkipDetail = detail
    media.playbackSource = 'raw'
    return media
  }

  const mode = await getEffectiveJitServeMode()
  // Global kill switch always wins — not defeatable per-title.
  if (mode === 'off') return skip('mode-off')

  // Per-media admin override (episode > season > show for TV): 'off' pins
  // direct play; 'on' serves JIT regardless of rescue's playability test
  // AND regardless of eligibility (the explicit accept-the-loss switch).
  const override = await resolveJitOverride(media)
  if (override === 'off') return skip('override-off')

  // Addressability ≠ recommendation: once the backend emits jitUrl for all
  // servable files, jitEligible=false means "playing this via JIT loses
  // something" (e.g. an audio language). Default modes never auto-accept
  // that loss — only an explicit per-media 'on' override does.
  if (override !== 'on' && media.jitEligible !== true) return skip('ineligible')
  if (override !== 'on' && mode === 'rescue' && isBrowserPlayableUrl(media.videoURL)) {
    return skip('rescue-playable')
  }

  let origin
  try {
    origin = new URL(media.jitUrl).origin
  } catch (e) {
    return skip('malformed-jit-url') // never serve it
  }

  if (!(await isTranscoderHealthy(origin))) {
    return skip('transcoder-unhealthy', getLastHealthProbe(origin))
  }

  delete media.jitSkipReason
  delete media.jitSkipDetail
  media.rawVideoURL = media.videoURL
  media.videoURL = media.jitUrl
  media.playbackSource = 'jit'
  return media
}
