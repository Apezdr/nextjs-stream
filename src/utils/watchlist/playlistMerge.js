/**
 * A watchlist item's identity within a playlist. TMDB ids repeat across media
 * types (movie 920 and TV show 920 are different titles), so the type is part
 * of it. Matches the unique_playlist_title index on the Watchlist collection.
 *
 * @param {{ mediaType: string, tmdbId: number }} item
 * @returns {string}
 */
export function titleKey(item) {
  return `${item.mediaType}:${item.tmdbId}`
}

/**
 * Split items being moved into a playlist into the ones to move and the ones
 * to drop, so the move can't leave the target holding a title twice. Dropped:
 * any title the target already has, and any repeat among the items themselves
 * (the first in the order given is the one kept). Items without a TMDB id have
 * no title identity to collide on, so they always move.
 *
 * @param {Array<{ _id: any, mediaType: string, tmdbId?: number }>} items
 * @param {Array<{ mediaType: string, tmdbId?: number }>} targetItems
 * @returns {{ moveIds: any[], dropIds: any[] }}
 */
export function planPlaylistMerge(items, targetItems) {
  const present = new Set(targetItems.filter((item) => item.tmdbId != null).map(titleKey))
  const moveIds = []
  const dropIds = []

  for (const item of items) {
    if (item.tmdbId == null) {
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
