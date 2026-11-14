/**
 * True for a library title's durable id ('mid:…'), the one the media processor
 * keeps beside the title's folder and the sync copies onto its catalog
 * document as `mediaId`. A watchlist item for a title with no TMDB id is keyed
 * on it, stored as `libraryMediaId`.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isLibraryMediaId(value) {
  return typeof value === 'string' && value.startsWith('mid:') && value.length > 4
}

/**
 * True when an item says which title it is: by TMDB id, or by the library's
 * own id for a title that has none.
 *
 * @param {{ tmdbId?: number|string|null, libraryMediaId?: string|null }} item
 * @returns {boolean}
 */
export function hasTitleIdentity(item) {
  return item?.tmdbId != null || isLibraryMediaId(item?.libraryMediaId)
}

/**
 * A watchlist item's identity within a playlist. TMDB ids repeat across media
 * types (movie 920 and TV show 920 are different titles), so the type is part
 * of it. A title with no TMDB id is keyed on its library id instead, which
 * can't be mistaken for a TMDB number. Matches the unique_playlist_title and
 * unique_playlist_library_title indexes on the Watchlist collection. Also the
 * key of every watchlist lookup map (resolved media, availability, Coming
 * Soon). A numeric string id keys the same as the number.
 *
 * @param {{ mediaType: string, tmdbId?: number|string|null, libraryMediaId?: string|null }} item
 * @returns {string} e.g. "movie:920", or "movie:mid:e31a15704f374ca9"
 */
export function titleKey(item) {
  if (item.tmdbId == null && isLibraryMediaId(item.libraryMediaId)) {
    return `${item.mediaType}:${item.libraryMediaId}`
  }
  return `${item.mediaType}:${Number(item.tmdbId)}`
}

/**
 * Split items being moved into a playlist into the ones to move and the ones
 * to drop, so the move can't leave the target holding a title twice. Dropped:
 * any title the target already has, and any repeat among the items themselves
 * (the first in the order given is the one kept). Items that don't say which
 * title they are have nothing to collide on, so they always move.
 *
 * @param {Array<{ _id: any, mediaType: string, tmdbId?: number, libraryMediaId?: string }>} items
 * @param {Array<{ mediaType: string, tmdbId?: number, libraryMediaId?: string }>} targetItems
 * @returns {{ moveIds: any[], dropIds: any[] }}
 */
export function planPlaylistMerge(items, targetItems) {
  const present = new Set(targetItems.filter(hasTitleIdentity).map(titleKey))
  const moveIds = []
  const dropIds = []

  for (const item of items) {
    if (!hasTitleIdentity(item)) {
      moveIds.push(item._id)
      continue
    }
    const key = titleKey(item)
    if (present.has(key)) {
      dropIds.push(item._id)
    } else {
      present.add(key)
      moveIds.push(item._id)
    }
  }

  return { moveIds, dropIds }
}
