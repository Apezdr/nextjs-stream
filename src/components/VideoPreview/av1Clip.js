/**
 * AV1 preview clips: which URLs have an AV1 version, and whether this browser
 * should be offered it.
 *
 * The media processor serves a preview clip as H.264 by default and as AV1
 * (20-40% smaller) when the URL carries `codec=av1`. A processor that cannot
 * make AV1, or predates the parameter, answers 400, so the AV1 URL is only
 * ever listed ahead of the plain one, never instead of it.
 *
 * No React here, and nothing touches the browser at import: the capability
 * check starts when something asks for it (`startAv1DecodeCheck`).
 */

/** `type` for the AV1 `<source>`: a browser that cannot play it skips the request. */
export const AV1_CLIP_SOURCE_TYPE = 'video/mp4; codecs="av01.0.05M.08, mp4a.40.2"'

// What a `quality=high` clip is at most: 720p, 2 Mb/s. Film is 24 fps.
const AV1_DECODE_CONFIG = {
  type: 'file',
  video: {
    contentType: 'video/mp4; codecs="av01.0.05M.08"',
    width: 1280,
    height: 720,
    bitrate: 2000000,
    framerate: 24,
  },
}

/**
 * The AV1 version of a processor clip URL, or null when there is none to ask
 * for: not a clip URL, a clip that already names its codec, the TV app's
 * stream copy (`useOriginalVideo`, which has no AV1 form), or a URL that does
 * not parse.
 */
export function deriveAv1ClipUrl(url) {
  if (typeof url !== 'string') return null
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (!parsed.pathname.includes('/videoClip/')) return null
  if (parsed.searchParams.has('codec') || parsed.searchParams.has('useOriginalVideo')) return null
  // Appended to the query as written, not through searchParams, which would
  // re-encode the parameters that are already there.
  parsed.search = parsed.search ? `${parsed.search}&codec=av1` : '?codec=av1'
  return parsed.href
}

/** Whether a media element's `currentSrc` is the AV1 version of a clip. */
export function isAv1ClipSource(currentSrc) {
  return typeof currentSrc === 'string' && currentSrc.includes('codec=av1')
}

// null until the browser has answered. Only an explicit yes offers AV1.
let decodesSmoothly = null
let decodeCheck = null
// Set when AV1 playback failed in a browser that had said it could decode it.
let playbackFailed = false

/**
 * Ask the browser, once per page load, whether it decodes AV1 smoothly at
 * clip size. Later calls return the first call's promise.
 *
 * `smooth` is the bar, not `powerEfficient`: software AV1 decoding at 720p is
 * fine on a machine that reports it smooth, and requiring hardware would rule
 * out most desktops. Detection is by capability only; a browser without the
 * API is treated as unable.
 *
 * @returns {Promise<boolean>} the answer (false on the server, which never asks)
 */
export function startAv1DecodeCheck() {
  if (decodeCheck) return decodeCheck
  // Not remembered: the server has no answer to give, and must not record one.
  if (typeof window === 'undefined') return Promise.resolve(false)

  const capabilities = typeof navigator === 'undefined' ? null : navigator.mediaCapabilities
  if (typeof capabilities?.decodingInfo !== 'function') {
    decodesSmoothly = false
    decodeCheck = Promise.resolve(false)
    return decodeCheck
  }

  // Inside the executor so a synchronous throw is a rejection like any other.
  decodeCheck = new Promise((resolve) => resolve(capabilities.decodingInfo(AV1_DECODE_CONFIG)))
    .then(
      (info) => Boolean(info?.supported && info?.smooth),
      () => false
    )
    .then((answer) => {
      decodesSmoothly = answer
      return answer
    })
  return decodeCheck
}

/**
 * Whether to list the AV1 clip first, read synchronously from what is known
 * right now. False while the check is still running: a preview mounts with its
 * final source list, so an unknown answer means H.264 for that mount.
 */
export function canOfferAv1Clips() {
  return decodesSmoothly === true && !playbackFailed
}

/** Stop offering AV1 for the rest of the page session. */
export function markAv1PlaybackFailed() {
  playbackFailed = true
}

export function _resetAv1ClipStateForTests() {
  decodesSmoothly = null
  decodeCheck = null
  playbackFailed = false
}
