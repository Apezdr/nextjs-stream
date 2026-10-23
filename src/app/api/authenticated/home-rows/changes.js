import { REVISION, homeRowsRevision, stamp } from '@src/utils/changes/revisions'

/**
 * This route's part of GET /api/authenticated/changes: the person's rows, plus
 * the playlists they're drawn from (names, item counts, sharing).
 * @param {string} userId
 */
export function homeRowsChanges(userId) {
  return stamp(homeRowsRevision(userId), REVISION.PLAYLISTS)
}
