/**
 * What POST /api/authenticated/search accepts, and how it ranks titles.
 *
 * Search pages through its results like the lists do. A typed query used to
 * return every match at once: "the" was 336 results and 3.8 MB on the owner's
 * server, downloaded again on every pause while typing. Clients ask for
 * `page` (0-based) and `limit`, and get `total` and `hasNextPage` beside
 * `results`. `types` (['movie'], ['tv'] or both, the default) limits them to
 * movies or shows.
 */
export const SEARCH_LIMIT_DEFAULT = 30
export const SEARCH_LIMIT_MAX = 50
export const SEARCH_TYPES = Object.freeze(['movie', 'tv'])
const PAGE_MAX = 10000

/** Page and limit, clamped instead of rejected (as horizontal-list does) so an odd value still gets a page. */
export function pageParams(page, limit) {
  const parsedPage = Number.parseInt(page, 10)
  const parsedLimit = Number.parseInt(limit, 10)
  return {
    page: Number.isNaN(parsedPage) ? 0 : Math.min(Math.max(parsedPage, 0), PAGE_MAX),
    limit: Number.isNaN(parsedLimit) ? SEARCH_LIMIT_DEFAULT : Math.min(Math.max(parsedLimit, 1), SEARCH_LIMIT_MAX),
  }
}

/** The kinds to search: both when absent, null (a 400) unless it names at least one known kind. */
export function searchTypes(types) {
  if (types === undefined || types === null) return [...SEARCH_TYPES]
  if (!Array.isArray(types) || types.length === 0 || !types.every((type) => SEARCH_TYPES.includes(type))) {
    return null
  }
  return SEARCH_TYPES.filter((type) => types.includes(type))
}

// An English title's leading article, so "matrix" is an exact match for "The Matrix"
const ARTICLE = '(?:(?:the|a|an)\\s+)?'
const WORD_END = '(?:\\W|$)'

/**
 * How well a title matches an escaped query, best first; a title matching
 * none of these only contains the query somewhere (the last rank). Titles in
 * the same rank are A-Z.
 *   0  the whole title, leaving out a leading article ("matrix": The Matrix)
 *   1  the title starts with the query as whole words ("star": Star Wars)
 *   2  the title starts with the query ("star": Stardust)
 *   3  a later word starts with the query as whole words ("night": Into the Night)
 *   4  a later word starts with the query ("star": The Last Starfighter)
 * @param {string} pattern - the query, already escaped for a regex
 * @returns {string[]}
 */
export function matchRanks(pattern) {
  return [
    `^${ARTICLE}${pattern}$`,
    `^${ARTICLE}${pattern}${WORD_END}`,
    `^${ARTICLE}${pattern}`,
    `\\W${pattern}${WORD_END}`,
    `\\W${pattern}`,
  ]
}
