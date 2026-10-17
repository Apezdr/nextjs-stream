'use server'

import { getSession } from '@src/lib/cachedAuth'
import { findPlaybackForUser } from '@src/utils/watchHistory/database'

export async function getVideosWatched() {
  const session = await getSession();

  if (!session?.user) {
    return null
  }

  // Query WatchHistory using centralized function
  const watchHistory = await findPlaybackForUser(session.user.id)

  // Return array of watch entries (compatible with existing code)
  return watchHistory && watchHistory.length > 0 ? watchHistory : []
}
