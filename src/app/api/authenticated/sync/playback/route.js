import { getVideosWatched } from '@src/utils/auth_database'
import { isAuthenticatedServer } from '@src/utils/routeAuth'
import { generateNormalizedVideoId } from '@src/utils/flatDatabaseUtils'
import { resolveMediaIdForNid } from '@src/utils/watchHistory/mediaIdResolver'

/**
 * Get playback position for a specific video (on-demand fetch)
 * Used when video player loads and the video isn't in recent sync cache
 */
export async function GET(req) {
  const authResult = await isAuthenticatedServer()
  if (authResult instanceof Response) {
    return authResult
  }

  const { searchParams } = new URL(req.url)
  const videoId = searchParams.get('videoId')

  if (!videoId) {
    return new Response(
      JSON.stringify({ error: 'videoId parameter required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // Get all watch history (this is cached in getVideosWatched)
  const watchedMedia = await getVideosWatched()
  
  // Normalize the requested videoId for matching
  const normalizedVideoId = generateNormalizedVideoId(videoId)

  // Find playback position for this specific video
  let playbackData = watchedMedia.find(
    item =>
      item.videoId === videoId ||
      item.normalizedVideoId === normalizedVideoId
  )

  // Rename-proof fallback: no row is keyed under this URL/nid (e.g. the file
  // was re-encoded or renamed, so its nid changed). Resolve the URL's durable
  // content identity ('mid:…') from the catalog (cached, fail-open) and take
  // the newest row stamped with it. Additive only — the exact URL/nid matches
  // above always win, and a null resolution degrades to today's behavior.
  if (!playbackData) {
    const resolved = await resolveMediaIdForNid(normalizedVideoId)
    if (resolved?.mediaId) {
      playbackData = watchedMedia
        .filter(item => item.mediaId === resolved.mediaId)
        .sort(
          (a, b) => new Date(b.lastUpdated || 0).getTime() - new Date(a.lastUpdated || 0).getTime()
        )[0] || null
    }
  }

  if (!playbackData) {
    return new Response(
      JSON.stringify({
        videoId,
        playbackTime: 0,
        lastUpdated: null,
        found: false
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  return new Response(
    JSON.stringify({
      videoId: playbackData.videoId,
      playbackTime: playbackData.playbackTime || 0,
      lastUpdated: playbackData.lastUpdated,
      found: true
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}
