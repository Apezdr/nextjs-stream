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
 * The stored details a resolved title gives its item. A title comes only from
 * a lookup that found one, so a blank never replaces what the item has.
 * @param {Object} media - A batchResolveMedia entry that describes the title
 * @returns {{ title?: string, releaseDate: string|null }}
 */
export function sortDetailsFrom(media) {
  const title = typeof media?.title === 'string' ? media.title.trim() : ''
  const releaseDate =
    typeof media?.releaseDate === 'string' && RELEASE_DATE_FORMAT.test(media.releaseDate)
      ? media.releaseDate
      : null
  return { ...(title ? { title } : {}), releaseDate }
}

/**
 * bulkWrite updates that bring items' stored details in line with what they
 * resolved to. An item whose lookup failed is left out, so it's looked up
 * again next time; one TMDB no longer has keeps whatever it stored, and is
 * only marked, so sorting stops looking it up.
 * @param {Object[]} items - Watchlist documents
 * @param {Map} resolvedMedia - From batchResolveMedia, keyed by TMDB id
 * @param {Date} [now]
 * @returns {Object[]}
 */
export function sortDetailUpdates(items, resolvedMedia, now = new Date()) {
  const updates = []
  for (const item of items) {
    const entry = resolvedMedia.get(parseInt(item.tmdbId))
    // The map is keyed by TMDB id alone, and ids repeat across media types
    if (!entry || entry.mediaType !== item.mediaType) continue

    const details = entry.tmdbNotFound ? {} : sortDetailsFrom(entry)
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
