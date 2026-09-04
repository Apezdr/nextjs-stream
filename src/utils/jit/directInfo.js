/**
 * Delivery-tier verdict plumbing for `/api/authenticated/media/direct-info`
 * — the authenticated proxy of jit-transcoder's `GET /stream/{key}/direct.json`
 * (FRONTEND_PLAYBACK_REQUIREMENTS.md §3, epoch 16).
 *
 * Three jobs live here so the route stays a thin HTTP shell:
 *
 *  1. Deriving `{origin, key}` from a served stream URL. The origin always
 *     comes from a URL this server minted (`jitUrl`, ingested from the owning
 *     host) — never from anything the caller sent — so the proxy can't be
 *     pointed at an arbitrary host.
 *
 *  2. The §3/§4 display mapping (`badgeLabel`, `reasonCopy`), computed once
 *     server-side so web, Apple RN and Android RN can never word the same
 *     verdict differently. Clients keep their own fallback for a thin proxy,
 *     but a value here always wins.
 *
 *  3. Surviving the derivation wait. The first verdict for an eligible title
 *     pays the transcoder's one-time keyframe derivation — seconds on an MP4,
 *     minutes on a huge un-indexed MKV — and that work is NOT resumable:
 *     `direct_play_offer` runs inside a `OnceCell::get_or_init`, so a dropped
 *     connection throws away everything derived so far. A per-request timeout
 *     that aborted the fetch would therefore restart the scan on every poll
 *     and never finish. Instead the upstream request is shared and detached:
 *     one in-flight fetch per title, requests race their own patience against
 *     it, and losing that race reports "pending" while the work continues.
 */

const DEFAULT_CLIENT_WAIT_MS = 15_000

// The upstream ceiling, not the caller's. Generous enough for a full packet
// scan of a large remux; only a genuinely wedged transcoder hits it.
const UPSTREAM_TIMEOUT_MS = 10 * 60_000

// Verdicts are memoized upstream, so this is only about noticing state that
// CAN change under us: a title poisoned by a playback fault, or the operator
// flipping JIT_DIRECT_PLAY. Ten minutes bounds that without re-asking per play.
const VERDICT_TTL_MS = 10 * 60_000

const MAX_CACHE_ENTRIES = 500

/** cacheKey -> { value, expiresAt } */
const verdicts = new Map()
/** cacheKey -> Promise<Result> (never rejects) */
const inFlight = new Map()

const PENDING = Object.freeze({ status: 'pending' })

// Only the tails the transcoder actually serves under a key, and only the
// strict URL-safe base64 alphabet it mints (`+`/`=` tolerated for the
// hand-pasted standard-alphabet era, matching videoIdentity.js).
const STREAM_PATH_RE =
  /^\/stream\/([A-Za-z0-9+_-]+={0,2})\/(?:master\.m3u8|manifest\.mpd|file)$/

/**
 * Split a served stream URL into the transcoder origin and its path key.
 *
 * @param {string|null|undefined} url
 * @returns {{origin: string, key: string}|null} null for anything that is not
 *   a transcoder stream URL (a raw file URL, a trailer, garbage).
 */
