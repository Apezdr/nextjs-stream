/**
 * How the Movies and TV lists of /api/authenticated/horizontal-list are
 * ordered: in the database, before paging, so every page continues the one
 * before it. `sort` used to reorder only the page in hand, and two of its
 * three keys compared fields the cards don't have (NaN), so they didn't
 * sort at all.
 *
 *   id     date added to the library (initialDiscoveryDate). The TV app's
 *          Newest/Oldest toggle sends it.
 *   title  title, ignoring case, numbers in numeric order ("2" before "10")
 *   date   release date: a movie's release_date, a show's last_air_date
 *          (owner 2026-10-24: shows with recent episodes first)
 *
 * Every order ends on _id, so titles that share a value keep one place across
 * pages. No index backs these: the visibility filter's $or and the title
 * collation rule one out, and an in-memory sort of the whole library took
 * 4-5 ms per page on the dev library (848 movies, 237 shows).
 */
export const LIST_SORT_KEYS = Object.freeze(['id', 'title', 'date'])

/** Titles compared ignoring case, numbers in numeric order; search ranks ties in this order too. */
export const TITLE_COLLATION = Object.freeze({ locale: 'en', strength: 2, numericOrdering: true })

/**
 * The MongoDB sort (and collation, for title) for a list.
 * @param {'movie'|'tv'} type
 * @param {'id'|'title'|'date'} key
 * @param {'asc'|'desc'} order
 * @returns {{ sort: object, collation?: object }}
 */
export function listOrder(type, key, order) {
  const direction = order === 'asc' ? 1 : -1
  switch (key) {
    case 'id':
      return { sort: { initialDiscoveryDate: direction, _id: 1 } }
    case 'title':
      return { sort: { title: direction, _id: 1 }, collation: TITLE_COLLATION }
    case 'date':
      return { sort: { [type === 'tv' ? 'metadata.last_air_date' : 'metadata.release_date']: direction, _id: 1 } }
    default:
      throw new Error(`Unknown list sort "${key}": expected one of ${LIST_SORT_KEYS.join(', ')}`)
  }
}
