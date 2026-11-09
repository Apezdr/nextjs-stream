/**
 * POST /api/cast/playback
 *
 * Where a Cast receiver reports the position of what it is playing, so that
 * closing the tab mid-cast no longer means the rest of the film goes
 * unrecorded. The receiver is the only caller.
 *
 * It sits outside /api/authenticated/ on purpose. That prefix means "a
 * better-auth session or bearer token" everywhere else in this codebase, and
 * teaching the session gates (src/lib/roles/gates.ts) to also accept a cast
 * token would widen every route they guard — including the admin ones — to a
 * credential that travels through a television. A different credential gets a
 * different path.
 *
 * updatePlayback is not reused for the same reason, plus it trusts the body for
 * both videoId and mediaMetadata. Here neither is trusted: the identity of the
 * title and all of its metadata come out of the token's signature, and anything
 * the caller sends alongside is discarded.
 *
 * Each report also keeps the cast's presence row live, so a title playing on a
 * TV reads as watching (plans/media-activity-presence.md). The receiver is that
 * row's only writer, sender or not; while a sender is connected the sender owns
 * the position, and the receiver's reports say `presenceOnly: true`. A report
 * with `final: true` (the stop, the end of the title, the receiver shutting
 * down, another title loading over it) ends the row, and may carry no position
 * when there is none worth saving.
 */

import { ObjectId } from 'mongodb'
import { verifyCastPlaybackToken, refreshIfDue } from '@src/lib/castPlaybackToken'
import { upsertPlaybackFromCast } from '@src/utils/watchHistory/database'
import { generateNormalizedVideoId } from '@src/utils/videoIdentity'
import { createPlaybackDeviceInfo } from '@src/utils/deviceDetection'
import { getClientIP, checkRateLimit, createRateLimitHeaders } from '@src/utils/rateLimiter'
import { invalidateUserWatchHistoryCache } from '@src/utils/cache/invalidation'
import { upsertPresenceHeartbeat, endPresenceSession } from '@src/utils/playbackPresence/database'
import { createLogger } from '@src/lib/logger'
import { recordUserCaller } from '@src/lib/requestCaller'

// No `runtime`/`dynamic` segment config: cacheComponents rejects both, and a
// POST handler is uncached and Node-runtime by default regardless.
const log = createLogger('API.CastPlayback')

// A receiver reports every 15 s while playing, sender connected or not, so a
// long session is ~240/hour. The limit is per IP and a household's TVs share
// one: 1200 leaves room for a few at once, plus seeks and pauses, without
// letting a stuck device hammer.
const RATE_LIMIT = { maxRequests: 1200, windowMs: 60 * 60 * 1000 }

// What a receiver mints for castSessionId: a UUID, or its cs-<time>-<random>
// fallback (public/receiver/js/playback-reporter.js).
const CAST_SESSION_ID = /^[A-Za-z0-9-]{1,64}$/

/**
 * The presence row a cast writes, or null for an id the receiver could not
 * have minted. Namespaced, so a cast token only ever touches cast rows, never
 * the same user's web or TV-app sessions, whatever id the body names.
 */
function castPresenceSessionId(castSessionId) {
  if (typeof castSessionId !== 'string' || !CAST_SESSION_ID.test(castSessionId)) return null
  return `cast:${castSessionId}`
}

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
  const { token, videoId, playbackTime, isPaused, castSessionId, final, presenceOnly } = body || {}
  const isFinal = final === true

  const verified = verifyCastPlaybackToken(token)
  if (!verified.ok) return json(401, { ok: false, code: verified.code })
  const { claims } = verified
  // The receiver has no session; the signed token names whose playback this is
  recordUserCaller(claims.u)

  // A position, when one is sent, must be a real one. Only a final report may
  // omit it: it still ends the cast's presence.
  const positionSent = playbackTime !== undefined && playbackTime !== null
  const hasPosition =
    typeof playbackTime === 'number' && Number.isFinite(playbackTime) && playbackTime >= 0
  if (!videoId || typeof videoId !== 'string' || (positionSent ? !hasPosition : !isFinal)) {
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
    const ipAddress = clientIp && clientIp !== 'unknown' ? clientIp : null
    const userId = new ObjectId(claims.u)

    // While a sender is connected it owns the position (its CastPositionMirror),
    // and the receiver reports presence only. A final report is the last word
    // either way.
    let applied = false
    if (hasPosition && (isFinal || presenceOnly !== true)) {
      applied = await upsertPlaybackFromCast({
        userId,
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
        ipAddress,
        castSessionId: typeof castSessionId === 'string' ? castSessionId.slice(0, 64) : null,
      })

      // Only on a write that landed — a rejected stale report changed nothing,
      // so there is nothing to invalidate.
      if (applied) await invalidateUserWatchHistoryCache(claims.u)
    }

    // Presence is the short-lived "is this cast live" signal beside the
    // durable position, written whether or not the ordering guard took the
    // position: the TV is at this point either way. Best effort — a failure
    // here never fails the report.
    const presenceSessionId = castPresenceSessionId(castSessionId)
    if (presenceSessionId) {
      try {
        if (isFinal) {
          await endPresenceSession({ userId, sessionId: presenceSessionId })
        } else {
          await upsertPresenceHeartbeat({
            userId,
            sessionId: presenceSessionId,
            videoId,
            playbackTime,
            isPaused: isPaused === true,
            // Signed claims again; the title's identity (mediaId, showId) is
            // resolved from the catalog inside the write.
            metadata: {
              mediaType: claims.m?.t ?? null,
              seasonNumber: claims.m?.sn ?? null,
              episodeNumber: claims.m?.en ?? null,
            },
            // The screen playing is a cast device, whatever its user agent says.
            deviceInfo: { type: 'cast' },
            ipAddress,
          })
        }
      } catch (error) {
        log.error({ error, userId: claims.u, sessionId: presenceSessionId }, 'Cast presence write failed')
      }
    }

    // A cast session can outlast the token that started it. Rolling it here
    // keeps a long evening reporting without ever handing out a long-lived
    // credential; refreshIfDue returns null once the 24 h chain cap is reached,
    // and the receiver then simply falls silent. A final report is the last
    // word for its token, so it gets no replacement.
    const rolled = isFinal ? null : refreshIfDue(claims)

    return json(200, { ok: true, applied, ...(rolled && { token: rolled }) })
  } catch (error) {
    log.error({ error, userId: claims.u, videoId }, 'Cast playback report failed')
    return json(500, { ok: false, code: 'INTERNAL_ERROR' })
  }
}
