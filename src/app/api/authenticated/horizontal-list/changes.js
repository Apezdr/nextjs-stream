import { REVISION, stamp, watchHistoryRevision } from '@src/utils/changes/revisions'

/**
 * This route's part of GET /api/authenticated/changes: one stamp per `type`.
 * A request for a type is worth repeating only when its stamp moved. A row
 * fetched with includeWatchHistory=true also changes with the person's
 * playback, so it follows the recentlyWatched stamp as well as its own.
 * @param {string} userId
 */
export function horizontalListChanges(userId) {
  const library = stamp(REVISION.LIBRARY)
  return {
    recentlyWatched: stamp(watchHistoryRevision(userId), REVISION.LIBRARY),
    recentlyAdded: library,
    movie: library,
    tv: library,
    all: library,
    recommendations: stamp(watchHistoryRevision(userId), REVISION.LIBRARY),
    // Every playlist row (type=playlist&playlistId=…): its items, and whether they're in the library
    playlist: stamp(REVISION.PLAYLISTS, REVISION.LIBRARY),
  }
}
