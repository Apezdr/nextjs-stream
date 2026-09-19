import { getVideosWatched } from '@src/utils/auth_database'
import { isAuthenticatedServer } from '@src/utils/routeAuth'
import { generateNormalizedVideoId } from '@src/utils/flatDatabaseUtils'
import { resolveMediaIdForNid } from '@src/utils/watchHistory/mediaIdResolver'
import { computeWatchProgress } from '@src/utils/watchHistory/progress'

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

  // The catalog identity for this URL (cached, fail-open): the durable
  // 'mid:…' for the rename-proof fallback below, and the runtime for the
  // completion flag the web player uses on an Activity re-show.
  const resolved = await resolveMediaIdForNid(normalizedVideoId)

  // Rename-proof fallback: no row is keyed under this URL/nid (e.g. the file
  // was re-encoded or renamed, so its nid changed). Take the newest row
  // stamped with the durable identity. Additive only — the exact URL/nid
  // matches above always win, and a null resolution degrades gracefully.
  if (!playbackData) {
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
        completed: false,
        progressPercent: 0,
        found: false
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const progress = computeWatchProgress(playbackData.playbackTime || 0, resolved?.durationMs ?? null)

  return new Response(
    JSON.stringify({
      videoId: playbackData.videoId,
      playbackTime: playbackData.playbackTime || 0,
      lastUpdated: playbackData.lastUpdated,
      completed: progress.completed,
      progressPercent: progress.progressPercent,
      found: true
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}
