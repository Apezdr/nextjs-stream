import { REVISION, stamp } from '@src/utils/changes/revisions'

/**
 * This route's part of GET /api/authenticated/changes: playlist contents move
 * with any playlist write and with the library (availability). One stamp for
 * every playlist, see REVISION.PLAYLISTS.
 */
export function watchlistContentChanges() {
  return stamp(REVISION.PLAYLISTS, REVISION.LIBRARY)
}
