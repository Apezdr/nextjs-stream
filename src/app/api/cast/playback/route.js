/**
 * POST /api/cast/playback
 *
 * Where a Cast receiver reports the position of what it is playing, so that
 * closing the tab mid-cast no longer means the rest of the film goes
 * unrecorded. The receiver is the only caller.
 *
 * It sits outside /api/authenticated/ on purpose. That prefix means "a
 * better-auth session or bearer token" everywhere else in this codebase, and
 * teaching isAuthenticatedAndApproved to also accept a cast token would widen
 * every route that helper guards — including the admin ones — to a credential
 * that travels through a television. A different credential gets a different
 * path.
 *
 * updatePlayback is not reused for the same reason, plus it trusts the body for
 * both videoId and mediaMetadata. Here neither is trusted: the identity of the
 * title and all of its metadata come out of the token's signature, and anything
 * the caller sends alongside is discarded.
 */

import { ObjectId } from 'mongodb'
import { verifyCastPlaybackToken, refreshIfDue } from '@src/lib/castPlaybackToken'
import { upsertPlaybackFromCast } from '@src/utils/watchHistory/database'
import { generateNormalizedVideoId } from '@src/utils/videoIdentity'
import { createPlaybackDeviceInfo } from '@src/utils/deviceDetection'
import { getClientIP, checkRateLimit, createRateLimitHeaders } from '@src/utils/rateLimiter'
import { invalidateUserWatchHistoryCache } from '@src/utils/cache/invalidation'
import { createLogger } from '@src/lib/logger'

// No `runtime`/`dynamic` segment config: cacheComponents rejects both, and a
// POST handler is uncached and Node-runtime by default regardless.
const log = createLogger('API.CastPlayback')

// A receiver reports every 15 s while playing, so a long session is ~240/hour.
// 600 leaves room for seeks and pauses without letting a stuck device hammer.
const RATE_LIMIT = { maxRequests: 600, windowMs: 60 * 60 * 1000 }

function json(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extraHeaders },
  })
}

export async function POST(req) {
  const rl = checkRateLimit(req, RATE_LIMIT, 'cast_playback')
  if (rl.isLimited) {
    return json(429, { ok: false, code: 'RATE_LIMITED' }, createRateLimitHeaders(rl))
  }

  let body
  try {
    body = await req.json()
  } catch {
    return json(400, { ok: false, code: 'BAD_REQUEST' })
  }

  // The token travels in the body rather than a header because the receiver's
  // last report — the one sent as the app is torn down — goes out through
  // navigator.sendBeacon, which cannot set headers. Body placement lets the
  // beacon and the ordinary fetch carry byte-identical payloads.
  const { token, videoId, playbackTime, isPaused, castSessionId } = body || {}

  const verified = verifyCastPlaybackToken(token)
  if (!verified.ok) return json(401, { ok: false, code: verified.code })
  const { claims } = verified

  if (
    !videoId ||
    typeof videoId !== 'string' ||
    typeof playbackTime !== 'number' ||
    !Number.isFinite(playbackTime) ||
    playbackTime < 0
  ) {
    return json(400, { ok: false, code: 'BAD_REQUEST' })
  }

  // The token names exactly one title. Recomputing the identity from the URL
  // the receiver actually loaded, and demanding it match the signed claim, is
  // what stops a token for one film from writing a position onto another.
  if (generateNormalizedVideoId(videoId) !== claims.n) {
    return json(403, { ok: false, code: 'CAST_TOKEN_SCOPE_MISMATCH' })
  }

  try {
    const clientIp = getClientIP(req)
    const applied = await upsertPlaybackFromCast({
      userId: new ObjectId(claims.u),
      videoId,
      normalizedVideoId: claims.n,
      playbackTime,
      isPaused: isPaused === true,
      // Signed claims only. Metadata decides how Continue Watching groups an
      // episode, so letting the body supply it would let a token holder
      // scramble someone's rails.
      metadata: {
        mediaType: claims.m?.t ?? null,
        showId: claims.m?.s ?? null,
        seasonNumber: claims.m?.sn ?? null,
        episodeNumber: claims.m?.en ?? null,
      },
      deviceInfo: createPlaybackDeviceInfo(req.headers.get('user-agent')),
      ipAddress: clientIp && clientIp !== 'unknown' ? clientIp : null,
      castSessionId: typeof castSessionId === 'string' ? castSessionId.slice(0, 64) : null,
    })

    // Only on a write that landed — a rejected stale report changed nothing, so
    // there is nothing to invalidate.
    if (applied) await invalidateUserWatchHistoryCache(claims.u)

    // A cast session can outlast the token that started it. Rolling it here
    // keeps a long evening reporting without ever handing out a long-lived
    // credential; refreshIfDue returns null once the 24 h chain cap is reached,
    // and the receiver then simply falls silent.
    const rolled = refreshIfDue(claims)

    return json(200, { ok: true, applied, ...(rolled && { token: rolled }) })
  } catch (error) {
    log.error({ error, userId: claims.u, videoId }, 'Cast playback report failed')
    return json(500, { ok: false, code: 'INTERNAL_ERROR' })
  }
}
