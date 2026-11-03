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

import { ObjectId } from 'mongodb'
import { MOVIE_RATINGS, TV_RATINGS, isFullLibrary, ratingsUpTo } from '@src/lib/roles/libraryScope'

/**
 * Containers the web player's media element actually loads. The @videojs/react
 * <Video> element is a native <video> (m4v/mov resolve to video/mp4, webm to
 * video/webm), so the supported set is unchanged from the vidstack era.
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
  // The jitUrl arm counts only when this doc would actually be SERVED via
  // JIT: not overridden 'off', and either recommended (jitEligible — the
  // backend's no-loss verdict) or explicitly overridden 'on' by an admin
  // accepting the loss. Addressability alone (jitUrl on an ineligible doc,
  // once the backend decouples the two) must not surface a title the
  // default serve modes would refuse to swap — that's a dead-end click.
  // (Level-local: season/show overrides affect DELIVERY, not visibility —
  // accepted edge, see jit/overrides.js.)
  if (
    typeof doc.jitUrl === 'string' &&
    doc.jitUrl &&
    doc.jitServeOverride !== 'off' &&
    (doc.jitEligible === true || doc.jitServeOverride === 'on')
  ) {
    return true
  }
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
      // jitUrl counts only when the doc would actually be served via JIT:
      // not overridden 'off', and recommended (jitEligible) or explicitly
      // overridden 'on'. Mirrors isWebVisible — keep in lockstep.
      {
        jitUrl: { $type: 'string', $ne: '' },
        jitServeOverride: { $ne: 'off' },
        $or: [{ jitEligible: true }, { jitServeOverride: 'on' }],
      },
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

/*
 * Library scope (src/lib/roles/libraryScope.ts): what one viewer may see.
 * Visibility above is the same for everyone (the sync counts with it); scope
 * is per viewer, so each fragment below takes the viewer's LibraryAccess,
 * which the page, route or action that knows the viewer passes down. Every
 * read that sends titles to a viewer filters with library*Filter (visible AND
 * in scope) or, for one document or an in-memory join, with
 * scopeMatcher(access). __tests__/lib/libraryScopeGuard.test.js holds every
 * Flat* read outside the sync and the admin pages to that.
 *
 * The whole library (an admin, a user with no scoped role) adds nothing, so
 * those queries keep exactly their old shape.
 */

const titlesOf = (scope, mediaType) =>
  scope.titles.filter((title) => title.mediaType === mediaType).map((title) => title.originalTitle)

/** The movies a scope holds: rated at or under its cap, or hand-picked. Unrated ones only when hand-picked. */
export function movieScopeFragment(scope) {
  return {
    $or: [
      { 'metadata.rating': { $in: ratingsUpTo(scope.movieRatingCap, MOVIE_RATINGS) } },
      { originalTitle: { $in: titlesOf(scope, 'movie') } },
    ],
  }
}

/** The shows a scope holds, by the same rule. */
export function showScopeFragment(scope) {
  return {
    $or: [
      { 'metadata.rating': { $in: ratingsUpTo(scope.tvRatingCap, TV_RATINGS) } },
      { originalTitle: { $in: titlesOf(scope, 'tv') } },
    ],
  }
}

/** Mongo fragment: the viewer's movies. {} for the whole library. */
export function scopeMovieFilter(access) {
  return isFullLibrary(access) ? {} : movieScopeFragment(access.scope)
}

/** Mongo fragment: the viewer's shows. {} for the whole library. */
export function scopeShowFilter(access) {
  return isFullLibrary(access) ? {} : showScopeFragment(access.scope)
}

/** Mongo fragment for FlatSeasons and FlatEpisodes: those of the viewer's shows. {} for the whole library. */
export function scopeEpisodeFilter(access) {
  if (isFullLibrary(access)) return {}
  return { showId: { $in: access.showIds.map((id) => new ObjectId(id)) } }
}

// Visible AND in scope, as one key ($and), so it spreads into a query beside
// the caller's own conditions without replacing them.
const both = (visible, scoped) => (Object.keys(scoped).length === 0 ? visible : { $and: [visible, scoped] })

/** The movies a viewer's lists show: visible and in their scope. */
export function libraryMovieFilter(access) {
  return both(visibleMovieFilter(), scopeMovieFilter(access))
}

/** The shows a viewer's lists show. */
export function libraryShowFilter(access) {
  return both(visibleShowFilter(), scopeShowFilter(access))
}

/** The episodes a viewer's lists show: visible, and of a show in their scope. */
export function libraryEpisodeFilter(access) {
  return both(visibleEpisodeFilter(), scopeEpisodeFilter(access))
}
