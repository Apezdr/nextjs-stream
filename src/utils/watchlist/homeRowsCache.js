import { revalidateTag } from 'next/cache'
import { bumpRevisionAfterResponse, homeRowsRevision } from '@src/utils/changes/revisions'

/**
 * Drop the home page's cached rows for these people (userPlaylistSections.js
 * tags them per person). `expire: 0` so their next visit shows the change
 * rather than the old rows while it refreshes. For Route Handlers: updateTag
 * only works in Server Actions. Also moves their home-rows stamp in
 * /api/authenticated/changes, so apps showing their home screen refetch it.
 */
export function invalidateHomeRows(userIds) {
  for (const userId of new Set(userIds)) {
    revalidateTag(`user-playlists-${userId}`, { expire: 0 })
    revalidateTag(`user-data-${userId}`, { expire: 0 })
    bumpRevisionAfterResponse(homeRowsRevision(userId))
  }
}
