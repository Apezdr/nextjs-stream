import { ObjectId } from 'mongodb'
import { isAuthenticatedAndApproved } from '../../../../../utils/routeAuth'
import { upsertPlayback } from '@src/utils/watchHistory/database'
import { extractPlaybackMetadata } from '@src/utils/watchHistory/metadata'
import { createPlaybackDeviceInfo } from '@src/utils/deviceDetection'
import { getClientIP } from '@src/utils/rateLimiter'
import { invalidateUserWatchHistoryCache } from '@src/utils/cache/invalidation'
import { upsertPresenceHeartbeat } from '@src/utils/playbackPresence/database'
import { createLogger } from '@src/lib/logger'

const log = createLogger('API.UpdatePlayback')

// Validate a client-reported IP (IPv4 or IPv6). This value is self-reported by the
// player (a native app or the browser WebRTC probe), so it's informational only —
// reject mDNS ".local" hostnames and any non-IP junk before storing.
function isValidClientIp(value) {
  if (typeof value !== 'string') return false
  const ip = value.trim()
  if (!ip || ip.length > 45) return false
  if (/[^0-9a-fA-F:.%]/.test(ip)) return false
  if (/^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}$/.test(ip)) return true
  if (ip.includes(':') && (ip.match(/:/g) || []).length >= 2) return true
  return false
}

export const POST = async (req) => {
  const authResult = await isAuthenticatedAndApproved(req)
  if (authResult instanceof Response) {
    return authResult // Stop execution and return the unauthorized response
  }

  try {
    const body = await req.json()
    const { videoId, playbackTime, mediaMetadata, isPaused, localIp, sessionId } = body

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

    // Capture client IP (proxy-aware). getClientIP returns 'unknown' when no
    // forwarded-IP header is present — store null in that case rather than a literal.
    const clientIp = getClientIP(req)
    const ipAddress = clientIp && clientIp !== 'unknown' ? clientIp : null

    // Optional device-reported local/LAN IP (validated; spoofable, so informational).
    const reportedLocalIp = isValidClientIp(localIp) ? localIp.trim() : null

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
      ipAddress,
      localIp: reportedLocalIp,
      isPaused: isPaused === true,
    })

    log.info(
      { userId: userId.toString(), videoId, result },
      'Playback status updated'
    )

    // Presence is a best-effort, ephemeral "is this session active" signal —
    // a failure here must never fail the durable WatchHistory write above.
    // sessionId is optional for backward compatibility with older clients.
    if (sessionId) {
      try {
        await upsertPresenceHeartbeat({
          userId,
          sessionId,
          videoId,
          playbackTime,
          isPaused: isPaused === true,
          metadata,
          deviceInfo,
          ipAddress,
          localIp: reportedLocalIp,
        })
      } catch (error) {
        log.error({ error, userId: userId.toString(), sessionId }, 'Presence heartbeat failed')
      }
    }

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
