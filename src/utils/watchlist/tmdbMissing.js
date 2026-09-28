/**
 * Titles TMDB no longer has.
 *
 * The media processor answers 404 (code TMDB_NOT_FOUND) when TMDB has no such
 * title, typically one TMDB deleted after it was added to a watchlist. Such an
 * item used to stay unresolved and show as "Unknown Title"; it now resolves to
 * a placeholder that says what happened. Kept out of mediaResolver.js, a
 * 'use server' module, which may only export async functions.
 */

export const TMDB_MISSING_TITLE = 'No longer on TMDB'

/**
 * True when a failed TMDB lookup means TMDB has no such title, as opposed to an
 * outage or a bug, which leave the item unresolved so a later load can retry.
 * Needs the media processor's code as well as the 404: a 404 without it (a
 * route missing after a bad deploy, a wrong backend URL) says nothing about
 * the title, and would label every external item at once.
 * @param {unknown} reason - The rejection from the TMDB lookup (httpGet's error,
 *   which carries the status and the response body)
 * @returns {boolean}
 */
export function isTmdbNotFound(reason) {
  if (reason?.statusCode !== 404) return false
  try {
    return JSON.parse(reason.response?.body ?? '')?.code === 'TMDB_NOT_FOUND'
  } catch {
    return false
  }
}

/**
 * The resolved-media shape for a title TMDB no longer has: the same fields a
 * successful external lookup yields, with nothing to show but the label.
 * Watchlist code reads it through asResolvedMedia and untitledLabel below, so
 * what an item stored when it was added (its title, poster) still comes first.
 * @param {number} tmdbId
 * @param {string} mediaType - 'movie' or 'tv'
 * @returns {Object}
 */
export function missingFromTmdbMedia(tmdbId, mediaType) {
  return {
    tmdbId,
    mediaType,
    currentMediaId: null,
    title: TMDB_MISSING_TITLE,
    tmdbNotFound: true,
    posterURL: '/sorry-image-not-available.jpg',
    posterBlurhash: null,
    backdropURL: null,
    backdropBlurhash: null,
    overview: null,
    releaseDate: null,
    genres: [],
    voteAverage: null,
    isInternal: false,
    isExternal: true,
    isAvailable: false,
    url: null,
    link: null,
  }
}

/**
 * A batchResolveMedia entry as media, or null for a title TMDB no longer has.
 * That placeholder goes the way of an unresolved item, whose fallbacks use the
 * item's own stored details; treated as media, its label and stock poster
 * would replace them.
 * @param {Object|undefined} entry - From batchResolveMedia's map
 * @returns {Object|null}
 */
export function asResolvedMedia(entry) {
  return entry && !entry.tmdbNotFound ? entry : null
}

/**
 * The title for an item with none of its own: the label for a title TMDB no
 * longer has, "Unknown Title" otherwise.
 * @param {Object|undefined} entry - From batchResolveMedia's map
 * @returns {string}
 */
export function untitledLabel(entry) {
  return entry?.tmdbNotFound ? TMDB_MISSING_TITLE : 'Unknown Title'
}
