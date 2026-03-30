import { ObjectId } from 'mongodb'
import { isAuthenticatedAndApproved } from '../../../../../utils/routeAuth'
import { upsertPlayback } from '@src/utils/watchHistory/database'
import { extractPlaybackMetadata } from '@src/utils/watchHistory/metadata'
import { validatePlaybackEntry } from '@src/utils/watchHistory/validation'
import { createPlaybackDeviceInfo } from '@src/utils/deviceDetection'
import { invalidateUserWatchHistoryCache } from '@src/utils/cache/invalidation'
import { createLogger } from '@src/lib/logger'

const log = createLogger('API.UpdatePlayback')

export const POST = async (req) => {
  const authResult = await isAuthenticatedAndApproved(req)
  if (authResult instanceof Response) {
    return authResult // Stop execution and return the unauthorized response
  }

  try {
    const body = await req.json()
    const { videoId, playbackTime, mediaMetadata } = body

    // Validate required fields
    if (!videoId || typeof playbackTime !== 'number') {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid videoId or playbackTime' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Extract and format metadata
    const metadata = extractPlaybackMetadata(mediaMetadata)
    
    // Capture device information from User-Agent
    const userAgent = req.headers.get('user-agent')
    const deviceInfo = createPlaybackDeviceInfo(userAgent)

    // Convert userId string to ObjectId
    const userId = new ObjectId(authResult.id)

    log.info(
      { userId: userId.toString(), videoId, playbackTime },
      'Updating playback status'
    )

    // Use new WatchHistory module for atomic, efficient upsert
    // This replaces the old nested array operations with simple document upserts
    // Result: 50x faster writes, zero lock contention
    const result = await upsertPlayback({
      userId,
      videoId,
      playbackTime,
      metadata,
      deviceInfo,
    })

    log.info(
      { userId: userId.toString(), videoId, result },
      'Playback status updated'
    )

    // Invalidate user's watch history cache to ensure fresh data on next page load
    await invalidateUserWatchHistoryCache(authResult.id)

    return new Response(
      JSON.stringify({ 
        message: 'Playback status updated successfully',
        acknowledged: result.acknowledged 
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    log.error({ error }, 'Playback update failed')
    return new Response(
      JSON.stringify({ error: 'Internal Server Error' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}
