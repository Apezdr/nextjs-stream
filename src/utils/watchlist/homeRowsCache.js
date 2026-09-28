import { revalidateTag } from 'next/cache'

/**
 * Drop the home page's cached rows for these people (userPlaylistSections.js
 * tags them per person). `expire: 0` so their next visit shows the change
 * rather than the old rows while it refreshes. For Route Handlers: updateTag
 * only works in Server Actions.
 */
export function invalidateHomeRows(userIds) {
  for (const userId of new Set(userIds)) {
    revalidateTag(`user-playlists-${userId}`, { expire: 0 })
    revalidateTag(`user-data-${userId}`, { expire: 0 })
  }
}
