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
 */
export async function upsertPresenceHeartbeat({
  userId,
  sessionId,
  videoId,
  playbackTime,
  isPaused = false,
  metadata = {},
  deviceInfo = null,
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
