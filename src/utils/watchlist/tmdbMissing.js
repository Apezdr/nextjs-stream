/**
 * Titles that are gone from where a watchlist item reads them: from TMDB, or
 * (for a title with no TMDB id) from the library.
 *
 * The media processor answers 404 (code TMDB_NOT_FOUND) when TMDB has no such
 * title, typically one TMDB deleted after it was added to a watchlist. Such an
 * item used to stay unresolved and show as "Unknown Title"; it now resolves to
 * a placeholder that says what happened. A library title with no TMDB id that
 * leaves the library gets the same treatment (missingFromLibraryMedia). Kept
 * out of mediaResolver.js, a 'use server' module, which may only export async
 * functions.
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

export const LIBRARY_MISSING_TITLE = 'No longer in the library'

/**
 * The resolved-media shape for a title the library no longer has, kept on a
 * list under its library id because it has no TMDB id. Unlike a TMDB title
 * that leaves the library, there is nowhere else to read it from: what the
 * item stored when it was added (its title, its poster's blurhash) is all
 * there is to show. The item stays until someone removes it, and matches the
 * title again if it comes back under the same library id.
 *
 * Only a lookup that ran and found nothing yields this. One that failed
 * throws, so an outage never labels a list's titles as removed.
 * @param {string} libraryMediaId - The title's library id ('mid:…')
 * @param {string} mediaType - 'movie' or 'tv'
 * @returns {Object}
 */
export function missingFromLibraryMedia(libraryMediaId, mediaType) {
  return {
    tmdbId: null,
    libraryMediaId,
    mediaType,
    currentMediaId: null,
    title: LIBRARY_MISSING_TITLE,
    libraryMissing: true,
    posterURL: '/sorry-image-not-available.jpg',
    posterBlurhash: null,
    backdropURL: null,
    backdropBlurhash: null,
    overview: null,
    releaseDate: null,
    genres: [],
    voteAverage: null,
    isInternal: false,
    isExternal: false,
    isAvailable: false,
    url: null,
    link: null,
  }
}

/** True for either placeholder: a title gone from TMDB, or from the library. */
export function isMissingTitle(entry) {
  return Boolean(entry?.tmdbNotFound || entry?.libraryMissing)
}

/**
 * A batchResolveMedia entry as media, or null for a title that is gone (from
 * TMDB, or from the library). That placeholder goes the way of an unresolved
 * item, whose fallbacks use the item's own stored details; treated as media,
 * its label and stock poster would replace them.
 * @param {Object|undefined} entry - From batchResolveMedia's map
 * @returns {Object|null}
 */
export function asResolvedMedia(entry) {
  return entry && !isMissingTitle(entry) ? entry : null
}

/**
 * The title for an item with none of its own: the label for a title that is
 * gone, "Unknown Title" otherwise.
 * @param {Object|undefined} entry - From batchResolveMedia's map
 * @returns {string}
 */
export function untitledLabel(entry) {
  if (entry?.tmdbNotFound) return TMDB_MISSING_TITLE
  if (entry?.libraryMissing) return LIBRARY_MISSING_TITLE
  return 'Unknown Title'
}
