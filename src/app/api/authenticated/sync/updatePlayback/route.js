import { ObjectId } from 'mongodb'
import { isAuthenticatedAndApproved } from '../../../../../utils/routeAuth'
import { upsertPlayback, upsertPlaybackFromCast } from '@src/utils/watchHistory/database'
import { extractPlaybackMetadata } from '@src/utils/watchHistory/metadata'
import { normalizePlaybackKind, kindWritesPosition } from '@src/utils/watchHistory/writeKinds'
import { generateNormalizedVideoId } from '@src/utils/videoIdentity'
import { createPlaybackDeviceInfo } from '@src/utils/deviceDetection'
import { getClientIP } from '@src/utils/rateLimiter'
import { invalidateUserWatchHistoryCache } from '@src/utils/cache/invalidation'
import { upsertPresenceHeartbeat, isRepeatPausedPing } from '@src/utils/playbackPresence/database'
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
    const { videoId, playbackTime, mediaMetadata, isPaused, localIp, sessionId, source } = body

    // What this write means — see writeKinds.js. Absent means `progress`.
    const kind = normalizePlaybackKind(body.kind)
    if (kind === null) {
      return new Response(
        JSON.stringify({ error: `Invalid kind: ${String(body.kind)}` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // A keep-alive carries no position by design; every other kind must.
    const hasPosition = typeof playbackTime === 'number' && Number.isFinite(playbackTime)
    if (!videoId || (kindWritesPosition(kind) && !hasPosition)) {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid videoId or playbackTime' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // A cast mirror is the page reporting a position the TELEVISION is at, not
    // one it is rendering — which is the definition of the cast writer, so it
    // goes through the guarded cast upsert rather than the blind client one.
    // Three deliberate differences from the default path:
    //   - metadata: {} spreads nothing, so the row's grouping fields survive
    //     (the default path now also omits absent fields, but the mirror has
    //     no metadata to offer at all).
    //   - lastWriter stays 'cast', so the receiver's own reports pass the
    //     ordering guard unconditionally the moment the tab closes — including
    //     a legitimate rewind on the TV remote. A 'client' stamp would lock
    //     them out for a minute.
    //   - no presence heartbeat: mirroring is not a viewing session.
    if (source === 'cast-mirror') {
      const applied = await upsertPlaybackFromCast({
        userId: new ObjectId(authResult.id),
        videoId,
        normalizedVideoId: generateNormalizedVideoId(videoId),
        playbackTime,
        isPaused: isPaused === true,
        metadata: {},
        deviceInfo: createPlaybackDeviceInfo(req.headers.get('user-agent')),
        ipAddress: (() => {
          const ip = getClientIP(req)
          return ip && ip !== 'unknown' ? ip : null
        })(),
      })
      if (applied) await invalidateUserWatchHistoryCache(authResult.id)
      return new Response(JSON.stringify({ message: 'Cast position mirrored', applied }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
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

    // Pre-`kind` clients re-post their paused position every few minutes as a
    // plain write. Reclassify that as the keep-alive it is, so an idle paused
    // device never drags the row back over progress made elsewhere. Only an
    // undeclared kind is inferred; a client that says `progress` is believed.
    let effectiveKind = kind
    if (body.kind === undefined && isPaused === true && sessionId && hasPosition) {
      if (await isRepeatPausedPing({ userId, sessionId, playbackTime })) {
        effectiveKind = 'keepalive'
      }
    }

    let result = null
    if (kindWritesPosition(effectiveKind)) {
      log.info(
        { userId: userId.toString(), videoId, playbackTime, kind: effectiveKind },
        'Updating playback status'
      )

      // Use new WatchHistory module for atomic, efficient upsert
      // This replaces the old nested array operations with simple document upserts
      // Result: 50x faster writes, zero lock contention
      result = await upsertPlayback({
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
    } else {
      log.debug(
        { userId: userId.toString(), videoId, sessionId, inferred: body.kind === undefined },
        'Keep-alive: presence refreshed, position untouched'
      )
    }

    // Presence is a best-effort, ephemeral "is this session active" signal —
    // a failure here must never fail the durable WatchHistory write above.
    // sessionId is optional for backward compatibility with older clients,
    // and a `final` write deliberately omits it (it is paired with
    // presence/end). A keep-alive refreshes the row without a position.
    let presenceRefreshed = false
    if (sessionId) {
      try {
        presenceRefreshed = await upsertPresenceHeartbeat({
          userId,
          sessionId,
          videoId,
          playbackTime: kindWritesPosition(effectiveKind) ? playbackTime : undefined,
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

    // Invalidate user's watch history cache to ensure fresh data on next page
    // load. A keep-alive changed nothing durable, so it invalidates nothing.
    if (result) {
      await invalidateUserWatchHistoryCache(authResult.id)
    }

    return new Response(
      JSON.stringify({
        message: result ? 'Playback status updated successfully' : 'Keep-alive acknowledged',
        acknowledged: result ? result.acknowledged : presenceRefreshed,
        kind: effectiveKind,
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
