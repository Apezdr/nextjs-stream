/**
 * Playback Presence Database Operations
 *
 * Ephemeral "is this session currently active" signal, separate from the
 * durable WatchHistory resume-position store. See plans/media-activity-presence.md.
 */

import clientPromise from '@src/lib/mongodb'
import { ObjectId } from 'mongodb'
import { generateNormalizedVideoId } from '@src/utils/flatDatabaseUtils'
import { resolveMediaIdForNid } from '@src/utils/watchHistory/mediaIdResolver'
import { createLogger } from '@src/lib/logger'

const log = createLogger('PlaybackPresence.Database')

const PRESENCE_TTL_SECONDS = 600

// Shared with src/utils/mediaActivity.js so both the desktop-widget API and
// any other consumer (e.g. the admin dashboard) agree on what "active" means.
export const DEFAULT_ACTIVE_WINDOW_SECONDS = 15
// Paused sessions ping every ~3 minutes while foregrounded (see
// WithPlaybackTracker.js); 360s tolerates one missed ping.
export const PAUSED_WINDOW_SECONDS = 360

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
 * When `playbackTime` is not a finite number the write is a keep-alive: it
 * refreshes liveness and pause state on an EXISTING row and leaves the row's
 * stored position alone. It never inserts — a positionless ping has nothing
 * to say about a session the server does not know, and the next real
 * position write recreates the row.
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
    // mediaId is durable-identity-only — strip the legacy client value the
    // metadata always carries (see upsertPlayback for the full rationale).
    // Nulls never reach $set either: absent means "unchanged", not "erase".
    const { mediaId: _legacyClientMediaId, ...rawMetadata } = metadata || {}
    const safeMetadata = Object.fromEntries(
      Object.entries(rawMetadata).filter(([, v]) => v !== null && v !== undefined)
    )

    const hasPosition = Number.isFinite(playbackTime)

    const result = await collection.updateOne(
      { userId: userIdObj, sessionId },
      {
        $set: {
          videoId,
          normalizedVideoId,
          ...(hasPosition && { playbackTime }),
          isPaused: isPaused === true,
          lastHeartbeat: new Date(),
          ...safeMetadata,
          ...(resolved?.mediaId && { mediaId: resolved.mediaId }),
          ...(deviceInfo && { deviceInfo }),
          ...(ipAddress && { ipAddress }),
          ...(localIp && { localIp }),
        },
      },
      { upsert: hasPosition }
    )
    return (result.matchedCount ?? 0) > 0 || (result.upsertedCount ?? 0) > 0
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
      { projection: { playbackTime: 1, isPaused: 1 } }
    )
    if (!row || row.isPaused !== true) return false
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

/**
 * Look up currently-active presence sessions for a set of users, using the
 * same two-tier active/paused window as getActiveMediaSessions() in
 * mediaActivity.js. Intended for read-only "is this user watching something
 * right now" consumers (e.g. the admin dashboard) that don't need the full
 * XML/JSON widget-API shape.
 *
 * @param {Array<string|ObjectId>} userIds
 * @returns {Promise<Map<string, Array<Object>>>} userId (string) -> active PlaybackPresence docs
 */
export async function getActivePresenceForUsers(userIds) {
  if (!userIds || userIds.length === 0) {
    return new Map()
  }

  const client = await clientPromise
  const db = client.db('Media')
  const collection = db.collection('PlaybackPresence')

  const userIdObjs = userIds.map((id) => (typeof id === 'string' ? new ObjectId(id) : id))
  const activeSince = new Date(Date.now() - DEFAULT_ACTIVE_WINDOW_SECONDS * 1000)
  const pausedSince = new Date(Date.now() - PAUSED_WINDOW_SECONDS * 1000)

  const entries = await collection
    .find({
      userId: { $in: userIdObjs },
      $or: [
        { isPaused: { $ne: true }, lastHeartbeat: { $gte: activeSince } },
        { isPaused: true, lastHeartbeat: { $gte: pausedSince } },
      ],
    })
    .toArray()

  const byUser = new Map()
  for (const entry of entries) {
    const key = String(entry.userId)
    if (!byUser.has(key)) byUser.set(key, [])
    byUser.get(key).push(entry)
  }
  return byUser
}
