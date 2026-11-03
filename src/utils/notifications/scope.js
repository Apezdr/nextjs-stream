/**
 * New-content notices and library scopes (src/lib/roles/libraryScope.ts). A
 * notice names its titles in its text, so it reaches a reader only when every
 * title it names is in their scope; it is never cut down, since the text would
 * still name what was cut. Applied when notices are delivered (each recipient
 * gets the ones their scope holds) and again when they are read, for a scope
 * that changed after delivery.
 *
 * The whole library keeps every notice, with no query. A scoped reader costs
 * one bounded lookup per collection for the titles the notices name.
 */

import clientPromise from '@src/lib/mongodb'
import { isFullLibrary } from '@src/lib/roles/libraryScope'
import { scopeMovieFilter, scopeShowFilter } from '@src/utils/mediaVisibility'
import { NOTIFICATION_TYPES } from './NotificationTypes.js'

const listOf = (value) => (Array.isArray(value) ? value : [])

/**
 * The titles a notice names, by library key, and whether that list is all of
 * them. A digest that left titles out (`moreCount`) also names shows in its
 * metadata by display title only, so it is not complete; nor is a new-content
 * notice whose titles can't be read. A notice of another kind names none.
 *
 * @returns {{ titles: Array<{ mediaType: 'movie'|'tv', originalTitle: string }>, complete: boolean }}
 */
export function noticeTitles(notice) {
  if (notice?.type !== NOTIFICATION_TYPES.NEW_CONTENT) return { titles: [], complete: true }
  const data = notice.data ?? {}
  const titles = []
  let complete = true
  const add = (mediaType, originalTitle) => {
    if (typeof originalTitle === 'string' && originalTitle) titles.push({ mediaType, originalTitle })
    else complete = false
  }
  for (const movie of listOf(data.movies)) add('movie', movie?.originalTitle)
  for (const episode of listOf(data.episodes)) add('tv', episode?.originalTitle)
  for (const item of listOf(data.items)) add(item?.kind === 'movie' ? 'movie' : 'tv', item?.originalTitle)
  if (data.moreCount > 0) complete = false
  if (titles.length === 0) complete = false
  return { titles, complete }
}

/**
 * The notices a reader with this library access may see, in their order.
 *
 * @param {Array<Object>} notices
 * @param {import('@src/lib/roles/libraryScope').LibraryAccess} access
 * @returns {Promise<Array<Object>>}
 */
export async function noticesInScope(notices, access) {
  if (isFullLibrary(access) || !Array.isArray(notices) || notices.length === 0) return notices

  const named = notices.map(noticeTitles)
  const wanted = { movie: new Set(), tv: new Set() }
  for (const { titles } of named) for (const { mediaType, originalTitle } of titles) wanted[mediaType].add(originalTitle)

  const db = (await clientPromise).db('Media')
  const inScope = async (collection, keys, scoped) =>
    keys.size === 0
      ? []
      : db
          .collection(collection)
          .find({ originalTitle: { $in: [...keys] }, ...scoped }, { projection: { originalTitle: 1 } })
          .toArray()
  const [movies, shows] = await Promise.all([
    inScope('FlatMovies', wanted.movie, scopeMovieFilter(access)),
    inScope('FlatTVShows', wanted.tv, scopeShowFilter(access)),
  ])
  const allowed = new Set([
    ...movies.map((movie) => `movie:${movie.originalTitle}`),
    ...shows.map((show) => `tv:${show.originalTitle}`),
  ])

  return notices.filter((notice, index) => {
    const { titles, complete } = named[index]
    if (notice?.type !== NOTIFICATION_TYPES.NEW_CONTENT) return true
    return complete && titles.every(({ mediaType, originalTitle }) => allowed.has(`${mediaType}:${originalTitle}`))
  })
}
