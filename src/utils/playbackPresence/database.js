/**
 * Playback Presence Database Operations
 *
 * Ephemeral "is this session currently active" signal, separate from the
 * durable WatchHistory resume-position store. See plans/media-activity-presence.md.
 *
 * Writes only. Reading who is live goes through ./live.js, so every surface
 * agrees on the answer.
 */

import clientPromise from '@src/lib/mongodb'
import { ObjectId } from 'mongodb'
import { generateNormalizedVideoId } from '@src/utils/flatDatabaseUtils'
import { resolveMediaIdForNid } from '@src/utils/watchHistory/mediaIdResolver'
import { createLogger } from '@src/lib/logger'
import { presenceStateFor, staleAfterFor } from './contract'

const log = createLogger('PlaybackPresence.Database')

// Garbage collection only, never freshness: rows stop counting as live at
// their own staleAfter. Must stay longer than the longest staleAfter (360 s).
const PRESENCE_TTL_SECONDS = 600

async function ensurePresenceIndexes(db) {
  if (globalThis.__playbackPresenceIndexesEnsured) return
  globalThis.__playbackPresenceIndexesEnsured = true

  const collection = db.collection('PlaybackPresence')
  const indexes = [
    { key: { userId: 1, sessionId: 1 }, unique: true, name: 'userId_sessionId_unique' },
    { key: { lastHeartbeat: 1 }, name: 'lastHeartbeat_ttl', expireAfterSeconds: PRESENCE_TTL_SECONDS },
  ]

  for (const indexSpec of indexes) {
    try {
      await collection.createIndex(indexSpec.key, {
        name: indexSpec.name,
        unique: indexSpec.unique || false,
        ...(indexSpec.expireAfterSeconds !== undefined && { expireAfterSeconds: indexSpec.expireAfterSeconds }),
      })
    } catch (error) {
      // Index already exists with different options - safe to ignore (code 85/86)
      if (error.code !== 85 && error.code !== 86) {
        log.warn({ error, indexName: indexSpec.name }, 'Failed to create presence index')
      }
    }
  }
}

/**
 * Upsert (or refresh) a presence heartbeat for a player session.
 *
 * Every write sets the row's `state` and its `staleAfter` (see ./contract.js),
 * which is the row's own answer to "is this still live".
 *
 * When `playbackTime` is not a finite number the write is a keep-alive: it
 * refreshes liveness and pause state on an EXISTING row and leaves the row's
 * stored position alone. It never inserts — a positionless ping has nothing
 * to say about a session the server does not know, and the next real
 * position write recreates the row.
 *
 * A heartbeat that finds its row already past staleAfter is logged: the client
 * went longer between check-ins than the contract allows, and every reader
 * showed it as gone in the meantime.
 *
 * @param {Object} options
 * @param {string|ObjectId} options.userId
 * @param {string} options.sessionId - Client-generated UUID, one per player mount
 * @param {string} options.videoId - Video URL (same value WatchHistory.videoId stores)
 * @param {number} [options.playbackTime] - omitted on a keep-alive
 * @param {boolean} options.isPaused
 * @param {Object} [options.metadata] - { mediaType, seasonNumber, episodeNumber, showId, mediaId }
 * @param {Object} [options.deviceInfo]
 * @param {string} [options.ipAddress] - Server-observed client IP (proxy-aware)
 * @param {string} [options.localIp] - Optional device-reported local/LAN IP
 * @returns {Promise<boolean>} whether a row was written or refreshed
 */
