/**
 * The order a playlist's items come back in, worked out by the database so it
 * can sort the whole playlist before paging it.
 *
 * Title and release-date order read fields stored on each item (`title`,
 * `releaseDate`), copied from what the item resolved to. They used to be
 * sorted in memory after the TMDB lookups, one page at a time, so a playlist
 * longer than a page was only sorted within each page, and the list couldn't
 * be ordered before every lookup had finished.
 *
 * Kept out of database.js, a 'use server' module, which may only export
 * async functions.
 */

import { isLibraryMediaId, titleKey } from './playlistMerge.js'
import { isMissingTitle } from './tmdbMissing.js'

/** The sorts that read the stored details; date added and custom order don't. */
export const SORTS_NEEDING_DETAILS = new Set(['title', 'releaseDate'])

/** Set once an item's stored details come from a lookup, not just its add request. */
export const DETAILS_RESOLVED_AT = 'detailsResolvedAt'

// Case-insensitive, as the in-memory sort was (toLowerCase + localeCompare)
export const TITLE_COLLATION = { locale: 'en', strength: 2 }

// An unknown release date counts as not yet released: last when ascending,
// first when descending, where the in-memory sort put it (9999-12-31)
const UNKNOWN_RELEASE_DATE = '9999-12-31'

// After every item that has a place in the custom order
const NOT_IN_CUSTOM_ORDER = Number.MAX_SAFE_INTEGER

// Ties stay newest first, as the in-memory sort left them. _id makes the order
// total, so consecutive pages never overlap or skip an item.
const NEWEST_FIRST = { dateAdded: -1, _id: -1 }

const RELEASE_DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/

/**
 * Aggregation stages that put a playlist's items in order, and the collation
 * the pipeline must run with (null when it needs none).
 * @param {Object} options
 * @param {string} options.sortBy - 'dateAdded' | 'title' | 'releaseDate' | 'custom'
 * @param {string} options.sortOrder - 'asc' | 'desc'; custom order has none
 * @param {string[]} [options.customOrder] - The playlist's item ids, in order
 * @returns {{ stages: Object[], collation: Object|null }}
 */
export function watchlistOrderStages({ sortBy, sortOrder, customOrder }) {
  const direction = sortOrder === 'asc' ? 1 : -1

  if (sortBy === 'dateAdded') {
    return { stages: [{ $sort: { dateAdded: direction, _id: direction } }], collation: null }
  }

  if (sortBy === 'title') {
    // A missing title sorts first ascending and last descending, as '' did
    return { stages: [{ $sort: { title: direction, ...NEWEST_FIRST } }], collation: TITLE_COLLATION }
  }

  if (sortBy === 'releaseDate') {
    return {
      stages: [
        { $addFields: { _releaseOrder: releaseOrderKey() } },
        { $sort: { _releaseOrder: direction, ...NEWEST_FIRST } },
        { $project: { _releaseOrder: 0 } },
      ],
      collation: null,
    }
  }

  if (sortBy === 'custom' && Array.isArray(customOrder) && customOrder.length > 0) {
    return {
      stages: [
        { $addFields: { _customOrder: customOrderKey(customOrder) } },
        { $sort: { _customOrder: 1, ...NEWEST_FIRST } },
        { $project: { _customOrder: 0 } },
      ],
      collation: null,
    }
  }

  // Custom order with nothing arranged yet, or a sort this code doesn't know
  return { stages: [{ $sort: NEWEST_FIRST }], collation: null }
}

// The stored date when there is one, otherwise UNKNOWN_RELEASE_DATE. Dates are
// stored as YYYY-MM-DD, so comparing the strings compares the dates.
function releaseOrderKey() {
  return {
    $cond: [
      { $and: [{ $eq: [{ $type: '$releaseDate' }, 'string'] }, { $gt: ['$releaseDate', ''] }] },
      '$releaseDate',
      UNKNOWN_RELEASE_DATE,
    ],
  }
}

// The item's position in the custom order, or NOT_IN_CUSTOM_ORDER. $literal
// keeps the ids from being read as field paths.
function customOrderKey(customOrder) {
  return {
    $let: {
      vars: { position: { $indexOfArray: [{ $literal: customOrder.map(String) }, { $toString: '$_id' }] } },
      in: { $cond: [{ $lt: ['$$position', 0] }, NOT_IN_CUSTOM_ORDER, '$$position'] },
    },
  }
}

/**
 * A resolved title's release date as the day it is stored and sorted by
 * (YYYY-MM-DD), or null. TMDB and the library's shows give that string. The
 * library's movies give a Date (the sync stores metadata.release_date as one,
 * at UTC midnight), which used to count as no date at all: no movie in the
 * library had a release date stored, so a list sorted by release date put
 * every one of them with the titles that have none.
 * @param {unknown} value
 * @returns {string|null}
 */
function releaseDay(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10)
  }
  return typeof value === 'string' && RELEASE_DATE_FORMAT.test(value) ? value : null
}

/**
 * The stored details a resolved title gives its item. A title comes only from
 * a lookup that found one, so a blank never replaces what the item has.
 * @param {Object} media - A batchResolveMedia entry that describes the title
 * @returns {{ title?: string, releaseDate: string|null }}
 */
export function sortDetailsFrom(media) {
  const title = typeof media?.title === 'string' ? media.title.trim() : ''
  return { ...(title ? { title } : {}), releaseDate: releaseDay(media?.releaseDate) }
}

/**
 * What a library-keyed item (a title with no TMDB id) keeps besides its sort
 * details: the poster's blurhash. If the title leaves the library there is no
 * TMDB entry to show in its place, and the poster file goes with it; the
 * stored title, release date and this are what the item is shown from.
 * @param {Object} item - Watchlist document
 * @param {Object} media - A batchResolveMedia entry that describes the title
 * @returns {{ posterBlurhash?: string|null }}
 */
function keepsakeFrom(item, media) {
  if (item.tmdbId != null || !isLibraryMediaId(item.libraryMediaId)) return {}
  return { posterBlurhash: typeof media?.posterBlurhash === 'string' ? media.posterBlurhash : null }
}

/**
 * bulkWrite updates that bring items' stored details in line with what they
 * resolved to. An item whose lookup failed is left out, so it's looked up
 * again next time; one whose title is gone (from TMDB, or from the library)
 * keeps whatever it stored, and is only marked, so sorting stops looking it up.
 * @param {Object[]} items - Watchlist documents
 * @param {Map} resolvedMedia - From batchResolveMedia, keyed by titleKey ("movie:603")
 * @param {Date} [now]
 * @returns {Object[]}
 */
export function sortDetailUpdates(items, resolvedMedia, now = new Date()) {
  const updates = []
  for (const item of items) {
    const entry = resolvedMedia.get(titleKey(item))
    if (!entry) continue

    const details = isMissingTitle(entry) ? {} : { ...sortDetailsFrom(entry), ...keepsakeFrom(item, entry) }
    const changed = Object.entries(details).some(([field, value]) => (item[field] ?? null) !== value)
    if (!changed && item[DETAILS_RESOLVED_AT]) continue

    updates.push({
      updateOne: {
        filter: { _id: item._id },
        update: { $set: { ...details, [DETAILS_RESOLVED_AT]: now } },
      },
    })
  }
  return updates
}
