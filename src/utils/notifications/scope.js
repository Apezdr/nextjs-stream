/**
 * New-content notices and library scopes (src/lib/roles/libraryScope.ts). A
 * notice names its titles in its text, so it reaches a reader only when every
 * title it names is in their scope; it is never cut down, since the text would
 * still name what was cut. Applied when notices are delivered (each recipient
 * gets the ones their scope holds) and when they are read, listed and counted,
 * for a scope that changed after delivery.
 *
 * Checked in memory against the scope's index (libraryAccess.ts: the library
 * keys of the movies and shows in scope, worked out once per scope), so a poll
 * reads no library collection. The whole library keeps every notice.
 */

import { libraryScopeIndex } from '@src/lib/roles/libraryAccess'
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

/** Whether a reader whose scope has this index may see the notice. */
function visibleWith(index, notice) {
  if (notice?.type !== NOTIFICATION_TYPES.NEW_CONTENT) return true
  const { titles, complete } = noticeTitles(notice)
  return (
    complete &&
    titles.every(({ mediaType, originalTitle }) =>
      (mediaType === 'movie' ? index.movieKeys : index.showKeys).has(originalTitle)
    )
  )
}

/**
 * The notices a reader with this library access may see, in their order.
 *
 * @param {Array<Object>} notices
 * @param {import('@src/lib/roles/libraryScope').LibraryAccess} access
 * @returns {Promise<Array<Object>>}
 */
export async function noticesInScope(notices, access) {
  const index = await libraryScopeIndex(access)
  if (!index || !Array.isArray(notices) || notices.length === 0) return notices
  return notices.filter((notice) => visibleWith(index, notice))
}

/** What a hidden-notice check reads of each notification: its kind and the titles it names. */
export const NOTICE_TITLE_PROJECTION = Object.freeze({
  type: 1,
  'data.movies.originalTitle': 1,
  'data.episodes.originalTitle': 1,
  'data.items.originalTitle': 1,
  'data.items.kind': 1,
  'data.moreCount': 1,
})

/**
 * The ids of a reader's new-content notices their scope hides, for the
 * notification queries to leave out of the page and every count. Null for the
 * whole library (no read at all). Otherwise one read of the reader's own
 * new-content notices, titles only: bounded by their retention (the TTL
 * indexes in notificationDatabase.js), and empty in the usual case, since
 * delivery already held each notice to its recipient's scope.
 *
 * @param {import('mongodb').Collection} collection - Notifications
 * @param {import('mongodb').ObjectId} userObjectId
 * @param {import('@src/lib/roles/libraryScope').LibraryAccess} access
 * @returns {Promise<Array<import('mongodb').ObjectId>|null>}
 */
export async function hiddenNoticeIds(collection, userObjectId, access) {
  const index = await libraryScopeIndex(access)
  if (!index) return null
  const notices = await collection
    .find({ userId: userObjectId, type: NOTIFICATION_TYPES.NEW_CONTENT }, { projection: NOTICE_TITLE_PROJECTION })
    .toArray()
  return notices.filter((notice) => !visibleWith(index, notice)).map((notice) => notice._id)
}
