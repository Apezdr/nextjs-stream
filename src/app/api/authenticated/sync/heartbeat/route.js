import { isAuthenticatedEither } from '@src/utils/routeAuth'
import { upsertActiveSession, removeActiveSession } from '@src/utils/activeSessions'

/**
 * POST /api/authenticated/sync/heartbeat
 *
 * Called periodically by the media player to register an active playback session.
 * This keeps the session alive in the ActiveSessions collection.
 * Sessions auto-expire via TTL index if heartbeats stop.
 *
 * Body: {
 *   videoId: string,
 *   playbackTime: number,
 *   duration: number,
 *   mediaMetadata: {
 *     mediaType: 'movie' | 'tv',
 *     mediaTitle: string,
 *     showName: string?,
 *     seasonNumber: number?,
 *     episodeNumber: number?,
 *     episodeTitle: string?,
 *     year: number?,
 *     quality: string?,
 *     videoCodec: string?,
 *     audioCodec: string?,
 *     container: string?,
 *     fileSize: number?,
 *     filePath: string?,
 *     bandwidth: number?,
 *     serverName: string?,
 *   },
 *   action: 'heartbeat' | 'stop'  // 'stop' removes the session immediately
 * }
 */
export async function POST(req) {
  const authResult = await isAuthenticatedEither(req)
  if (authResult instanceof Response) return authResult

  try {
    const body = await req.json()
    const { videoId, playbackTime, duration, mediaMetadata, action } = body

    if (!videoId) {
      return Response.json(
        { error: 'videoId is required' },
        { status: 400 }
      )
    }

    // If action is 'stop', remove the session immediately
    if (action === 'stop') {
      await removeActiveSession(authResult.id, videoId)
      return Response.json({ success: true, action: 'stopped' })
    }

    // Get client IP from headers (X-Forwarded-For set by reverse proxy, or direct connection)
    const ipAddress =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      null

    const userAgent = req.headers.get('user-agent')

    const session = await upsertActiveSession({
      userId: authResult.id,
      userName: authResult.name || authResult.email || 'Unknown',
      videoId,
      mediaTitle: mediaMetadata?.mediaTitle || 'Unknown',
      mediaType: mediaMetadata?.mediaType || 'unknown',
      showName: mediaMetadata?.showName || null,
      seasonNumber: mediaMetadata?.seasonNumber || null,
      episodeNumber: mediaMetadata?.episodeNumber || null,
      episodeTitle: mediaMetadata?.episodeTitle || null,
      year: mediaMetadata?.year || null,
      duration: duration || null,
      playbackTime: playbackTime || 0,
      quality: mediaMetadata?.quality || null,
      videoCodec: mediaMetadata?.videoCodec || null,
      audioCodec: mediaMetadata?.audioCodec || null,
      container: mediaMetadata?.container || null,
      fileSize: mediaMetadata?.fileSize || null,
      filePath: mediaMetadata?.filePath || null,
      bandwidth: mediaMetadata?.bandwidth || null,
      serverName: mediaMetadata?.serverName || null,
      userAgent,
      ipAddress,
    })

    return Response.json({
      success: true,
      action: 'heartbeat',
      sessionId: session.sessionId,
    })
  } catch (err) {
    console.error('Error in heartbeat API:', err)
    return Response.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