export function parseStreamUrl(url) {
  if (typeof url !== 'string' || !url) return null

  let parsed
  try {
    parsed = new URL(url)
  } catch (e) {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null

  const match = STREAM_PATH_RE.exec(parsed.pathname)
  if (!match) return null

  return { origin: parsed.origin, key: match[1] }
}

/**
 * §4's badge mapping. Dolby Vision is asserted by the presence of
 * SUPPLEMENTAL-CODECS and nothing else — it is undetectable client-side, and
 * this field derives from the same predicate as the master line and the
 * init segment's `dvvC` box.
 *
 * @param {object} hls - the verdict's `hls` object
 * @returns {string} "Original (Dolby Vision)" | "Original (HDR10)" | "Original"
 */
export function deriveOriginalLabel(hls) {
  if (hls?.supplementalCodecs) return 'Original (Dolby Vision)'
  if (hls?.videoRange === 'PQ') return 'Original (HDR10)'
  return 'Original'
}

/**
 * §3's reason table. Returns null where there is nothing honest to say:
 * `disabled` means the server feature is off, which the clients render as
 * "no Original option at all" rather than an explanation.
 *
 * @param {string|undefined} reason
 * @returns {string|null}
 */
export function reasonToUserCopy(reason) {
  switch (reason) {
    case 'open-gop-avc':
      return "This file's format can't seek reliably in browsers. Playing in high-quality transcode — use a native player for the untouched original."
    case 'segment-floor':
    case 'segment-budget':
      return "This file's structure exceeds browser streaming limits."
    case 'unscannable':
      return 'The original stream could not be analyzed.'
    // `unmappable-codec`: the offer stood but no RFC 6381 string can express
    // this source's profile/level/tier, so the ladder withheld the rung rather
    // than mis-declare it. Indistinguishable from an ineligible source to a
    // viewer, and it replaced the older `offered: true` + null `variantIndex`
    // shape — a menu entry that led nowhere. Same sentence for both.
    case 'ineligible-source':
    case 'unmappable-codec':
      return "This format can't be streamed unmodified."
    case 'poisoned':
      return 'Original streaming was disabled for this title after a playback fault.'
    case undefined:
    case null:
    case 'disabled':
      return null
    default:
      // A reason this build has never heard of still means "not offered";
      // say that plainly rather than leaking the machine-readable token.
      return "Original streaming isn't available for this title."
  }
}

/**
 * Enriched passthrough: the transcoder's verdict verbatim, plus the display
 * fields. Unknown upstream fields survive untouched so a server ahead of this
 * deploy keeps working.
 *
 * @param {object} raw
 * @returns {object}
 */
export function enrichDirectInfo(raw) {
  const hls = raw?.hls ?? {}
  const badgeLabel = hls.offered ? deriveOriginalLabel(hls) : null
  const reasonCopy = hls.offered ? null : reasonToUserCopy(hls.reason)

  return {
    ...raw,
    ...(badgeLabel ? { badgeLabel } : {}),
    ...(reasonCopy ? { reasonCopy } : {}),
  }
}

function rememberVerdict(cacheKey, value) {
  if (verdicts.size >= MAX_CACHE_ENTRIES) {
    const now = Date.now()
    for (const [key, entry] of verdicts) {
      if (entry.expiresAt <= now) verdicts.delete(key)
    }
    // Still full of live entries: drop the oldest insertion (Map preserves it).
    if (verdicts.size >= MAX_CACHE_ENTRIES) {
      const oldest = verdicts.keys().next()
      if (!oldest.done) verdicts.delete(oldest.value)
    }
  }
  verdicts.set(cacheKey, { value, expiresAt: Date.now() + VERDICT_TTL_MS })
}

/**
 * The shared upstream request. Never rejects — every outcome is a Result the
 * racers can read — because it outlives the request that started it.
 */
async function requestVerdict(origin, key, cacheKey, fetchImpl) {
  try {
    const res = await fetchImpl(`${origin}/stream/${key}/direct.json`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })

    // An unknown key: the source moved or was removed since the payload was
    // served. Same shape the clients already treat as "nothing offered".
    if (res.status === 404) return { status: 'not-found' }
    if (!res.ok) return { status: 'upstream-error', upstreamStatus: res.status }

    const body = await res.json()
    if (!body || typeof body !== 'object' || typeof body.hls !== 'object') {
      return { status: 'upstream-error', upstreamStatus: res.status, reason: 'malformed' }
    }

    const value = enrichDirectInfo(body)
    rememberVerdict(cacheKey, value)
    return { status: 'ok', value }
  } catch (error) {
    return { status: 'upstream-error', error }
  } finally {
    inFlight.delete(cacheKey)
  }
}

/**
 * The verdict for one title, or `pending` when the derivation is still
 * running after `waitMs`.
 *
 * A `pending` result must never be turned into a "nothing offered" verdict by
 * the caller: clients stop asking once any verdict lands, so a synthetic one
 * would hide Original for the life of the session.
 *
 * @param {{origin: string, key: string, waitMs?: number, fetchImpl?: Function}} args
 * @returns {Promise<{status: 'ok', value: object, cached?: boolean}
 *                  |{status: 'pending'}
 *                  |{status: 'not-found'}
 *                  |{status: 'upstream-error', upstreamStatus?: number, error?: any}>}
 */
export async function fetchDirectInfo({
  origin,
  key,
  waitMs = DEFAULT_CLIENT_WAIT_MS,
  fetchImpl = fetch,
}) {
  const cacheKey = `${origin}|${key}`

  const cached = verdicts.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return { status: 'ok', value: cached.value, cached: true }
  }
  verdicts.delete(cacheKey)

  let work = inFlight.get(cacheKey)
  if (!work) {
    work = requestVerdict(origin, key, cacheKey, fetchImpl)
    inFlight.set(cacheKey, work)
  }

  // Race this request's patience against the shared work. Losing does not
  // touch `work` — that is the whole point: the scan keeps running for
  // whoever asks next.
  let timer
  const patience = new Promise((resolve) => {
    timer = setTimeout(() => resolve(PENDING), waitMs)
  })
  try {
    return await Promise.race([work, patience])
  } finally {
    clearTimeout(timer)
  }
}

/** Test hook. */
export function _resetDirectInfoCacheForTests() {
  verdicts.clear()
  inFlight.clear()
}
