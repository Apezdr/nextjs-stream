import 'server-only'

import { getCachedMediaWithRedirect } from '@src/utils/cache/mediaFetching'
import { readTitlePosition } from '@src/utils/watchHistory/titlePosition'
import { isDurableMediaId } from '@src/utils/watchHistory/resolve'
import { createLogger } from '@src/lib/logger'
import PlaybackSeed from './PlaybackSeed'

const log = createLogger('WatchProgress.Seed')

const isoOrNull = (value) => {
  const date = value ? new Date(value) : null
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null
}

/**
 * The viewer's position in a details page's title, read with the page and
 * handed to the browser beside the cached subtree.
 *
 * A movie or episode details page is cached for every viewer with the same
 * library scope, so its HTML cannot say "Resume". This is the page's one
 * per-viewer read: the title's row (an indexed point read, the same one
 * GET /sync/playback makes), rendered as a <PlaybackSeed> that puts it in the
 * positions store as the page hydrates. The button then has its word without
 * a request of its own.
 *
 * Render it inside the page's session gate, in its own Suspense boundary
 * with no fallback, AFTER the cached content: it is a request-time read, so
 * a link's prefetch stops at it and carries the cached content without it.
 * Never inside a 'use cache' function.
 *
 * The media comes from the same cached fetch the page's content makes (one
 * entry, keyed by the viewer's scope). Nothing is rendered for a title the
 * page does not show (not found, a redirect) or that has no identity to file
 * a position under (a trailer stand-in), nor when the read fails: the store
 * then asks for the title itself, and says so if that fails too.
 *
 * Server component.
 *
 * @param {Object} props
 * @param {Object} props.parsedParams - the page's parsed route params, as its content passes them to the cached fetch
 * @param {{ user: { id: string }, access: import('@src/lib/roles/libraryScope').LibraryAccess }} props.session - from SessionGate
 */
export default async function TitlePlaybackSeed({ parsedParams, session }) {
  const userId = session?.user?.id
  if (!userId) return null

  const { media, redirectUrl, notFoundType } = await getCachedMediaWithRedirect(parsedParams, session.access.id)
  if (!media || redirectUrl || notFoundType) return null

  const title = {
    mediaId: isDurableMediaId(media.mediaId) ? media.mediaId : null,
    normalizedVideoId: typeof media.normalizedVideoId === 'string' && media.normalizedVideoId ? media.normalizedVideoId : null,
  }
  const videoId = typeof media.videoURL === 'string' && media.videoURL ? media.videoURL : null
  if ((!title.mediaId && !title.normalizedVideoId) || (!title.mediaId && !videoId)) return null

  let position
  try {
    position = await readTitlePosition({ userId, getAccess: async () => session.access, videoId, mediaId: title.mediaId })
  } catch (error) {
    // Not a seed of "no row": the store asks, and shows that it could not find out
    log.error({ err: error, userId }, 'Failed to read the position for a details page')
    return null
  }

  return (
    <PlaybackSeed
      userId={userId}
      title={title}
      entry={{
        found: position.found,
        mediaId: position.mediaId,
        normalizedVideoId: position.normalizedVideoId,
        playbackTime: position.playbackTime,
        lastUpdated: isoOrNull(position.lastUpdated),
        asOf: position.asOf,
      }}
    />
  )
}
