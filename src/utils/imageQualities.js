/**
 * The single source of truth for `images.qualities` — the allow-list of `q`
 * values the image optimizer will serve.
 *
 * Next 16 requires this list and rejects any `q` outside it. It is a security
 * control rather than a rounding hint: with `q` unrestricted, anyone can force
 * the optimizer to produce and cache a hundred variants of every image in the
 * catalog, which is a cache-amplification and CPU-exhaustion lever. That is
 * why the docs call it out as required.
 *
 * Three consumers must agree on one list, or the control has a hole. Only the
 * first is enforced by Next itself:
 *
 *  1. `next.config.js`, which declares the list to Next. Covers every
 *     `<Image quality={…}>` — the component validates its prop against it.
 *  2. `buildNextOptimizedImageUrl` (`src/utils/index.js`), which hand-builds
 *     `/_next/image?…&q=` URLs for `preloadResource`. That URL never passes
 *     through `<Image>`, so nothing validated it, and a rejected *preload*
 *     reports nothing to the console — it just wastes the round trip and
 *     misses the cache on the real fetch.
 *  3. `buildImgproxyTarget` (`src/lib/imgproxy.ts`), which answers
 *     `/_next/image` from middleware when IMGPROXY_URL is set. That path
 *     returns before Next's optimizer route ever runs, so the allow-list was
 *     never consulted at all — an out-of-set `q` was rejected with imgproxy
 *     off and quietly honored with it on.
 *
 * CommonJS with zero imports, on the same reasoning as
 * `src/utils/videoIdentity.js`: `next.config.js` is CJS and loads this before
 * any transpilation exists, while ESM and TypeScript importers get it through
 * the bundler's interop.
 */

// Keep sorted ascending — `nearestAllowedQuality` does not depend on the
// order, but a sorted list is what `next.config.js` shows an operator.
const IMAGE_QUALITIES = [25, 50, 75, 90, 100]

// Next's own default, used when a caller supplies nothing at all.
const DEFAULT_IMAGE_QUALITY = 75

/**
 * Whether `quality` is one this deployment will serve.
 *
 * Accepts the string form a query parameter arrives as, so callers reading
 * from URLSearchParams do not each repeat the coercion.
 *
 * @param {number|string|null|undefined} quality
 * @returns {boolean}
 */
function isAllowedQuality(quality) {
  const requested = Number(quality)
  return Number.isFinite(requested) && IMAGE_QUALITIES.includes(requested)
}

/**
 * The allowed quality closest to `quality`, for callers that build an
 * optimizer URL directly and would otherwise emit a value the optimizer
 * refuses.
 *
 * Snapping rather than rejecting is right here because the caller's intent
 * ("about this sharp") is still serviceable, and the alternative — dropping
 * the preload, or emitting a URL that 400s — loses the image for no gain.
 * A tie goes to the higher value: a slightly larger file is a cheaper mistake
 * than a visibly softer one.
 *
 * Anything non-numeric falls back to the default rather than throwing, since
 * this sits on a render path where a bad prop should not take out the page.
 *
 * @param {number|string|null|undefined} quality
 * @returns {number}
 */
function nearestAllowedQuality(quality) {
  // `> 0` rather than a bare isFinite check, because Number(null), Number('')
  // and Number(false) are all 0 — so a caller that supplied nothing would
  // otherwise snap to the LOWEST allowed quality instead of the default. A
  // literal 0 or a negative is not a usable quality either, so both take the
  // same branch; this matches the `quality || 75` the old clamp applied.
  const requested = Number(quality)
  const target = Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_IMAGE_QUALITY

  return IMAGE_QUALITIES.reduce((best, candidate) => {
    const candidateDistance = Math.abs(candidate - target)
    const bestDistance = Math.abs(best - target)
    if (candidateDistance < bestDistance) return candidate
    if (candidateDistance === bestDistance) return Math.max(best, candidate)
    return best
  }, IMAGE_QUALITIES[0])
}

module.exports = {
  IMAGE_QUALITIES,
  DEFAULT_IMAGE_QUALITY,
  isAllowedQuality,
  nearestAllowedQuality,
}
