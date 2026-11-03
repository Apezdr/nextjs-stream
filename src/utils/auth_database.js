'use server'

import { getSession } from '@src/lib/cachedAuth'
import { libraryAccessFor } from '@src/lib/roles/libraryAccess'
import { findPlaybackForUser } from '@src/utils/watchHistory/database'
import { watchRowsInScope } from '@src/utils/watchHistory/scopeRows'

// A Server Action (any client can call it), so the user and their library
// scope come from the session, never from the caller.
export async function getVideosWatched() {
  const session = await getSession();

  if (!session?.user) {
    return null
  }

  // Query WatchHistory using centralized function
  const watchHistory = await findPlaybackForUser(session.user.id)

  // Return array of watch entries (compatible with existing code), without
  // the titles outside the user's library scope
  return watchHistory && watchHistory.length > 0
    ? watchRowsInScope(watchHistory, await libraryAccessFor(session.user))
    : []
}
