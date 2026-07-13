/**
 * Playback Presence Database Operations
 *
 * Ephemeral "is this session currently active" signal, separate from the
 * durable WatchHistory resume-position store. See plans/media-activity-presence.md.
 */

import clientPromise from '@src/lib/mongodb'
import { ObjectId } from 'mongodb'
import { generateNormalizedVideoId } from '@src/utils/flatDatabaseUtils'
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
 * @param {Object} options
 * @param {string|ObjectId} options.userId
 * @param {string} options.sessionId - Client-generated UUID, one per player mount
 * @param {string} options.videoId - Video URL (same value WatchHistory.videoId stores)
 * @param {number} options.playbackTime
 * @param {boolean} options.isPaused
 * @param {Object} [options.metadata] - { mediaType, seasonNumber, episodeNumber, showId, mediaId }
 * @param {Object} [options.deviceInfo]
 * @param {string} [options.ipAddress] - Server-observed client IP (proxy-aware)
 * @param {string} [options.localIp] - Optional device-reported local/LAN IP
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

    await collection.updateOne(
      { userId: userIdObj, sessionId },
      {
        $set: {
          videoId,
          normalizedVideoId,
          playbackTime,
          isPaused: isPaused === true,
          lastHeartbeat: new Date(),
          ...metadata,
          ...(deviceInfo && { deviceInfo }),
          ...(ipAddress && { ipAddress }),
          ...(localIp && { localIp }),
        },
      },
      { upsert: true }
    )
  } catch (error) {
    log.error({ error, userId, sessionId, videoId }, 'Failed to upsert presence heartbeat')
    throw error
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