export async function upsertPresenceHeartbeat({
  userId,
  sessionId,
  videoId,
  playbackTime,
  isPaused = false,
  metadata = {},
  deviceInfo = null,
  ipAddress = null,
  localIp = null,
}) {
  try {
    const client = await clientPromise
    const db = client.db('Media')
    await ensurePresenceIndexes(db)

    const collection = db.collection('PlaybackPresence')
    const userIdObj = typeof userId === 'string' ? new ObjectId(userId) : userId
    const normalizedVideoId = generateNormalizedVideoId(videoId)
    // Same durable identity as WatchHistory (shared cached resolver). TTL'd
    // collection — no backfill; keyed {userId, sessionId} so no index change.
    const resolved = await resolveMediaIdForNid(normalizedVideoId)
    // Identity comes from the catalog, never the client: mediaId for the
    // reason upsertPlayback gives, showId because clients disagree on it (the
    // TV app sends its route id). Nulls never reach $set either: absent means
    // "unchanged", not "erase".
    const { mediaId: _clientMediaId, showId: _clientShowId, ...rawMetadata } = metadata || {}
    const safeMetadata = Object.fromEntries(
      Object.entries(rawMetadata).filter(([, v]) => v !== null && v !== undefined)
    )

    const hasPosition = Number.isFinite(playbackTime)
    const now = new Date()
    const state = presenceStateFor(isPaused)

    const result = await collection.findOneAndUpdate(
      { userId: userIdObj, sessionId },
      {
        $set: {
          videoId,
          normalizedVideoId,
          ...(hasPosition && { playbackTime, positionAt: now }),
          state,
          lastHeartbeat: now,
          staleAfter: staleAfterFor(state, now),
          ...safeMetadata,
          ...(resolved?.mediaId && { mediaId: resolved.mediaId }),
          ...(resolved?.mediaType && { mediaType: resolved.mediaType }),
          ...(resolved?.showId && { showId: resolved.showId }),
          ...(deviceInfo && { deviceInfo }),
          ...(ipAddress && { ipAddress }),
          ...(localIp && { localIp }),
        },
      },
      {
        upsert: hasPosition,
        returnDocument: 'before',
        projection: { state: 1, lastHeartbeat: 1, staleAfter: 1 },
        includeResultMetadata: true,
      }
    )

    const before = result?.value
    if (before?.staleAfter && new Date(before.staleAfter) < now) {
      log.warn(
        {
          userId: String(userIdObj),
          sessionId,
          deviceType: deviceInfo?.type ?? null,
          userAgent: deviceInfo?.userAgent ?? null,
          state: before.state ?? null,
          gapMs: before.lastHeartbeat ? now - new Date(before.lastHeartbeat) : null,
        },
        'Presence heartbeat arrived after its row went stale — client missed the check-in contract'
      )
    }

    return (result?.lastErrorObject?.n ?? 0) > 0
  } catch (error) {
    log.error({ error, userId, sessionId, videoId }, 'Failed to upsert presence heartbeat')
    throw error
  }
}

/**
 * Whether a paused write from `sessionId` merely repeats the position that
 * session already reported — i.e. it is the client's paused keep-alive ping
 * wearing a `progress` body.
 *
 * Pre-`kind` clients (every TV build before d84b7df, every web build before
 * the same change) re-post their paused position every few minutes to keep
 * presence alive. Against a blind $set that ping drags the WatchHistory row
 * back over progress made on another device. The presence row is the tell:
 * it stores the last position THIS session sent, and a genuine pause flip
 * arrives with the presence row still marked playing (or at a different
 * position), while a keep-alive repeat arrives paused at the same position.
 *
 * @param {Object} options
 * @param {string|ObjectId} options.userId
 * @param {string} options.sessionId
 * @param {number} options.playbackTime
 * @returns {Promise<boolean>}
 */
export async function isRepeatPausedPing({ userId, sessionId, playbackTime }) {
  if (!sessionId || !Number.isFinite(playbackTime)) return false
  try {
    const client = await clientPromise
    const db = client.db('Media')
    const collection = db.collection('PlaybackPresence')
    const userIdObj = typeof userId === 'string' ? new ObjectId(userId) : userId
    const row = await collection.findOne(
      { userId: userIdObj, sessionId },
      { projection: { playbackTime: 1, state: 1 } }
    )
    if (!row || row.state !== 'paused') return false
    // Sub-second jitter between what a player reports on pause and what it
    // re-reads for the ping is common; anything under a second is "the same".
    return Math.abs((row.playbackTime ?? NaN) - playbackTime) < 1
  } catch (error) {
    // Best-effort classification: when in doubt, treat the write as progress
    // (the pre-existing behaviour) rather than dropping a real position.
    log.warn({ error, userId, sessionId }, 'Could not classify paused write; treating as progress')
    return false
  }
}

/**
 * End a presence session explicitly (graceful pause+leave, tab close, unmount).
 * Best-effort — safe to call even if no matching session exists.
 *
 * @param {Object} options
 * @param {string|ObjectId} options.userId
 * @param {string} options.sessionId
 */
export async function endPresenceSession({ userId, sessionId }) {
  try {
    const client = await clientPromise
    const db = client.db('Media')
    const collection = db.collection('PlaybackPresence')
    const userIdObj = typeof userId === 'string' ? new ObjectId(userId) : userId

    await collection.deleteOne({ userId: userIdObj, sessionId })
  } catch (error) {
    log.error({ error, userId, sessionId }, 'Failed to end presence session')
    throw error
  }
}
