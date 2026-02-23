import { getVideosWatched } from '@src/utils/auth_database'
import { isAuthenticatedServer } from '@src/utils/routeAuth'
import { generateNormalizedVideoId } from '@src/utils/flatDatabaseUtils'

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
  const playbackData = watchedMedia.find(
    item => 
      item.videoId === videoId || 
      item.normalizedVideoId === normalizedVideoId
  )

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
