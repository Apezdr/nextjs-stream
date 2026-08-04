/**
 * Media visibility — the single source of truth for whether a title/episode
 * is shown to clients (web AND the RN/TV app; parity is deliberate).
 *
 * THE RULE: a document is visible when its primary source is a container
 * browsers decode natively, OR it carries a JIT transcoder manifest URL.
 * Everything else is hidden from list surfaces — a title that could "maybe
 * play on RN but never on web" is a worse experience than absence, and a
 * backend operator disabling JIT should make such titles cleanly disappear
 * rather than dead-end (this rule is DURABLE policy, not migration gating).
 *
 * Admin surfaces are exempt: they see everything and render a hidden badge
 * via `isWebVisible`. Detail-by-direct-URL is also exempt — only lists,
 * rails, counts, search, and recommendations filter.
 *
 * Mechanics:
 *  - `primaryContainer` (ingested from sources[] since Phase 1) makes the
 *    check index-sargable; a `videoURL` suffix regex covers legacy docs
 *    that have not resynced since the field shipped.
 *  - Visibility keys on `jitUrl` PRESENCE, never `jitEligible` — the backend
 *    emits eligible-but-URL-less when no public transcoder URL is
 *    configured, and an eligible title without a URL is still unplayable.
 *  - Missing both signals → hidden (fail-closed).
 */

/**
 * Containers the web player's provider selection actually loads
 * (vidstack's VIDEO_EXTENSIONS set, minus the audio/ogg entries).
 */
const BROWSER_PLAYABLE_CONTAINERS = ['mp4', 'm4v', 'mov', 'webm']

/** Suffix test for legacy docs lacking `primaryContainer`. */
const BROWSER_PLAYABLE_URL_RE = /\.(mp4|m4v|mov|webm)$/i

/**
 * Whether a URL's pathname points at a browser-playable container.
 * Query strings and fragments are ignored.
 *
 * @param {string|null|undefined} url
 * @returns {boolean}
 */
export function isBrowserPlayableUrl(url) {
  if (typeof url !== 'string' || !url) return false
  const pathname = url.split(/[?#]/)[0]
  return BROWSER_PLAYABLE_URL_RE.test(pathname)
}

/**
 * JS predicate for in-memory joins (recommendations pools, already-fetched
 * arrays). Mirrors the Mongo fragments below exactly.
 *
 * @param {object|null|undefined} doc - Flat movie or episode document
 * @returns {boolean}
 */
export function isWebVisible(doc) {
  if (!doc) return false
  // A per-media admin override of 'off' means this doc will never be served
  // through the transcoder, so its jitUrl cannot make it playable. (Level-
  // local: a season/show-level 'off' affects DELIVERY of its episodes but
  // not their visibility — accepted edge, see jit/overrides.js.)
  if (typeof doc.jitUrl === 'string' && doc.jitUrl && doc.jitServeOverride !== 'off') return true
  if (typeof doc.primaryContainer === 'string') {
    return BROWSER_PLAYABLE_CONTAINERS.includes(doc.primaryContainer.toLowerCase())
  }
  return isBrowserPlayableUrl(doc.videoURL)
}

/**
 * Mongo filter fragment for FlatMovies list/count queries. Compose with
 * $and when the caller already has its own conditions.
 */
export function visibleMovieFilter() {
  return {
    $or: [
      // jitUrl only counts when no per-media 'off' override neutralizes it.
      { jitUrl: { $type: 'string', $ne: '' }, jitServeOverride: { $ne: 'off' } },
      { primaryContainer: { $in: BROWSER_PLAYABLE_CONTAINERS } },
      // Legacy arm: docs from before primaryContainer shipped. Anchored
      // suffix match on the pathname-ish tail; not sargable, but it only
      // has to carry rows until their next resync.
      {
        primaryContainer: { $exists: false },
        videoURL: BROWSER_PLAYABLE_URL_RE,
      },
    ],
  }
}

/** Mongo filter fragment for FlatEpisodes — same shape (episode fields are flat). */
export function visibleEpisodeFilter() {
  return visibleMovieFilter()
}

/**
 * Show-level visibility. FlatTVShows docs carry no per-file signals — the
 * sync writes a denormalized `visibleEpisodeCount` (count of episodes
 * matching `visibleEpisodeFilter`) after each show's episodes land.
 *
 * FAIL-OPEN on the missing field, deliberately: a show that has not been
 * re-synced since the field shipped keeps its status-quo behavior instead of
 * vanishing from every rail until convergence. After one full sync (or the
 * skip-path backfill) every show carries it and the open arm is inert.
 */
export function visibleShowFilter() {
  return {
    $or: [
      { visibleEpisodeCount: { $gt: 0 } },
      { visibleEpisodeCount: { $exists: false } },
    ],
  }
}

/** JS predicate twin of `visibleShowFilter` (admin badge = !isShowWebVisible). */
export function isShowWebVisible(doc) {
  if (!doc) return false
  return doc.visibleEpisodeCount === undefined || doc.visibleEpisodeCount === null
    ? true
    : doc.visibleEpisodeCount > 0
}

export { BROWSER_PLAYABLE_CONTAINERS }
