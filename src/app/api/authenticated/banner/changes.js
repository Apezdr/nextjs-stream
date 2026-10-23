import { REVISION, stamp } from '@src/utils/changes/revisions'

/**
 * This route's part of GET /api/authenticated/changes: the banner is the
 * newest movies, so it moves only with the library.
 */
export function bannerChanges() {
  return stamp(REVISION.LIBRARY)
}
